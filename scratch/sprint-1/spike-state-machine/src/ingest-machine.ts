/**
 * DESIGN B for ingest: a run machine (prepare -> per-document child machines -> S2 extras -> R-24 guard -> commit ->
 * announce) with JSON-only persisted snapshots. Same events, same single transaction as the skeleton.
 * Snapshots never hold vectors or chunk text: vectors go to a VectorCheckpoint (side store), chunks are recomputed
 * by the pure chunker from the stored artifact.
 */
import { assign, createActor, fromPromise, setup, toPromise } from 'xstate';
import {
  KgError, canonicalJson, composeBuild, defaultDocKey, docVersionId, recipeId, renderDocument, sha256hex, spaceId as computeSpaceId,
  type BuildId, type Chunk, type ChunkDraft, type ChunkId, type Chunker, type CorpusStore, type Ctx, type DatabaseConfig, type DocKey, type DocVersion,
  type Embedder, type IngestReport, type IngestRequest, type IngestService, type Json, type ParseArtifact, type Parser, type RecipeId, type SpaceId,
} from '@kg/core';

export interface IngestDeps { store: CorpusStore; parser: Parser; chunker: Chunker; embedder: Embedder; config: DatabaseConfig }

/** Where embedded-but-not-yet-committed vectors live (a table or a directory in the real thing). */
export class VectorCheckpoint {
  readonly m = new Map<string, Float32Array>();
  key = (s: SpaceId, id: string) => `${s}:${id}`;
  has = (s: SpaceId, id: string) => this.m.has(this.key(s, id));
  clear = () => this.m.clear();
}
export interface Persistence { save(key: string, snapshotJson: string): void; load(key: string): string | null; drop(key: string): void }
export const memoryPersistence = (): Persistence & { map: Map<string, string> } => {
  const map = new Map<string, string>();
  return { map, save: (k, v) => void map.set(k, v), load: (k) => map.get(k) ?? null, drop: (k) => void map.delete(k) };
};

type Entry = { kind: 'file' | 'artifact'; path: string; docKey?: string };
type DocOut = { docKey: DocKey; docVersionId: DocVersion['id']; artifactId: string; previous: DocVersion['id'] | null; unchanged: boolean; inserted: number; reused: number; dropped: number };
type DocCtx = { entry: Entry; seen: string[]; docKey?: DocKey; sha?: string; artifactId?: string; out?: DocOut; chunkIds?: ChunkId[] };
export type RunCtx = {
  entries: Entry[]; idx: number; seen: string[]; docs: DocOut[];
  chunkRid?: RecipeId; searchRid?: RecipeId; prevBuild?: BuildId | null;
  commit?: { id: BuildId; existed: boolean; mixedRecipes: boolean; itemCount: number };
  error?: { code: string; message: string };
};

export interface IngestOptions {
  persist?: Persistence;
  checkpoint?: VectorCheckpoint;
  /** test hook: sees every persisted snapshot; returning true simulates a crash right after it was saved */
  /** test hook: make the S2 extras stage a no-op, to show the R-24 guard (not the store) stopping the run */
  unsafeSkipExtras?: boolean;
  crashAfterEvent?: (n: number) => boolean;
  crashAfter?: (snapshot: { n: number; value: unknown; context: RunCtx }) => boolean;
}
export class Interrupted extends Error {}

export function createMachineIngest(d: IngestDeps, o: IngestOptions = {}): IngestService {
  const { store, parser, chunker, embedder, config } = d;
  const cp = o.checkpoint ?? new VectorCheckpoint();
  return {
    async ingest(ctx: Ctx, req: IngestRequest): Promise<IngestReport> {
      const entries: Entry[] = [...(req.sources ?? []).map((s) => ({ ...s, kind: 'file' as const })), ...(req.artifacts ?? []).map((s) => ({ ...s, kind: 'artifact' as const }))];
      const runKey = sha256hex(canonicalJson(req as unknown as Json));
      const draftsOf = (artifactId: string, docKey: DocKey): ChunkDraft[] => chunker(store.getArtifact(artifactId as never)!, docKey, config.chunkRecipe);
      const space = () => store.putSpace(config.space);
      // crash simulation: a dead process neither emits nor checkpoints; `crashAfterEvent` kills it right after the n-th event was appended
      let dead = false; let emitted = 0; let kill: () => void = () => {};
      const emit: Ctx['emit'] = (type, payload, opt) => {
        if (dead) throw new Interrupted('dead');
        const ev = ctx.emit(type, payload, opt);
        if (o.crashAfterEvent?.(++emitted)) { kill(); throw new Interrupted('crash after event'); }
        return ev;
      };
      const checkpoint = (sp: SpaceId, id: string, v: Float32Array) => { if (dead) throw new Interrupted('dead'); cp.m.set(cp.key(sp, id), v); };

      /** ---- child machine: one document ---- */
      const docMachine = setup({
        types: { context: {} as DocCtx, input: {} as { entry: Entry; seen: string[] }, output: {} as DocOut },
        actors: {
          identify: fromPromise(async ({ input }: { input: DocCtx }) => {
            const e = input.entry;
            if (e.kind === 'file') {
              const { sha256 } = await parser.identify(e.path);
              const docKey = (e.docKey ?? defaultDocKey(e.path)) as DocKey;
              emit('ingest.started', { docKey, source: { kind: 'file', path: e.path }, sourceSha256: sha256, parseRecipeId: store.putRecipe(config.parseRecipe), chunkRecipeId: store.putRecipe(config.chunkRecipe) });
              return { docKey, sha: sha256 };
            }
            const a = await parser.readArtifact(e.path);
            const docKey = (e.docKey ?? defaultDocKey(a.sourceName)) as DocKey;
            emit('ingest.started', { docKey, source: { kind: 'artifact', path: e.path }, sourceSha256: a.sourceSha256, parseRecipeId: recipeId(a.recipe), chunkRecipeId: store.putRecipe(config.chunkRecipe) });
            return { docKey, sha: a.sourceSha256 };
          }),
          resolve: fromPromise(async ({ input }: { input: DocCtx }) => {
            const e = input.entry;
            let artifact: ParseArtifact; let origin: 'parsed' | 'cache' | 'imported';
            if (e.kind === 'file') {
              const cached = store.findArtifact(input.sha!, store.putRecipe(config.parseRecipe));
              if (cached) { artifact = store.getArtifact(cached)!; origin = 'cache'; }
              else {
                artifact = await parser.parse({ path: e.path, docKey: input.docKey!, sha256: input.sha! }, config.parseRecipe);
                if (artifact.sourceSha256 !== input.sha || canonicalJson(artifact.recipe as unknown as Json) !== canonicalJson(config.parseRecipe as unknown as Json))
                  throw new KgError('upstream', `parser returned an artifact for another source or recipe (${e.path})`);
                origin = 'parsed';
              }
            } else { artifact = await parser.readArtifact(e.path); origin = 'imported'; }
            if (dead) throw new Interrupted('dead');
            const artifactId = store.putArtifact(artifact); // stored at once: a finished parse is never thrown away
            emit('ingest.parsed', { docKey: input.docKey!, artifactId, origin, stats: artifact.stats });
            return { artifactId };
          }),
          chunk: fromPromise(async ({ input }: { input: DocCtx }) => {
            const drafts = draftsOf(input.artifactId!, input.docKey!);
            const vId = docVersionId(input.docKey!, input.artifactId as never, store.putRecipe(config.chunkRecipe));
            const chunkIds = drafts.map((c) => c.id);
            const prev = store.currentDocVersions().find((x) => x.docKey === input.docKey);
            const existing = new Set(store.getItems(chunkIds).map((i) => i.id));
            const now = new Set(chunkIds);
            const counts = { inserted: chunkIds.filter((c) => !existing.has(c)).length, reused: chunkIds.filter((c) => existing.has(c)).length, dropped: prev ? prev.chunkIds.filter((c) => !now.has(c)).length : 0 };
            emit('ingest.chunked', { docKey: input.docKey!, docVersionId: vId, chunkCount: drafts.length, ...counts });
            return { chunkIds, out: { docKey: input.docKey!, docVersionId: vId, artifactId: input.artifactId!, previous: prev?.id ?? null, unchanged: prev?.id === vId, ...counts } satisfies DocOut };
          }),
          embed: fromPromise(async ({ input }: { input: DocCtx }) => {
            const sp = space();
            const t0 = ctx.clock.monotonicMs();
            const missingInStore = store.missingEmbeddings(sp, input.chunkIds!) as ChunkId[];
            const todo = missingInStore.filter((id) => !cp.has(sp, id)); // after a resume: skip vectors already checkpointed
            const byId = new Map(draftsOf(input.artifactId!, input.docKey!).map((c) => [c.id, c]));
            const vecs = todo.length ? await embedder.embed(todo.map((id) => renderDocument(config.space, byId.get(id)!))) : [];
            todo.forEach((id, i) => checkpoint(sp, id, vecs[i]!));
            emit('ingest.embedded', { docKey: input.docKey!, spaceId: sp, embedded: missingInStore.length, skipped: input.chunkIds!.length - missingInStore.length, elapsedMs: Math.max(0, ctx.clock.monotonicMs() - t0) });
          }),
        },
        guards: { duplicate: ({ context }) => context.seen.includes(context.docKey!) },
      }).createMachine({
        context: ({ input }) => ({ entry: input.entry, seen: input.seen }),
        initial: 'identifying',
        output: ({ context }) => context.out!,
        states: {
          identifying: { invoke: { src: 'identify', input: ({ context }) => context, onDone: { target: 'checkDup', actions: assign(({ event }) => event.output) } } },
          checkDup: { always: [{ guard: 'duplicate', target: 'dup' }, { target: 'resolving' }] },
          dup: { entry: () => { throw new KgError('invalid_input', 'document named twice in one ingest'); } },
          resolving: { invoke: { src: 'resolve', input: ({ context }) => context, onDone: { target: 'chunking', actions: assign(({ event }) => event.output) } } },
          chunking: { invoke: { src: 'chunk', input: ({ context }) => context, onDone: { target: 'embedding', actions: assign(({ event }) => event.output) } } },
          embedding: { invoke: { src: 'embed', input: ({ context }) => context, onDone: 'done' } },
          done: { type: 'final' },
        },
      });

      /** R-24 as a guard: every item the build would hold has a vector in the store or waiting in the checkpoint */
      const allEmbedded = (c: RunCtx) => {
        const sp = space();
        const requested = new Set(c.docs.map((x) => x.docKey as string));
        const ids = [...c.docs.flatMap((x) => draftsOf(x.artifactId, x.docKey).map((k) => k.id)), ...store.currentDocVersions().filter((v) => !requested.has(v.docKey)).flatMap((v) => v.chunkIds)];
        return (store.missingEmbeddings(sp, ids) as string[]).every((id) => cp.has(sp, id));
      };

      /** ---- the run machine ---- */
      const runMachine = setup({
        types: { context: {} as RunCtx, input: {} as { entries: Entry[] }, output: {} as IngestReport },
        actors: {
          prepare: fromPromise(async () => {
            if (embedder.model !== config.space.model || embedder.dims !== config.space.dims) throw new KgError('precondition', `embedder ${embedder.model} does not serve space ${config.space.model}`);
            store.putRecipe(config.parseRecipe); space();
            return { chunkRid: store.putRecipe(config.chunkRecipe), searchRid: store.putRecipe(config.searchRecipe), prevBuild: store.currentBuild() };
          }),
          doc: docMachine,
          extras: fromPromise(async ({ input }: { input: RunCtx }) => {
            const sp = space();
            if (o.unsafeSkipExtras) return;
            const requested = new Set(input.docs.map((p) => p.docKey as string));
            for (const v of store.currentDocVersions()) {
              if (requested.has(v.docKey)) continue;
              const missing = store.missingEmbeddings(sp, v.chunkIds) as ChunkId[];
              if (!missing.length) continue;
              const t0 = ctx.clock.monotonicMs();
              const items = store.getItems(missing.filter((id) => !cp.has(sp, id))) as Chunk[];
              const vecs = items.length ? await embedder.embed(items.map((c) => renderDocument(config.space, c))) : [];
              items.forEach((c, i) => checkpoint(sp, c.id, vecs[i]!));
              emit('ingest.embedded', { docKey: v.docKey, spaceId: sp, embedded: missing.length, skipped: v.chunkIds.length - missing.length, elapsedMs: Math.max(0, ctx.clock.monotonicMs() - t0) });
            }
          }),
          /** pure: what the build will be, and whether it already exists. Persisted BEFORE the transaction so a resume after a commit cannot mistake the build for a revert. */
          plan: fromPromise(async ({ input }: { input: RunCtx }) => {
            const requested = new Set(input.docs.map((p) => p.docKey as string));
            const next = input.docs.map((p) => ({ id: p.docVersionId, docKey: p.docKey, artifactId: p.artifactId, chunkRecipeId: input.chunkRid!, chunkIds: draftsOf(p.artifactId, p.docKey).map((c) => c.id) }));
            const docVersions = [...store.currentDocVersions().filter((v) => !requested.has(v.docKey)), ...next].sort((a, b) => (a.docKey < b.docKey ? -1 : 1));
            const b = composeBuild({ docVersions: docVersions as never, parseRecipeOf: (a) => recipeId(store.getArtifact(a)!.recipe), spaceIds: [computeSpaceId(config.space)], searchRecipeId: input.searchRid!, parentId: input.prevBuild! });
            return { id: b.id, existed: store.getBuild(b.id) !== null, mixedRecipes: b.manifest.mixedRecipes, itemCount: b.itemIds.length };
          }),
          commit: fromPromise(async ({ input }: { input: RunCtx }) => {
            const sp = space();
            const rows = (ids: ChunkId[]) => ids.filter((id) => cp.has(sp, id)).map((itemId) => ({ itemId, vector: cp.m.get(cp.key(sp, itemId))! }));
            return store.transaction(() => {
              const requested = new Set(input.docs.map((p) => p.docKey as string));
              store.putEmbeddings(sp, rows(store.currentDocVersions().filter((v) => !requested.has(v.docKey)).flatMap((v) => store.missingEmbeddings(sp, v.chunkIds) as ChunkId[])));
              for (const p of input.docs) {
                const drafts = draftsOf(p.artifactId, p.docKey);
                store.putDocVersion({ id: p.docVersionId, docKey: p.docKey, artifactId: p.artifactId as never, chunkRecipeId: input.chunkRid!, chunkIds: drafts.map((c) => c.id) }, drafts);
                store.putEmbeddings(sp, rows(store.missingEmbeddings(sp, drafts.map((c) => c.id)) as ChunkId[]));
                store.setCurrentDocVersion(p.docKey, p.docVersionId);
              }
              const b = composeBuild({ docVersions: store.currentDocVersions(), parseRecipeOf: (a) => recipeId(store.getArtifact(a)!.recipe), spaceIds: [computeSpaceId(config.space)], searchRecipeId: input.searchRid!, parentId: input.prevBuild! });
              const id = store.putBuild({ parentId: b.parentId, manifest: b.manifest, itemIds: b.itemIds });
              if (id !== input.commit!.id) throw new KgError('internal', 'planned build differs from committed build');
              if (id !== input.prevBuild) store.setCurrentBuild(id);
              return input.commit!;
            });
          }),
        },
        guards: { more: ({ context }) => context.idx < context.entries.length, embeddedForBuild: ({ context }) => allEmbedded(context) },
        actions: {
          announce: ({ context }) => {
            for (const p of context.docs) emit('ingest.completed', { docKey: p.docKey, docVersionId: p.docVersionId, unchanged: p.unchanged, previousDocVersionId: p.previous });
            const c = context.commit!;
            if (c.id !== context.prevBuild) emit('build.created', { buildId: c.id, parentId: context.prevBuild!, mixedRecipes: c.mixedRecipes, itemCount: c.itemCount, revert: c.existed }, { buildId: c.id });
          },
          fail: assign(({ event }) => { const e = (event as unknown as { error: unknown }).error; return { error: { code: e instanceof KgError ? e.code : 'internal', message: e instanceof Error ? e.message : String(e) } }; }),
        },
      }).createMachine({
        context: ({ input }) => ({ entries: input.entries, idx: 0, seen: [], docs: [] }),
        initial: 'preparing',
        output: ({ context }) => ({
          docs: context.docs.map((p) => ({ docKey: p.docKey, docVersionId: p.docVersionId, unchanged: p.unchanged, inserted: p.inserted, reused: p.reused, dropped: p.dropped })),
          buildId: context.commit?.id as BuildId, // failed runs have no commit; the driver throws before reading this
          buildChanged: context.commit ? context.commit.id !== context.prevBuild : false,
        }),
        states: {
          preparing: { invoke: { src: 'prepare', onDone: { target: 'nextDoc', actions: assign(({ event }) => event.output) }, onError: { target: 'failed', actions: 'fail' } } },
          nextDoc: { always: [{ guard: 'more', target: 'document' }, { target: 'extras' }] },
          document: {
            invoke: {
              src: 'doc', input: ({ context }) => ({ entry: context.entries[context.idx]!, seen: context.seen }),
              onDone: { target: 'nextDoc', actions: assign(({ context, event }) => ({ idx: context.idx + 1, docs: [...context.docs, event.output], seen: [...context.seen, event.output.docKey] })) },
              onError: { target: 'failed', actions: 'fail' },
            },
          },
          extras: { invoke: { src: 'extras', input: ({ context }) => context, onDone: 'gate', onError: { target: 'failed', actions: 'fail' } } },
          gate: { always: [{ guard: 'embeddedForBuild', target: 'planning' }, { target: 'failed', actions: assign({ error: { code: 'precondition', message: 'R-24: items without vectors would enter the build' } }) }] },
          planning: { invoke: { src: 'plan', input: ({ context }) => context, onDone: { target: 'committing', actions: assign(({ event }) => ({ commit: event.output })) }, onError: { target: 'failed', actions: 'fail' } } },
          committing: { invoke: { src: 'commit', input: ({ context }) => context, onDone: 'announcing', onError: { target: 'failed', actions: 'fail' } } },
          announcing: { entry: 'announce', always: 'done' },
          done: { type: 'final' },
          failed: { type: 'final' },
        },
      });

      /** ---- drive it: fresh start, or resume when a persisted snapshot exists for this exact request ---- */
      const saved = o.persist?.load(runKey) ?? null;
      let saves = 0;
      let stopped = false;
      let crash!: (e: Error) => void;
      const crashed = new Promise<never>((_, rej) => { crash = rej; });
      // `inspect` sees child-actor snapshots too; subscribing to the root alone would miss every per-document stage
      const inspect = (ev: { type: string }) => {
        if (ev.type !== '@xstate.snapshot' || stopped || dead) return;
        const root = actor.getSnapshot();
        if (root.status !== 'active') return;
        o.persist?.save(runKey, JSON.stringify(actor.getPersistedSnapshot()));
        saves++;
        if (o.crashAfter?.({ n: saves, value: root.value, context: root.context })) kill();
      };
      kill = () => { dead = true; stopped = true; actor.stop(); crash(new Interrupted('simulated crash')); };
      const actor = saved ? createActor(runMachine, { snapshot: JSON.parse(saved) as never, input: { entries }, inspect }) : createActor(runMachine, { input: { entries }, inspect });
      const finished = toPromise(actor);
      actor.start();
      await Promise.race([finished, crashed]).catch((e) => { if (!stopped) throw e; });
      if (stopped) throw new Interrupted('simulated crash');
      o.persist?.drop(runKey);
      const snap = actor.getSnapshot();
      if (snap.value === 'failed') {
        // the checkpoint is kept: a retry of the same request re-uses finished embeddings (the store stays untouched)
        throw new KgError(snap.context.error!.code as never, snap.context.error!.message);
      }
      cp.clear();
      return snap.output as IngestReport;
    },
  };
}
