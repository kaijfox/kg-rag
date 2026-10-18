/**
 * Plain search steps shared by BOTH designs (runner and machines). A step is state-in/state-out and knows
 * nothing about either orchestration. vector-knn here adds the P-1 `into` param that the skeleton lacks.
 */
import {
  DEFAULT_POOL, KgError, fuseMax, renderQuery, sortCandidates, toRankedRefs,
  type Candidate, type ItemKind, type JsonObject, type QueryVariant, type RankedRef, type SearchState, type SearchStep, type StepEnv, type StepTrace, type StepFactory,
} from '@kg/core';

const intParam = (p: JsonObject, k: string, dflt: number) => {
  const v = p[k] ?? dflt;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) throw new KgError('invalid_input', `step param ${k} must be a positive integer`);
  return v;
};
const keep = (s: SearchState, over: Partial<SearchState>): SearchState => ({ ...s, queries: [...s.queries], seeds: [...s.seeds], notes: { ...s.notes }, pools: { ...s.pools }, ...over });
const poolRefs = (pools: Record<string, Candidate[]>, names: string[]) => Object.fromEntries(names.map((n) => [n, toRankedRefs(pools[n] ?? [])])) as Record<string, RankedRef[]>;

/** vector-knn {pool, kinds, into?}: P-2b merge into candidates, or P-1 merge into the named pool(s). */
export const vectorKnn: StepFactory = (params) => {
  const pool = intParam(params, 'pool', DEFAULT_POOL);
  const kinds = (params['kinds'] ?? ['chunk']) as ItemKind[];
  const into = typeof params['into'] === 'string' ? params['into'] : null;
  return {
    type: 'vector-knn',
    async run(state, env): Promise<{ state: SearchState; trace: Omit<StepTrace, 'stepIndex' | 'durationMs'> }> {
      const vecs = await env.embedder.embed(state.queries.map((q) => renderQuery(env.space, q.text)));
      const perQuery = new Map<string, Candidate[]>();
      state.queries.forEach((q, qi) => {
        const hits = env.store.knn({ space: env.space.id, vector: vecs[qi]!, buildId: state.buildId, kinds, limit: pool });
        const items = new Map(env.store.getItems(hits.map((h) => h.itemId)).map((i) => [i.id, i]));
        perQuery.set(q.id, hits.map((h) => { const it = items.get(h.itemId)!; return { itemId: h.itemId, kind: it.kind, score: h.score, sourceChunkIds: [...it.sourceChunkIds], via: 'vector-knn', queryId: q.id }; }));
      });
      if (!into) {
        const fused = fuseMax([...state.candidates, ...[...perQuery.values()].flat()]);
        return { state: keep(state, { candidates: fused }), trace: { stepType: 'vector-knn', params: { pool, kinds: kinds as string[] }, considered: toRankedRefs(fused), output: toRankedRefs(fused), queries: [...state.queries] } };
      }
      const pools = { ...state.pools };
      const written: string[] = [];
      const split = into.includes('{queryId}');
      for (const [qid, hits] of perQuery) {
        const name = split ? into.replaceAll('{queryId}', qid) : into;
        pools[name] = fuseMax([...(pools[name] ?? []), ...hits]);
        if (!written.includes(name)) written.push(name);
      }
      const cands = toRankedRefs(state.candidates);
      return { state: keep(state, { pools }), trace: { stepType: 'vector-knn', params: { pool, kinds: kinds as string[], into }, considered: cands, output: cands, queries: [...state.queries], pools: poolRefs(pools, written) } };
    },
  };
};

export const truncate: StepFactory = (params) => ({
  type: 'truncate',
  async run(state) {
    const k = params['k'] === undefined ? state.k : intParam(params, 'k', state.k);
    const sorted = sortCandidates(state.candidates);
    const candidates = sorted.slice(0, k);
    return { state: keep(state, { candidates }), trace: { stepType: 'truncate', params: { k }, considered: toRankedRefs(sorted), output: toRankedRefs(candidates) } };
  },
});

/** fuse {from, rrfK?}: contract text of core 0.3.0 (RRF over named pools; missing pool -> invalid_input; replaces candidates). */
export const fuse: StepFactory = (params) => {
  const from = (params['from'] ?? []) as string[];
  const rrfK = intParam(params, 'rrfK', 60);
  return {
    type: 'fuse',
    async run(state) {
      for (const n of from) if (!state.pools[n]) throw new KgError('invalid_input', `fuse: no pool ${n}`);
      const acc = new Map<string, Candidate & { score: number }>();
      for (const n of from)
        state.pools[n]!.forEach((c, i) => {
          const cur = acc.get(c.itemId);
          const add = 1 / (rrfK + i + 1);
          acc.set(c.itemId, cur ? { ...cur, score: cur.score + add } : { ...c, score: add, via: 'fuse', queryId: null });
        });
      const candidates = sortCandidates([...acc.values()]);
      return { state: keep(state, { candidates }), trace: { stepType: 'fuse', params: { from, rrfK }, considered: toRankedRefs(candidates), output: toRankedRefs(candidates), pools: poolRefs(state.pools, from) } };
    },
  };
};

const addVariants = (state: SearchState, origin: string, texts: string[]): QueryVariant[] => {
  const have = new Set(state.queries.map((q) => q.text));
  const out = [...state.queries];
  for (const t of texts) if (!have.has(t)) out.push({ id: `q${out.length}`, text: t, origin, parentId: 'q0' });
  return out;
};
const askJson = async (env: StepEnv, purpose: string, model: string, prompt: string): Promise<unknown> => {
  if (!env.llm) throw new KgError('precondition', `${purpose} needs an llm`);
  const r = await env.llm.complete({ purpose, model, system: purpose, messages: [{ role: 'user', content: prompt }], temperature: 0, maxTokens: 300, json: true });
  try { return JSON.parse(r.text); } catch { throw new KgError('upstream', `${purpose}: model answered non-JSON`); }
};

/** decompose {model, maxSubqueries}: LLM splits the query; sub-questions become variants q1.. (origin decompose). */
export const decompose: StepFactory = (params) => {
  const model = String(params['model']); const max = intParam(params, 'maxSubqueries', 3);
  return {
    type: 'decompose',
    async run(state, env) {
      const subs = ((await askJson(env, 'decompose', model, state.query)) as { subqueries: string[] }).subqueries.slice(0, max);
      const queries = addVariants(state, 'decompose', subs);
      const cands = toRankedRefs(state.candidates);
      return { state: keep(state, { queries }), trace: { stepType: 'decompose', params: { model, maxSubqueries: max }, considered: cands, output: cands, queries } };
    },
  };
};

/** critique {model, maxNewQueries}: LLM judges the candidates; proposes follow-up queries or sets done. */
export const critique: StepFactory = (params) => {
  const model = String(params['model']); const max = intParam(params, 'maxNewQueries', 2);
  return {
    type: 'critique',
    async run(state, env) {
      const top = env.store.getItems(sortCandidates(state.candidates).slice(0, 5).map((c) => c.itemId)).map((i) => i.text.slice(0, 80));
      const ans = (await askJson(env, 'critique', model, JSON.stringify({ q: state.query, top }))) as { sufficient: boolean; newQueries: string[] };
      const queries = ans.sufficient ? state.queries : addVariants(state, 'critique', ans.newQueries.slice(0, max));
      const done = ans.sufficient || queries.length === state.queries.length;
      const round = ((state.notes['round'] as number | undefined) ?? 0) + 1;
      const cands = toRankedRefs(state.candidates);
      return { state: keep(state, { queries, done, notes: { ...state.notes, round } }), trace: { stepType: 'critique', params: { model, maxNewQueries: max }, considered: cands, output: cands, queries, details: { round, sufficient: ans.sufficient } } };
    },
  };
};

/** rerank {weight}: deterministic lexical-overlap rescoring of the current candidates (stand-in for a cross-encoder). */
export const rerank: StepFactory = (params) => {
  const weight = Number(params['weight'] ?? 0.05);
  return {
    type: 'rerank',
    async run(state, env) {
      const words = new Set(state.query.toLowerCase().split(/\W+/).filter(Boolean));
      const texts = new Map(env.store.getItems(state.candidates.map((c) => c.itemId)).map((i) => [i.id, i.text.toLowerCase()]));
      const candidates = sortCandidates(state.candidates.map((c) => ({ ...c, via: 'rerank', score: c.score + weight * [...words].filter((w) => texts.get(c.itemId)!.includes(w)).length })));
      return { state: keep(state, { candidates }), trace: { stepType: 'rerank', params: { weight }, considered: toRankedRefs(candidates), output: toRankedRefs(candidates) } };
    },
  };
};

export const STEPS: Record<string, StepFactory> = { 'vector-knn': vectorKnn, truncate, fuse, decompose, critique };
export type { SearchStep };
