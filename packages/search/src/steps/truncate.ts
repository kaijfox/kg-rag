import { defineSearchModule, sortCandidates, type SearchStep } from '@kg/core';

export interface TruncateParams {
  /** default: the request's k */
  k?: number;
}

/** Keeps the top k candidates by the core ordering. Pools and everything else pass through unchanged. */
export const truncateModule = defineSearchModule<TruncateParams>(
  { name: 'truncate', version: '1', reads: ['candidates'], writes: ['candidates'] },
  async (state, _env, p) => {
    const k = p.k ?? state.k;
    return { patch: { candidates: sortCandidates(state.candidates).slice(0, k) }, trace: { params: { k } } };
  },
);

export const truncate = (p: TruncateParams): SearchStep => truncateModule.make(p);
