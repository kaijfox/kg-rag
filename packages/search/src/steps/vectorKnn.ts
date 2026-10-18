import {
  KgError,
  fuseMax,
  renderQuery,
  sortCandidates,
  toRankedRefs,
  type Candidate,
  type ItemId,
  type ItemKind,
  type JsonObject,
  type SearchStep,
} from '@kg/core';

export interface VectorKnnParams {
  /** candidates kept per query variant */
  pool: number;
  kinds: ItemKind[];
  /** name of a pool to write into; `{queryId}` in the name expands per variant */
  into?: string;
}

const PLACEHOLDER = '{queryId}';

/**
 * Vector retrieval. Embeds every query variant in one call, runs a knn per variant, and merges the hits.
 * Without `into` the hits fuse with the current candidates; with `into` they fuse into named pools and the
 * candidates are left as they are.
 */
export function vectorKnn(p: VectorKnnParams): SearchStep {
  return {
    type: 'vector-knn',
    async run(state, env) {
      const queries = state.queries;
      const vectors = queries.length === 0 ? [] : await env.embedder.embed(queries.map((q) => renderQuery(env.space, q.text)));
      const rows = queries.map((q, i) => ({
        queryId: q.id,
        hits: env.store.knn({ space: env.space.id, vector: vectors[i]!, buildId: state.buildId, kinds: p.kinds, limit: p.pool }),
      }));

      const ids: ItemId[] = [...new Set(rows.flatMap((r) => r.hits.map((h) => h.itemId)))];
      const items = new Map(env.store.getItems(ids).map((i) => [i.id as ItemId, i]));
      const retrieved = rows.map((r) =>
        r.hits.map((h): Candidate => {
          const item = items.get(h.itemId);
          if (!item) throw new KgError('internal', `knn returned ${h.itemId}, which the store does not return`);
          return { itemId: h.itemId, kind: item.kind, score: h.score, sourceChunkIds: [...item.sourceChunkIds], via: 'vector-knn', queryId: r.queryId };
        }),
      );

      const params: JsonObject = { pool: p.pool, kinds: p.kinds, ...(p.into !== undefined ? { into: p.into } : {}) };
      const base = { queries: [...state.queries], seeds: [...state.seeds], notes: { ...state.notes } };

      if (p.into === undefined) {
        const candidates = fuseMax([...state.candidates, ...retrieved.flat()]);
        const refs = toRankedRefs(candidates);
        return {
          state: { ...state, ...base, pools: { ...state.pools }, candidates },
          trace: { stepType: 'vector-knn', params, considered: refs, output: refs, queries: [...state.queries] },
        };
      }

      const bucket = new Map<string, Candidate[]>();
      const add = (name: string, cs: Candidate[]) => bucket.set(name, [...(bucket.get(name) ?? []), ...cs]);
      if (p.into.includes(PLACEHOLDER)) {
        rows.forEach((r, i) => add(p.into!.split(PLACEHOLDER).join(r.queryId), retrieved[i]!));
      } else {
        add(p.into, retrieved.flat());
      }
      const pools: Record<string, Candidate[]> = { ...state.pools };
      const tracePools: Record<string, ReturnType<typeof toRankedRefs>> = {};
      for (const [name, cs] of bucket) {
        pools[name] = fuseMax([...(state.pools[name] ?? []), ...cs]);
        tracePools[name] = toRankedRefs(pools[name]);
      }
      const candidates = sortCandidates(state.candidates);
      const refs = toRankedRefs(candidates);
      return {
        state: { ...state, ...base, pools, candidates },
        trace: { stepType: 'vector-knn', params, considered: refs, output: refs, queries: [...state.queries], pools: tracePools },
      };
    },
  };
}
