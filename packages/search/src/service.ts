import {
  KgError,
  sortCandidates,
  type BuildId,
  type CorpusStore,
  type Ctx,
  type Embedder,
  type Llm,
  type Recipe,
  type SearchId,
  type SearchRequest,
  type SearchResponse,
  type SearchResult,
  type SearchService,
  type SearchState,
  type StepEnv,
} from '@kg/core';
import { runPipeline } from '@kg/pipeline';
import { searchMachines, type SearchMachineEntry } from './registry';
import type { SearchRun } from './machines/kit';

export interface SearchDeps {
  store: CorpusStore;
  embedder: Embedder;
  llm?: Llm;
}

/** The search service: resolves the build and recipe, checks the machine, runs it, and logs the search. */
export function createSearch(d: SearchDeps): SearchService {
  return {
    search: (ctx, req) => runSearch(d, ctx, req),
  };
}

/** The machine a recipe names, checked against the registry: name, version, topology and settings. */
function resolveMachine(recipe: Recipe): { entry: SearchMachineEntry; settings: unknown } {
  const spec = recipe.spec;
  const machine = typeof spec.machine === 'string' ? spec.machine : '';
  const key = `${machine}@${recipe.version}`;
  if (!Object.hasOwn(searchMachines, key)) throw new KgError('invalid_input', `unknown search machine ${machine}@${recipe.version}`);
  const entry = searchMachines[key]!;
  if (spec.topology !== entry.topology) {
    throw new KgError('invalid_input', `machine ${machine}@${recipe.version} no longer has the topology this recipe was made for`);
  }
  return { entry, settings: entry.parseSettings(spec.settings) };
}

async function runSearch(d: SearchDeps, ctx: Ctx, req: SearchRequest): Promise<SearchResponse> {
  const { store, embedder } = d;

  const buildId: BuildId | null = req.buildId ?? store.currentBuild();
  if (buildId === null) throw new KgError('precondition', 'there is no current build to search');
  const build = store.getBuild(buildId);
  if (!build) throw new KgError('not_found', `build ${buildId} not found`);

  const recipe = store.getRecipe(req.searchRecipeId ?? build.manifest.searchRecipeId);
  if (!recipe || recipe.kind !== 'search') throw new KgError('not_found', `search recipe ${req.searchRecipeId ?? build.manifest.searchRecipeId} not found`);

  const spaceId = build.manifest.embeddingSpaces[0];
  if (spaceId === undefined) throw new KgError('precondition', `build ${buildId} has no embedding space`);
  const space = store.getSpace(spaceId);
  if (!space) throw new KgError('not_found', `embedding space ${spaceId} not found`);
  if (embedder.model !== space.model || embedder.dims !== space.dims) {
    throw new KgError('precondition', `the embedder serves ${embedder.model} (${embedder.dims} dims), build ${buildId} needs ${space.model} (${space.dims} dims)`);
  }

  const { entry, settings } = resolveMachine(recipe);

  const searchId = ctx.ids.ulid('sr_') as SearchId;
  const tag = { searchId, buildId };
  ctx.emit('query', { query: req.query, k: req.k, searchRecipeId: recipe.id }, tag);

  const env: StepEnv = { store, embedder, space: { ...space, id: spaceId }, ...(d.llm !== undefined ? { llm: d.llm } : {}) };
  const run: SearchRun = { env, ctx, tag, nextIndex: 0 };
  const state: SearchState = {
    query: req.query,
    k: req.k,
    buildId,
    queries: [{ id: 'q0', text: req.query, origin: 'original', parentId: null }],
    candidates: [],
    seeds: [],
    pools: {},
    notes: {},
  };
  const final = (await runPipeline(entry.machine, { run, state, settings } as never, {
    run: { ctx, tag },
    identity: { pipeline: 'search', machine: entry.name, version: entry.version, topology: entry.topology, recipeId: recipe.id },
  })) as SearchState;

  const top = sortCandidates(final.candidates).slice(0, req.k);
  const texts = new Map(store.getItems(top.map((c) => c.itemId)).map((i) => [i.id as string, i.text]));
  const items: SearchResult[] = top.map((c, i) => {
    const text = texts.get(c.itemId);
    if (text === undefined) throw new KgError('internal', `candidate ${c.itemId} is not in the store`);
    return { itemId: c.itemId, kind: c.kind, text, score: c.score, rank: i + 1, sourceChunkIds: [...c.sourceChunkIds] };
  });
  const stale = store.staleCheck(buildId).stale;
  ctx.emit(
    'search.result',
    { items: items.map(({ itemId, kind, rank, score, sourceChunkIds }) => ({ itemId, kind, rank, score, sourceChunkIds })), stale },
    tag,
  );
  return { searchId, buildId, stale, items };
}
