/**
 * Search pipeline contract.
 *
 * A search is run by a hand-written state machine named in the search recipe (`SearchRecipeSpec.spec.machine`, with
 * typed settings and a topology pin). Each state that does work calls one `SearchStep` and logs it: the search
 * service emits `query`, then `pipeline.started`, then one `search.step` per step run with that step's StepTrace
 * (`state` names the machine state that ran it), then `pipeline.finished`, then `search.result`. A loop is a move
 * back to an earlier state, so the same state can appear in several traces; `stepIndex` counts executions.
 * Steps are pure with respect to logging: they receive a state and return a new state plus a trace.
 * A step must not mutate its input state.
 * Retrieval steps MERGE into the existing candidates: output = fuseMax(existing candidates + retrieved candidates),
 * never a replacement, so re-running a retrieval step on its own output is idempotent.
 * `considered` must contain every candidate of the input state (the previous step's output): a step logs what it
 * was given plus what it found, before its own cut.
 *
 * Named pools. `SearchState.pools` holds named side lists of candidates that are NOT the current ranking.
 * - A pool is a Candidate[] that is unique per itemId (fuseMax within the pool) and ordered by sortCandidates().
 *   Names are non-empty strings. A pool is not a QueryVariant list and has no meaning beyond its name.
 * - `pools` is `{}` until a step writes one. Steps that do not read or write pools pass `state.pools` through
 *   unchanged (same names, same lists); they never drop or rewrite a pool they did not write.
 * - A retrieval step configured to write into a pool retrieves exactly as without, but MERGES the hits into
 *   `pools[name]` (output pool = fuseMax(existing pool + hits), so a re-run is idempotent) and does NOT touch
 *   `candidates`: output candidates equal input candidates.
 * - Trace: a step that reads or writes pools sets `StepTrace.pools` to the ranked refs of those pools AFTER the
 *   step (name -> RankedRef[], same shape as considered/output). `considered` and `output` are about
 *   `candidates` only, as always.
 * - A pool never leaves the search: the final result is cut from `candidates` only.
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
  /** named candidate pools: side lists written by retrieval into a named pool, read by a later step; {} in v0 */
  pools: Record<string, Candidate[]>;
  /** reserved scratch area (e.g. a critique's draft answer); {} in v0 */
  notes: JsonObject;
}

export interface StepTrace {
  /** execution counter within the search, contiguous from 0; exceeds the number of states when a loop runs */
  stepIndex: number;
  /** id of the machine state that ran this step; the viewer maps the trace onto that state of the MachineMap */
  state: string;
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
  /** pools this step read or wrote, as they are after the step: name -> ranked refs */
  pools?: Record<string, RankedRef[]>;
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
  ): Promise<{ state: SearchState; trace: Omit<StepTrace, 'stepIndex' | 'state' | 'durationMs'> }>;
}

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
