/**
 * SKELETON ingest (replaced by the Phase 2 `ingest` package). All-or-nothing per call: every document is
 * parsed (or found in the cache / imported), chunked and embedded first; doc versions, embeddings, current
 * pointers and the build are written in one transaction at the end. Parsed artifacts are stored as soon
 * as they exist (an expensive parse is never thrown away).
 */
import {
  KgError,
  canonicalJson,
  composeBuild,
  defaultDocKey,
  docVersionId,
  recipeId,
  renderDocument,
  spaceId as computeSpaceId,
  type Chunk,
  type ChunkDraft,
  type ChunkId,
  type Chunker,
  type CorpusStore,
  type Ctx,
  type DatabaseConfig,
  type DocKey,
  type DocVersion,
  type Embedder,
  type IngestReport,
  type IngestRequest,
  type IngestService,
  type Json,
  type ParseArtifact,
  type Parser,
} from '@kg/core';

export interface IngestDeps {
  store: CorpusStore;
  parser: Parser;
  chunker: Chunker;
  embedder: Embedder;
  config: DatabaseConfig;
}

interface Prepared {
  docKey: DocKey;
  v: Omit<DocVersion, 'createdAt'>;
  drafts: ChunkDraft[];
  rows: { itemId: ChunkId; vector: Float32Array }[];
  unchanged: boolean;
  inserted: number;
  reused: number;
  dropped: number;
}

export function createIngest(d: IngestDeps): IngestService {
  const { store, parser, chunker, embedder, config } = d;
  return {
    async ingest(ctx: Ctx, req: IngestRequest): Promise<IngestReport> {
      if (embedder.model !== config.space.model || embedder.dims !== config.space.dims) throw new KgError('precondition', `embedder ${embedder.model} does not serve space ${config.space.model}`);
      const parseRid = store.putRecipe(config.parseRecipe);
      const chunkRid = store.putRecipe(config.chunkRecipe);
      const searchRid = store.putRecipe(config.searchRecipe);
      const space = store.putSpace(config.space);
      const entries = [...(req.sources ?? []).map((s) => ({ ...s, kind: 'file' as const })), ...(req.artifacts ?? []).map((s) => ({ ...s, kind: 'artifact' as const }))];
      const prepared: Prepared[] = [];
      const seen = new Set<string>();

      for (const e of entries) {
        let artifact: ParseArtifact;
        let docKey: DocKey;
        let origin: 'parsed' | 'cache' | 'imported';
        if (e.kind === 'file') {
          const { sha256 } = await parser.identify(e.path);
          docKey = (e.docKey ?? defaultDocKey(e.path)) as DocKey;
          ctx.emit('ingest.started', { docKey, source: { kind: 'file', path: e.path }, sourceSha256: sha256, parseRecipeId: parseRid, chunkRecipeId: chunkRid });
          const cached = store.findArtifact(sha256, parseRid);
          if (cached) {
            artifact = store.getArtifact(cached)!;
            origin = 'cache';
          } else {
            artifact = await parser.parse({ path: e.path, docKey, sha256 }, config.parseRecipe);
            if (artifact.sourceSha256 !== sha256 || canonicalJson(artifact.recipe as unknown as Json) !== canonicalJson(config.parseRecipe as unknown as Json))
              throw new KgError('upstream', `parser returned an artifact for another source or recipe (${e.path})`);
            origin = 'parsed';
          }
        } else {
          artifact = await parser.readArtifact(e.path);
          docKey = (e.docKey ?? defaultDocKey(artifact.sourceName)) as DocKey;
          ctx.emit('ingest.started', { docKey, source: { kind: 'artifact', path: e.path }, sourceSha256: artifact.sourceSha256, parseRecipeId: recipeId(artifact.recipe), chunkRecipeId: chunkRid });
          origin = 'imported';
        }
        if (seen.has(docKey)) throw new KgError('invalid_input', `document ${docKey} named twice in one ingest`);
        seen.add(docKey);
        const aid = store.putArtifact(artifact);
        ctx.emit('ingest.parsed', { docKey, artifactId: aid, origin, stats: artifact.stats });

        const drafts = chunker(artifact, docKey, config.chunkRecipe);
        const v = { id: docVersionId(docKey, aid, chunkRid), docKey, artifactId: aid, chunkRecipeId: chunkRid, chunkIds: drafts.map((c) => c.id) };
        const prev = store.currentDocVersions().find((x) => x.docKey === docKey);
        const existing = new Set(store.getItems(v.chunkIds).map((i) => i.id));
        const now = new Set(v.chunkIds);
        const counts = {
          inserted: v.chunkIds.filter((c) => !existing.has(c)).length,
          reused: v.chunkIds.filter((c) => existing.has(c)).length,
          dropped: prev ? prev.chunkIds.filter((c) => !now.has(c)).length : 0,
        };
        ctx.emit('ingest.chunked', { docKey, docVersionId: v.id, chunkCount: drafts.length, ...counts });

        const t0 = ctx.clock.monotonicMs();
        const missing = store.missingEmbeddings(space, v.chunkIds) as ChunkId[];
        const byId = new Map(drafts.map((c) => [c.id, c]));
        const vecs = missing.length ? await embedder.embed(missing.map((id) => renderDocument(config.space, byId.get(id)!))) : [];
        ctx.emit('ingest.embedded', { docKey, spaceId: space, embedded: missing.length, skipped: v.chunkIds.length - missing.length, elapsedMs: Math.max(0, ctx.clock.monotonicMs() - t0) });
        prepared.push({ docKey, v, drafts, rows: missing.map((itemId, i) => ({ itemId, vector: vecs[i]! })), unchanged: prev?.id === v.id, ...counts });
      }

      // S2: a build must not hold items without a vector in its space. Other current documents (not in this
      // request) are embedded in config.space too if they lack vectors (e.g. after a space switch).
      const requested = new Set(prepared.map((p) => p.docKey as string));
      const extra: { itemId: ChunkId; vector: Float32Array }[] = [];
      for (const v of store.currentDocVersions()) {
        if (requested.has(v.docKey)) continue;
        const missing = store.missingEmbeddings(space, v.chunkIds) as ChunkId[];
        if (!missing.length) continue;
        const t0 = ctx.clock.monotonicMs();
        const items = store.getItems(missing) as Chunk[];
        const vecs = await embedder.embed(items.map((c) => renderDocument(config.space, c)));
        items.forEach((c, i) => extra.push({ itemId: c.id, vector: vecs[i]! }));
        ctx.emit('ingest.embedded', { docKey: v.docKey, spaceId: space, embedded: missing.length, skipped: v.chunkIds.length - missing.length, elapsedMs: Math.max(0, ctx.clock.monotonicMs() - t0) });
      }

      const prevBuild = store.currentBuild();
      const result = store.transaction(() => {
        store.putEmbeddings(space, extra);
        for (const p of prepared) {
          store.putDocVersion(p.v, p.drafts);
          store.putEmbeddings(space, p.rows);
          store.setCurrentDocVersion(p.docKey, p.v.id);
        }
        const b = composeBuild({
          docVersions: store.currentDocVersions(),
          parseRecipeOf: (a) => recipeId(store.getArtifact(a)!.recipe),
          spaceIds: [computeSpaceId(config.space)],
          searchRecipeId: searchRid,
          parentId: prevBuild,
        });
        const id = store.putBuild({ parentId: b.parentId, manifest: b.manifest, itemIds: b.itemIds });
        if (id !== prevBuild) store.setCurrentBuild(id);
        return { id, b };
      });
      for (const p of prepared) ctx.emit('ingest.completed', { docKey: p.docKey, docVersionId: p.v.id, unchanged: p.unchanged });
      const buildChanged = result.id !== prevBuild;
      if (buildChanged)
        ctx.emit('build.created', { buildId: result.id, parentId: prevBuild, mixedRecipes: result.b.manifest.mixedRecipes, itemCount: result.b.itemIds.length }, { buildId: result.id });
      return {
        docs: prepared.map((p) => ({ docKey: p.docKey, docVersionId: p.v.id, unchanged: p.unchanged, inserted: p.inserted, reused: p.reused, dropped: p.dropped })),
        buildId: result.id,
        buildChanged,
      };
    },
  };
}
