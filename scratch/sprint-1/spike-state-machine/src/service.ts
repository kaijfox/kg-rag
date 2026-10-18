/** Shared search prelude/epilogue (identical in both designs; the skeleton's createSearch minus the pipeline loop). */
import {
  KgError, sortCandidates,
  type CorpusStore, type Ctx, type Embedder, type Llm, type SearchId, type SearchRequest, type SearchResponse, type SearchService,
  type SearchState, type StepEnv, type StepTrace, type RecipeSpec, type BuildId,
} from '@kg/core';

/** What an executor gets: everything a pipeline needs, nothing it must remember to log except via `emitStep`. */
export interface Run { ctx: Ctx; env: StepEnv; state: SearchState; recipe: RecipeSpec; emitStep(trace: Omit<StepTrace, 'durationMs' | 'stepIndex'>, durationMs: number): void }
export type Executor = (run: Run) => Promise<SearchState>;

export function createSearchService(d: { store: CorpusStore; embedder: Embedder; llm?: Llm; execute: Executor }): SearchService {
  return {
    async search(ctx: Ctx, req: SearchRequest): Promise<SearchResponse> {
      const buildId: BuildId | null = req.buildId ?? d.store.currentBuild();
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

      const searchId = ctx.ids.ulid('sr_') as SearchId;
      const tag = { searchId, buildId };
      ctx.emit('query', { query: req.query, k: req.k, searchRecipeId: rid }, tag);
      const env: StepEnv = { store: d.store, embedder: d.embedder, space, ...(d.llm ? { llm: d.llm } : {}) };
      const state: SearchState = { query: req.query, k: req.k, buildId, queries: [{ id: 'q0', text: req.query, origin: 'original', parentId: null }], candidates: [], seeds: [], done: false, pools: {}, notes: {} };
      let stepIndex = 0;
      const emitStep = (trace: Omit<StepTrace, 'durationMs' | 'stepIndex'>, durationMs: number) => ctx.emit('search.step', { trace: { ...trace, stepIndex: stepIndex++, durationMs } }, tag);
      const end = await d.execute({ ctx, env, state, recipe, emitStep });

      const final = sortCandidates(end.candidates).slice(0, req.k);
      const texts = new Map(d.store.getItems(final.map((c) => c.itemId)).map((i) => [i.id, i.text]));
      const items = final.map((c, i) => ({ itemId: c.itemId, kind: c.kind, text: texts.get(c.itemId) ?? '', score: c.score, rank: i + 1, sourceChunkIds: c.sourceChunkIds }));
      const stale = d.store.staleCheck(buildId).stale;
      ctx.emit('search.result', { items: items.map(({ itemId, kind, rank, score, sourceChunkIds }) => ({ itemId, kind, rank, score, sourceChunkIds })), stale }, tag);
      return { searchId, buildId, stale, items };
    },
  };
}
