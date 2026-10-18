/**
 * SKELETON search runner and v0 steps (replaced by the Phase 2 `search` package).
 * The runner is the only code that emits search events; steps are pure with respect to logging.
 */
import {
  DEFAULT_POOL,
  KgError,
  fuseMax,
  renderQuery,
  sortCandidates,
  toRankedRefs,
  type Candidate,
  type CorpusStore,
  type Ctx,
  type Embedder,
  type JsonObject,
  type Llm,
  type SearchId,
  type SearchRecipeSpec,
  type SearchRequest,
  type SearchResponse,
  type SearchService,
  type SearchState,
  type SearchStep,
  type StepEnv,
  type StepFactory,
  type ItemKind,
} from '@kg/core';

const intParam = (p: JsonObject, k: string, dflt: number) => {
  const v = p[k] ?? dflt;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) throw new KgError('invalid_input', `step param ${k} must be a positive integer`);
  return v;
};

/** vector-knn {pool, kinds}: embeds every query variant, KNN per variant restricted to the build, fused by max score. */
export const vectorKnn: StepFactory = (params) => {
  const pool = intParam(params, 'pool', DEFAULT_POOL);
  const kinds = (params['kinds'] ?? ['chunk']) as ItemKind[];
  return {
    type: 'vector-knn',
    async run(state: Readonly<SearchState>, env: StepEnv) {
      const vecs = await env.embedder.embed(state.queries.map((q) => renderQuery(env.space, q.text)));
      const all: Candidate[] = [];
      state.queries.forEach((q, qi) => {
        const hits = env.store.knn({ space: env.space.id, vector: vecs[qi]!, buildId: state.buildId, kinds, limit: pool });
        const items = new Map(env.store.getItems(hits.map((h) => h.itemId)).map((i) => [i.id, i]));
        for (const h of hits) {
          const it = items.get(h.itemId)!;
          all.push({ itemId: h.itemId, kind: it.kind, score: h.score, sourceChunkIds: [...it.sourceChunkIds], via: 'vector-knn', queryId: q.id });
        }
      });
      // P-2b: merge with the existing candidates (fuse by max), so a re-run is idempotent. considered = input
      // candidates plus everything retrieved (each variant contributes at most pool), before any cut.
      const fused = fuseMax([...state.candidates, ...all]);
      const considered = toRankedRefs(fused);
      const candidates = fused;
      return {
        state: { ...state, queries: [...state.queries], seeds: [...state.seeds], notes: { ...state.notes }, candidates },
        trace: { stepType: 'vector-knn', params: { pool, kinds }, considered, output: toRankedRefs(candidates), queries: [...state.queries] },
      };
    },
  };
};

/** truncate {k?}: keeps the first k candidates (default: the request's k). */
export const truncate: StepFactory = (params) => ({
  type: 'truncate',
  async run(state: Readonly<SearchState>) {
    const k = params['k'] === undefined ? state.k : intParam(params, 'k', state.k);
    const sorted = sortCandidates(state.candidates);
    const candidates = sorted.slice(0, k);
    return {
      state: { ...state, queries: [...state.queries], seeds: [...state.seeds], notes: { ...state.notes }, candidates },
      trace: { stepType: 'truncate', params: { k }, considered: toRankedRefs(sorted), output: toRankedRefs(candidates) },
    };
  },
});

export const V0_STEPS: Record<string, StepFactory> = { 'vector-knn': vectorKnn, truncate };

export function createSearch(d: { store: CorpusStore; embedder: Embedder; steps?: Record<string, StepFactory>; llm?: Llm }): SearchService {
  const steps = d.steps ?? V0_STEPS;
  return {
    async search(ctx: Ctx, req: SearchRequest): Promise<SearchResponse> {
      const buildId = req.buildId ?? d.store.currentBuild();
      if (!buildId) throw new KgError('precondition', 'no build: ingest something first');
      const build = d.store.getBuild(buildId);
      if (!build) throw new KgError('not_found', `build ${buildId}`);
      const rid = req.searchRecipeId ?? build.manifest.searchRecipeId;
      const recipe = d.store.getRecipe(rid);
      if (!recipe || recipe.kind !== 'search') throw new KgError('not_found', `search recipe ${rid}`);
      const spaceId = build.manifest.embeddingSpaces[0];
      const space = spaceId ? d.store.getSpace(spaceId) : null;
      if (!space) throw new KgError('not_found', `embedding space of build ${buildId}`);
      if (space.model !== d.embedder.model || space.dims !== d.embedder.dims) throw new KgError('precondition', `embedder ${d.embedder.model} does not serve space ${space.model}`);
      const plan = (recipe as unknown as SearchRecipeSpec).spec.steps.map((s) => {
        const f = steps[s.type];
        if (!f) throw new KgError('invalid_input', `unknown step type ${s.type}`);
        return f(s.params);
      });

      const searchId = ctx.ids.ulid('sr_') as SearchId;
      const tag = { searchId, buildId };
      ctx.emit('query', { query: req.query, k: req.k, searchRecipeId: rid }, tag);
      const env: StepEnv = { store: d.store, embedder: d.embedder, space, ...(d.llm ? { llm: d.llm } : {}) };
      let state: SearchState = { query: req.query, k: req.k, buildId, queries: [{ id: 'q0', text: req.query, origin: 'original', parentId: null }], candidates: [], seeds: [], done: false, notes: {} };
      for (const [i, step] of plan.entries()) {
        const t0 = ctx.clock.monotonicMs();
        const out = await (step as SearchStep).run(state, env);
        state = out.state;
        ctx.emit('search.step', { trace: { ...out.trace, stepIndex: i, durationMs: Math.max(0, ctx.clock.monotonicMs() - t0) } }, tag);
      }
      const final = sortCandidates(state.candidates).slice(0, req.k);
      const texts = new Map(d.store.getItems(final.map((c) => c.itemId)).map((i) => [i.id, i.text]));
      const items = final.map((c, i) => ({ itemId: c.itemId, kind: c.kind, text: texts.get(c.itemId) ?? '', score: c.score, rank: i + 1, sourceChunkIds: c.sourceChunkIds }));
      const stale = d.store.staleCheck(buildId).stale;
      ctx.emit('search.result', { items: items.map(({ itemId, kind, rank, score, sourceChunkIds }) => ({ itemId, kind, rank, score, sourceChunkIds })), stale }, tag);
      return { searchId, buildId, stale, items };
    },
  };
}
