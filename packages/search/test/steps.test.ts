import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_CHUNK_RECIPE, KgError, type Candidate, type CorpusStore, type Embedder, type SearchState, type StepEnv } from '@kg/core';
import { FixedClock, HashEmbedder, InMemoryEventLog, SeqIds, loadMiniCorpus, type MiniCorpus } from '@kg/testkit';
import { createSearch, truncate, vectorKnn } from '../src/index';

let mc: MiniCorpus;
let env: StepEnv;
let base: SearchState;
beforeAll(async () => {
  mc = await loadMiniCorpus();
  const space = mc.store.getSpace(mc.store.getBuild(mc.builds.v1)!.manifest.embeddingSpaces[0]!)!;
  env = { store: mc.store, embedder: mc.embedder, space: { ...space, id: mc.store.getBuild(mc.builds.v1)!.manifest.embeddingSpaces[0]! } } as StepEnv;
  base = {
    query: 'entropy',
    k: 3,
    buildId: mc.builds.v1,
    queries: [
      { id: 'q0', text: 'entropy', origin: 'original', parentId: null },
      { id: 'q1', text: 'Carnot efficiency', origin: 'rewrite', parentId: 'q0' },
    ],
    candidates: [],
    seeds: [],
    pools: {},
    notes: {},
  };
});

/** A store whose knn calls are recorded. */
const spyStore = (limits: number[]): CorpusStore => {
  const spy = Object.create(mc.store) as CorpusStore;
  spy.knn = (q) => {
    limits.push(q.limit);
    return mc.store.knn(q);
  };
  return spy;
};

describe('vector-knn', () => {
  it('asks the store for exactly `pool` hits per query variant', async () => {
    const limits: number[] = [];
    const { state, trace } = await vectorKnn({ pool: 5, kinds: ['chunk'] }).run(base, { ...env, store: spyStore(limits) });
    expect(limits).toEqual([5, 5]);
    expect(trace.params).toMatchObject({ pool: 5 });
    expect(state.candidates.length).toBeGreaterThan(5);
    expect(state.candidates.length).toBeLessThanOrEqual(10);
  });

  it('marks every candidate with the variant that found it', async () => {
    const { state } = await vectorKnn({ pool: 4, kinds: ['chunk'] }).run(base, env);
    expect(state.candidates.length).toBeGreaterThan(0);
    for (const c of state.candidates) expect(['q0', 'q1']).toContain(c.queryId);
    expect(new Set(state.candidates.map((c) => c.queryId)).size).toBe(2);
  });

  it('merges new hits into an existing pool of the same name, keeping what the pool already held', async () => {
    const old: Candidate = { itemId: mc.labels['gas/pre']!, kind: 'chunk', score: -0.5, sourceChunkIds: [mc.labels['gas/pre']!], via: 'earlier', queryId: null };
    const seeded: SearchState = { ...base, pools: { hits: [old] } };
    const { state, trace } = await vectorKnn({ pool: 1, kinds: ['chunk'], into: 'hits' }).run(seeded, env);
    const ids = state.pools.hits!.map((c) => c.itemId);
    expect(ids).toContain(old.itemId);
    expect(ids.length).toBe(3);
    expect(state.candidates).toEqual([]);
    expect(trace.pools!.hits!.length).toBe(3);
  });

  it('a pool hit that the old pool also holds keeps the higher score', async () => {
    const first = await vectorKnn({ pool: 1, kinds: ['chunk'], into: 'hits' }).run(base, env);
    const top = first.state.pools.hits![0]!;
    const lowered: SearchState = { ...base, pools: { hits: [{ ...top, score: -1 }] } };
    const { state } = await vectorKnn({ pool: 1, kinds: ['chunk'], into: 'hits' }).run(lowered, env);
    expect(state.pools.hits!.find((c) => c.itemId === top.itemId)!.score).toBe(top.score);
  });
});

describe('truncate', () => {
  const seeded = async () => (await vectorKnn({ pool: 10, kinds: ['chunk'] }).run(base, env)).state;

  it('keeps exactly k candidates and records the effective k in the trace params', async () => {
    const s = await seeded();
    const own = await truncate({}).run(s, env);
    expect(own.state.candidates).toHaveLength(3);
    expect(own.trace.params).toEqual({ k: 3 });
    const set = await truncate({ k: 2 }).run(s, env);
    expect(set.state.candidates).toHaveLength(2);
    expect(set.trace.params).toEqual({ k: 2 });
    expect(set.trace.output).toHaveLength(2);
    expect(set.trace.considered!.length).toBe(s.candidates.length);
  });
});

describe('the service checks the build against its embedder and recipe', () => {
  const run = (embedder: Embedder, searchRecipeId?: Parameters<ReturnType<typeof createSearch>['search']>[1]['searchRecipeId']) => {
    const log = new InMemoryEventLog(new FixedClock(), new SeqIds());
    const s = log.openSession({ kind: 'test', label: null, meta: {} });
    const ctx = { emit: () => ({}), clock: new FixedClock(), ids: new SeqIds(), session: s } as never;
    return createSearch({ store: mc.store, embedder }).search(ctx, { query: 'entropy', k: 3, ...(searchRecipeId ? { searchRecipeId } : {}) });
  };

  it('refuses an embedder with another model name', async () => {
    const other: Embedder = { model: 'another-model', dims: mc.embedder.dims, embed: (t) => mc.embedder.embed(t) };
    await expect(run(other)).rejects.toMatchObject({ code: 'precondition' });
  });

  it('refuses an embedder with other dims', async () => {
    const other: Embedder = { model: mc.embedder.model, dims: mc.embedder.dims + 1, embed: (t) => mc.embedder.embed(t) };
    await expect(run(other)).rejects.toMatchObject({ code: 'precondition' });
  });

  it('accepts the matching embedder', async () => {
    await expect(run(new HashEmbedder(mc.embedder.dims))).resolves.toMatchObject({ items: expect.any(Array) });
  });

  it('a recipe that is not a search recipe is not_found, whatever it holds', async () => {
    const id = mc.store.putRecipe(DEFAULT_CHUNK_RECIPE);
    const err = await run(mc.embedder, id).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(KgError);
    expect((err as KgError).code).toBe('not_found');
  });
});
