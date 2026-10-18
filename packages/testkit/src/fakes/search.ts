import {
  DEFAULT_SEARCH_RECIPE,
  recipeId,
  fuseMax,
  sortCandidates,
  toRankedRefs,
  type BuildId,
  type Candidate,
  type Ctx,
  type ItemId,
  type ItemKind,
  type ChunkId,
  type SearchRequest,
  type SearchResponse,
  type SearchService,
  type SearchState,
  type SearchStep,
  type SearchId,
} from '@kg/core';

/** StaticStep: replaces state.candidates with a fixed list (sorted by the core rule). */
export class StaticStep implements SearchStep {
  readonly type = 'static';
  constructor(private readonly fixed: readonly Candidate[]) {}
  async run(state: Readonly<SearchState>) {
    const candidates = sortCandidates(this.fixed.map((c) => ({ ...c, sourceChunkIds: [...c.sourceChunkIds] })));
    const refs = toRankedRefs(candidates);
    return {
      state: { ...state, queries: [...state.queries], seeds: [...state.seeds], notes: { ...state.notes }, candidates },
      trace: { stepType: this.type, params: {}, considered: refs, output: refs },
    };
  }
}

/**
 * StaticPoolStep (P-1): the reference `into` retrieval. Merges a fixed list into pools[name] (fuseMax with the
 * existing pool, so a re-run is idempotent), leaves candidates untouched, and reports the pool in trace.pools.
 */
export class StaticPoolStep implements SearchStep {
  readonly type = 'static-pool';
  constructor(
    private readonly name: string,
    private readonly fixed: readonly Candidate[],
  ) {}
  async run(state: Readonly<SearchState>) {
    const pool = fuseMax([...(state.pools[this.name] ?? []), ...this.fixed.map((c) => ({ ...c, sourceChunkIds: [...c.sourceChunkIds] }))]);
    const pools = { ...state.pools, [this.name]: pool };
    const refs = toRankedRefs(sortCandidates(state.candidates));
    return {
      state: { ...state, queries: [...state.queries], seeds: [...state.seeds], notes: { ...state.notes }, pools, candidates: sortCandidates(state.candidates) },
      trace: { stepType: this.type, params: { into: this.name }, considered: refs, output: refs, pools: { [this.name]: toRankedRefs(pool) } },
    };
  }
}

export interface ScriptedHit {
  itemId: ItemId;
  kind: ItemKind;
  text: string;
  score: number;
  sourceChunkIds: ChunkId[];
}

/**
 * ScriptedSearchService: returns scripted hits per query and emits the canonical event sequence
 * (query, pipeline.started, one search.step, pipeline.finished, search.result) through ctx, exactly as the real
 * runner must (contract 0.6.0). It plays the similarity machine's single retrieval step.
 */
export class ScriptedSearchService implements SearchService {
  readonly searchRecipeId = recipeId(DEFAULT_SEARCH_RECIPE);
  constructor(
    private readonly script: Record<string, readonly ScriptedHit[]>,
    private readonly currentBuild: () => BuildId,
  ) {}
  async search(ctx: Ctx, req: SearchRequest): Promise<SearchResponse> {
    const searchId = ctx.ids.ulid('sr_') as SearchId;
    const buildId = req.buildId ?? this.currentBuild();
    const o = { searchId, buildId };
    const searchRecipeId = req.searchRecipeId ?? this.searchRecipeId;
    ctx.emit('query', { query: req.query, k: req.k, searchRecipeId }, o);
    ctx.emit('pipeline.started', { pipeline: 'search', machine: DEFAULT_SEARCH_RECIPE.spec.machine, version: DEFAULT_SEARCH_RECIPE.version, topology: DEFAULT_SEARCH_RECIPE.spec.topology, recipeId: searchRecipeId }, o);
    const hits = sortCandidates([...(this.script[req.query] ?? [])]);
    const considered = toRankedRefs(hits);
    const output = considered.slice(0, req.k);
    ctx.emit('search.step', { trace: { stepIndex: 0, state: 'retrieve', stepType: 'scripted', params: {}, considered, output, durationMs: 0 } }, o);
    ctx.emit('pipeline.finished', { pipeline: 'search', status: 'done', state: 'done' }, o);
    const items = hits.slice(0, req.k).map((h, i) => ({ itemId: h.itemId, kind: h.kind, text: h.text, score: h.score, rank: i + 1, sourceChunkIds: [...h.sourceChunkIds] }));
    ctx.emit(
      'search.result',
      { items: items.map(({ itemId, kind, rank, score, sourceChunkIds }) => ({ itemId, kind, rank, score, sourceChunkIds })), stale: false },
      o,
    );
    return { searchId, buildId, stale: false, items };
  }
}
