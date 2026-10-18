import { sortCandidates, toRankedRefs, type SearchStep } from '@kg/core';

export interface TruncateParams {
  /** default: the request's k */
  k?: number;
}

/** Keeps the top k candidates by the core ordering. Pools and everything else pass through unchanged. */
export function truncate(p: TruncateParams): SearchStep {
  return {
    type: 'truncate',
    async run(state) {
      const k = p.k ?? state.k;
      const input = sortCandidates(state.candidates);
      const kept = input.slice(0, k);
      return {
        state: { ...state, queries: [...state.queries], seeds: [...state.seeds], notes: { ...state.notes }, pools: { ...state.pools }, candidates: kept },
        trace: {
          stepType: 'truncate',
          params: { k },
          considered: toRankedRefs(input),
          output: toRankedRefs(kept),
        },
      };
    },
  };
}
