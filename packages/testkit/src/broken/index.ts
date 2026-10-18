/**
 * Deliberately broken fakes. Each must FAIL its conformance suite (test/meta.test.ts asserts which cases
 * catch it). A suite that stops catching its broken fake has lost its teeth.
 */
import {
  KgError,
  composeBuild,
  createKgApi,
  defaultDocKey,
  docVersionId,
  errorCodeOf,
  recipeId,
  renderDocument,
  sha256hex,
  sortCandidates,
  type Candidate,
  spaceId,
  toRankedRefs,
  type AnyItem,
  type Chunker,
  type ChunkViewRenderer,
  type ChunkId,
  type CorpusStore,
  type Ctx,
  type DatabaseConfig,
  type EventDraft,
  type EventEnvelope,
  type IdGen,
  type IngestReport,
  type IngestRequest,
  type IngestService,
  type ItemId,
  type KnnQuery,
  type LlmRequest,
  type LlmResponse,
  type MachineMap,
  type Parser,
  type ParseArtifact,
  type ParseRecipeSpec,
  type SearchRequest,
  type SearchResponse,
  type SearchService,
  type SearchState,
  type SearchStep,
  type SourceRef,
  type Embedder,
  type EvalResultRecord,
  type BuildId,
  type DocKey,
} from '@kg/core';
import { HashEmbedder, hashTokens, fnv1a32 } from '../fakes/embedder';
import { InMemoryEventLog } from '../fakes/eventlog';
import { InMemoryEvalRepo } from '../fakes/evalrepo';
import { FixedClock, SeqIds } from '../fakes/infra';
import { fakeHandlers, type FakeKgApiScript } from '../fakes/kgapi';
import { ScriptedLlm } from '../fakes/llm';
import { FixtureParser } from '../fakes/parser';
import { ScriptedSearchService, type ScriptedHit } from '../fakes/search';
import { InMemoryCorpusStore } from '../fakes/store';

/** Parser: returns the stored artifact for the sha256 regardless of the requested recipe, with its own options. */
export class DriftingParser extends FixtureParser {
  override async parse(src: SourceRef, _recipe: ParseRecipeSpec): Promise<ParseArtifact> {
    const hit = this.entries.find((x) => x.artifact.sourceSha256 === src.sha256);
    if (!hit) throw new KgError('not_found', 'no fixture');
    const a = structuredClone(hit.artifact);
    a.recipe.spec.options.do_ocr = !a.recipe.spec.options.do_ocr;
    return a;
  }
}

/** Chunker: the Phase 0 spike's index-based IDs, sha256(index|text). */
export const indexIdChunker =
  (base: Chunker): Chunker =>
  (a, docKey, r) =>
    base(a, docKey, r).map((c, i) => ({ ...c, id: `ch_${sha256hex(`${i}|${c.text}`).slice(0, 20).replace(/[^a-z2-7]/g, 'a')}` as ChunkId }));

/** Embedder: bag-of-words counts without normalization. */
export class UnnormalizedEmbedder implements Embedder {
  readonly model = 'broken-unnormalized';
  constructor(readonly dims = 64) {}
  async embed(texts: readonly string[]) {
    return texts.map((t) => {
      const v = new Float32Array(this.dims);
      for (const tok of hashTokens(t)) v[fnv1a32(tok) % this.dims]! += 1;
      return v;
    });
  }
}
/** Embedder: returns batch results in reverse order. */
export class BatchOrderEmbedder extends HashEmbedder {
  override async embed(texts: readonly string[]) {
    return (await super.embed(texts)).reverse();
  }
}

/** Store: overwrites derived items silently (violates Rule 2). */
export class MutableStore extends InMemoryCorpusStore {
  override putItems(items: readonly AnyItem[], nodes: readonly import('@kg/core').Node[] = []): void {
    for (const n of nodes) this.s.nodes.set(n.id, structuredClone(n));
    for (const it of items) {
      if (it.kind === 'chunk') throw new KgError('invalid_input', 'chunks enter only through putDocVersion');
      this.s.items.set(it.id, structuredClone(it));
      this.index(it);
    }
  }
}
/** Store: re-putting an existing doc version silently keeps the first chunk list (violates CP-01b). */
export class SilentDocVersionStore extends InMemoryCorpusStore {
  override putDocVersion(v: Parameters<InMemoryCorpusStore['putDocVersion']>[0], chunks: Parameters<InMemoryCorpusStore['putDocVersion']>[1]) {
    const existing = this.s.docVersions.get(v.id);
    if (existing) return { inserted: [], reused: [...existing.chunkIds] };
    return super.putDocVersion(v, chunks);
  }
}
/** Store: KNN ignores the build (superseded chunks leak into results). */
export class LeakyKnnStore extends InMemoryCorpusStore {
  protected override candidateIds(q: KnnQuery): ItemId[] {
    const kinds = new Set(q.kinds);
    return [...this.s.items.values()].filter((i) => kinds.has(i.kind)).map((i) => i.id);
  }
}

/** Log: seq jumps by 2. */
export class GappySeqLog extends InMemoryEventLog {
  protected override nextSeq(list: EventEnvelope[]): number {
    return list.length + 2;
  }
}
/** Log: stores anything without validating it. */
export class NoValidateLog extends InMemoryEventLog {
  protected override validate(e: EventDraft): EventDraft {
    return e;
  }
}

/** Llm: improvises an empty answer instead of refusing an unscripted request. */
export class ImprovisingLlm extends ScriptedLlm {
  override async complete(r: LlmRequest): Promise<LlmResponse> {
    try {
      return await super.complete(r);
    } catch {
      return { text: '', model: r.model, inputTokens: 0, outputTokens: 0 };
    }
  }
}

/** EvalRepo: overwrites results silently. */
export class OverwritingEvalRepo extends InMemoryEvalRepo {
  override putResult(r: EvalResultRecord): void {
    const m = this.res.get(r.runId);
    if (!m) throw new KgError('not_found', `eval run ${r.runId}`);
    m.set(`${r.questionId}\u001f${r.condition}`, structuredClone(r));
  }
}

/** Steps. */
export class MutatingStep implements SearchStep {
  readonly type = 'mutating';
  async run(state: Readonly<SearchState>) {
    (state as SearchState).candidates.sort((a, b) => b.score - a.score); // in place
    const refs = toRankedRefs(sortCandidates(state.candidates));
    return { state: state as SearchState, trace: { stepType: this.type, params: {}, considered: refs, output: refs } };
  }
}
export class UnrankedStep implements SearchStep {
  readonly type = 'unranked';
  async run(state: Readonly<SearchState>) {
    const candidates = sortCandidates(state.candidates).reverse();
    const refs = candidates.map((c, i) => ({ itemId: c.itemId, score: c.score, rank: i + 1, queryId: c.queryId }));
    return { state: { ...state, candidates }, trace: { stepType: this.type, params: {}, considered: refs, output: refs } };
  }
}

/** Steps (P-1): wipe the pools they were given. */
export class PoolDroppingStep implements SearchStep {
  readonly type = 'pool-dropping';
  async run(state: Readonly<SearchState>) {
    const refs = toRankedRefs(sortCandidates(state.candidates));
    return { state: { ...state, pools: {} }, trace: { stepType: this.type, params: {}, considered: refs, output: refs } };
  }
}
/** An `into` step that writes the hits to candidates as well (and keeps the pool unsorted/duplicated). */
export class PoolLeakingStep implements SearchStep {
  readonly type = 'pool-leaking';
  constructor(private readonly name: string, private readonly fixed: readonly Candidate[]) {}
  async run(state: Readonly<SearchState>) {
    const candidates = sortCandidates([...state.candidates, ...this.fixed]);
    const pool = [...this.fixed, ...this.fixed]; // duplicated, unsorted
    const refs = toRankedRefs(candidates);
    return { state: { ...state, candidates, pools: { ...state.pools, [this.name]: pool } }, trace: { stepType: this.type, params: {}, considered: refs, output: refs, pools: { [this.name]: toRankedRefs(pool) } } };
  }
}

/** A context whose emit drops every event type the predicate names (the rest is logged as usual). */
function withoutEvents(ctx: Ctx, drop: (type: string) => boolean): Ctx {
  return { ...ctx, emit: ((t: string, p: never, o: never) => (drop(t) ? (undefined as never) : ctx.emit(t as never, p, o))) as Ctx['emit'] };
}

/** SearchService: forgets to emit search.step (the log could not explain the ranking). */
export class NoTraceSearchService implements SearchService {
  private readonly inner: ScriptedSearchService;
  constructor(script: Record<string, readonly ScriptedHit[]>, currentBuild: () => BuildId) {
    this.inner = new ScriptedSearchService(script, currentBuild);
  }
  async search(ctx: Ctx, req: SearchRequest): Promise<SearchResponse> {
    return this.inner.search(withoutEvents(ctx, (t) => t === 'search.step'), req);
  }
}

/** SearchService: forgets the pipeline.started / pipeline.finished bracket (the log cannot say which machine ran). */
export class PipelinelessSearchService implements SearchService {
  private readonly inner: ScriptedSearchService;
  constructor(script: Record<string, readonly ScriptedHit[]>, currentBuild: () => BuildId) {
    this.inner = new ScriptedSearchService(script, currentBuild);
  }
  async search(ctx: Ctx, req: SearchRequest): Promise<SearchResponse> {
    return this.inner.search(withoutEvents(ctx, (t) => t.startsWith('pipeline.')), req);
  }
}

/** KgApi: drops tool.returned (an interaction without a recorded end). */
export function silentKgApi(script: FakeKgApiScript) {
  const clock = new FixedClock();
  const ids = new SeqIds();
  const log = new InMemoryEventLog(clock, ids);
  const current = { build: script.buildId };
  const dropping = {
    openSession: log.openSession.bind(log),
    append(e: EventDraft): EventEnvelope {
      if (e.type === 'tool.returned') return { ...e, id: 'ev_00000000000000000000000000', seq: 0, ts: '', schemaVersion: 1 } as EventEnvelope;
      return log.append(e);
    },
  };
  return { api: createKgApi({ log: dropping, clock, ids, currentBuild: () => current.build }, fakeHandlers(script, log, current)), log };
}

/** IdGen: repeats itself. */
export class RepeatingIds implements IdGen {
  ulid(prefix: Parameters<IdGen['ulid']>[0]) {
    return prefix + '0'.repeat(25) + '1';
  }
}

const EAGER_INGEST_TOPOLOGY = '0000000000000000';

/**
 * IngestService: a naive ingest that writes the doc version and moves the current pointer before
 * embedding, never consults the artifact cache, and cannot import artifacts.
 */
export class EagerIngestService implements IngestService {
  constructor(
    private readonly d: { store: CorpusStore; parser: Parser; chunker: Chunker; embedder: Embedder; config: DatabaseConfig; chunkView: ChunkViewRenderer },
    /** false (default): the chunk view is ignored, which is the defect the chunkView scenario catches */
    private readonly applyView = false,
  ) {}
  async ingest(ctx: Ctx, req: IngestRequest): Promise<IngestReport> {
    ctx.emit('pipeline.started', { pipeline: 'ingest', machine: 'ingest', version: '1', topology: EAGER_INGEST_TOPOLOGY, recipeId: null });
    try {
      const out = await this.run(ctx, req);
      ctx.emit('pipeline.finished', { pipeline: 'ingest', status: 'done', state: 'done' });
      return out;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      ctx.emit('pipeline.finished', { pipeline: 'ingest', status: 'failed', state: 'failed', error: { code: errorCodeOf(e), message } });
      throw e;
    }
  }
  private async run(ctx: Ctx, req: IngestRequest): Promise<IngestReport> {
    const { store, parser, chunker, embedder, config } = this.d;
    if (!req.sources) throw new KgError('not_implemented', 'artifact import not supported');
    const parseRid = store.putRecipe(config.parseRecipe);
    const chunkRid = store.putRecipe(config.chunkRecipe);
    const space = store.putSpace(config.space);
    const searchRid = store.putRecipe(config.searchRecipe);
    const docs: IngestReport['docs'] = [];
    for (const s of req.sources) {
      const docKey = (s.docKey ?? defaultDocKey(s.path)) as DocKey;
      const { sha256 } = await parser.identify(s.path);
      ctx.emit('ingest.started', { docKey, source: { kind: 'file', path: s.path }, sourceSha256: sha256, parseRecipeId: parseRid, chunkRecipeId: chunkRid });
      const a = await parser.parse({ path: s.path, docKey, sha256 }, config.parseRecipe);
      const aid = store.putArtifact(a);
      ctx.emit('ingest.parsed', { docKey, artifactId: aid, origin: 'parsed', stats: a.stats });
      const drafts = chunker(a, docKey, config.chunkRecipe);
      const v = { id: docVersionId(docKey, aid, chunkRid), docKey, artifactId: aid, chunkRecipeId: chunkRid, chunkIds: drafts.map((c) => c.id) };
      const r = store.putDocVersion(v, drafts);
      store.setCurrentDocVersion(docKey, v.id);
      ctx.emit('ingest.chunked', { docKey, docVersionId: v.id, chunkCount: drafts.length, inserted: r.inserted.length, reused: r.reused.length, dropped: 0 });
      const missing = store.missingEmbeddings(space, v.chunkIds);
      const vecs = await embedder.embed(missing.map((id) => ((x) => renderDocument(config.space, this.applyView ? { ...x, text: this.d.chunkView(a, x.blockRefs, x.text, config.space.formulaView) } : x))(drafts.find((x) => x.id === id)!)));
      store.putEmbeddings(space, missing.map((id, i) => ({ itemId: id, vector: vecs[i]! })));
      ctx.emit('ingest.embedded', { docKey, spaceId: space, embedded: missing.length, skipped: v.chunkIds.length - missing.length, elapsedMs: 0 });
      ctx.emit('ingest.completed', { docKey, docVersionId: v.id, unchanged: false });
      docs.push({ docKey, docVersionId: v.id, unchanged: false, inserted: r.inserted.length, reused: r.reused.length, dropped: 0 });
    }
    const prev = store.currentBuild();
    const b = composeBuild({ docVersions: store.currentDocVersions(), parseRecipeOf: (x) => recipeId(store.getArtifact(x)!.recipe), spaceIds: [spaceId(config.space)], searchRecipeId: searchRid, parentId: prev });
    const id = store.putBuild({ parentId: b.parentId, manifest: b.manifest, itemIds: b.itemIds });
    store.setCurrentBuild(id);
    ctx.emit('build.created', { buildId: id, parentId: prev, mixedRecipes: b.manifest.mixedRecipes, itemCount: b.itemIds.length }, { buildId: id });
    return { docs, buildId: id, buildChanged: id !== prev };
  }
}

/** IngestService: the eager ingest without its pipeline.started / pipeline.finished bracket. */
export class PipelinelessIngestService extends EagerIngestService {
  override async ingest(ctx: Ctx, req: IngestRequest): Promise<IngestReport> {
    return super.ingest(withoutEvents(ctx, (t) => t.startsWith('pipeline.')), req);
  }
}

/** MachineMap: the final state 'failed' is renamed 'halted' (valid as a map, but no 'failed' final). */
export function mapWithoutFailedFinal(map: MachineMap): MachineMap {
  const m = structuredClone(map);
  for (const n of m.nodes) if (n.id === 'failed') n.id = 'halted';
  for (const e of m.edges) if (e.to === 'failed') e.to = 'halted';
  return m;
}
/** MachineMap: adds a work state that nothing moves to (it still has moves out, so the map stays structurally valid). */
export function mapWithUnreachableNode(map: MachineMap): MachineMap {
  const m = structuredClone(map);
  m.nodes.push({ id: 'orphan', parent: null, kind: 'work', label: 'orphan', logs: ['search.step'], step: 'rerank', loop: false });
  m.edges.push({ from: 'orphan', to: 'cut', event: 'done', guard: null }, { from: 'orphan', to: 'failed', event: 'error', guard: null });
  return m;
}
/** MachineMap: the work state 'cut' has no step name. */
export function mapWithSteplessWork(map: MachineMap): MachineMap {
  const m = structuredClone(map);
  const cut = m.nodes.find((n) => n.id === 'cut')!;
  cut.step = null;
  return m;
}

/** Log: the first search.step names a state that is not in the map. */
export function logWithStrayStep(events: EventEnvelope[]): EventEnvelope[] {
  const out = structuredClone(events);
  const step = out.find((e): e is EventEnvelope<'search.step'> => e.type === 'search.step')!;
  step.payload.trace.state = 'rank';
  return out;
}
/** Log: the run never records pipeline.finished, so its last pipeline event is a search.step. */
export function logWithoutFinish(events: EventEnvelope[]): EventEnvelope[] {
  return events.filter((e) => e.type !== 'pipeline.finished');
}

/** Log: an event type no work node of the map declares (a state that logs without saying so in its map entry). */
export function logWithUndeclaredEvent(events: EventEnvelope[]): EventEnvelope[] {
  const out = structuredClone(events);
  const i = out.findIndex((e) => e.type === 'pipeline.finished');
  const base = out[i]!;
  out.splice(i, 0, { ...base, type: 'items.fetched', payload: { itemIds: [] } } as unknown as EventEnvelope);
  return out;
}
/** MachineMap: the work states no longer declare the events they log (their logs are emptied but the nodes stay work). */
export function mapWithoutDeclaredLogs(map: MachineMap): MachineMap {
  const m = structuredClone(map);
  for (const n of m.nodes) n.logs = [];
  return m;
}
