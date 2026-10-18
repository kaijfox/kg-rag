/**
 * Search pipeline contract.
 *
 * A search recipe is a linear list of steps. The runner (package `search`) is the only code that emits
 * search events: `query`, then one `search.step` per step with that step's StepTrace, then `search.result`.
 * Steps are pure with respect to logging: they receive a state and return a new state plus a trace.
 * A step must not mutate its input state.
 * Retrieval steps (P-2b, R-25) MERGE into the existing candidates: output = fuseMax(existing candidates +
 * retrieved candidates), never a replacement, so re-running a retrieval step on its own output is idempotent.
 * `considered` must contain every candidate of the input state (the previous step's output): a step logs what it
 * was given plus what it found, before its own cut.
 */
import type { BuildId, ChunkId, ItemId, NodeId, RecipeId, SpaceId } from '../ids';
import type { EmbeddingSpaceSpec, ItemKind, Json, JsonObject, SearchResponse } from '../model';
import type { RankedRef } from '../scoring';
import type { CorpusStore } from './store';
import type { Embedder } from './embed';
import type { Llm } from './llm';
import type { Ctx } from './infra';

/** A query the pipeline searches with. v0 has exactly one, id "q0", origin "original". */
export interface QueryVariant {
  id: string;
  text: string;
  /** "original" or the producing step type, e.g. "rewrite" */
  origin: string;
  /** id of the variant it was derived from (decomposition, paraphrase); null for the original */
  parentId: string | null;
}

export interface Candidate {
  itemId: ItemId;
  kind: ItemKind;
  /** see scoring.ts */
  score: number;
  /** Rule 1: non-empty */
  sourceChunkIds: ChunkId[];
  /** step type that introduced or last rescored it */
  via: string;
  /** QueryVariant.id it was retrieved for; null when not query-specific (e.g. graph walk) */
  queryId: string | null;
}

/** Graph-walk seeds. Reserved: [] in v0. */
export interface Seed {
  nodeId: NodeId | null;
  itemId: ItemId | null;
  weight: number;
}

export interface SearchState {
  readonly query: string;
  readonly k: number;
  readonly buildId: BuildId;
  /** query refinement writes here; retrieval steps must iterate over all of them */
  queries: QueryVariant[];
  /** the current ranked list, ordered by sortCandidates() */
  candidates: Candidate[];
  /** reserved for graph walk; [] in v0 */
  seeds: Seed[];
  /** reserved for critique loops; v0 runner ignores it (always false) */
  done: boolean;
  /** reserved scratch area (e.g. a critique's draft answer); {} in v0 */
  notes: JsonObject;
}

export interface StepTrace {
  stepIndex: number;
  stepType: string;
  params: JsonObject;
  /** everything this step scored, before its own cut (e.g. the 100-candidate pool), ranked */
  considered: RankedRef[];
  /** what it passed on, ranked; every itemId here also appears in considered */
  output: RankedRef[];
  /** the query variants after this step, when the step reads or writes them */
  queries?: QueryVariant[];
  /** seeds after this step, when the step reads or writes them */
  seeds?: Seed[];
  /** free slot for step-specific detail (rewrite prompts, walk parameters, timings of sub-calls) */
  details?: Json;
  durationMs: number;
}

/** Read access a step may use. Additive: later layers add fields (graph reads, reranker). */
export interface StepEnv {
  store: Pick<CorpusStore, 'knn' | 'getItems' | 'itemsBySourceChunk'>;
  embedder: Embedder;
  space: EmbeddingSpaceSpec & { id: SpaceId };
  llm?: Llm;
}

export interface SearchStep {
  readonly type: string;
  run(
    state: Readonly<SearchState>,
    env: StepEnv,
  ): Promise<{ state: SearchState; trace: Omit<StepTrace, 'stepIndex' | 'durationMs'> }>;
}
export type StepFactory = (params: JsonObject) => SearchStep;

export interface SearchRequest {
  query: string;
  k: number;
  searchRecipeId?: RecipeId;
  /** default: the current build */
  buildId?: BuildId;
}

export interface SearchService {
  search(ctx: Ctx, req: SearchRequest): Promise<SearchResponse>;
}

/** Default trace pool: the "ranked low" pre-check reads gold ranks up to this depth from the log alone. */
export const DEFAULT_POOL = 100;
