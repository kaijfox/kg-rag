import { describe, expect, it } from 'vitest';
import { canonicalJson, recipeId, sha256hex, KgError, type Json, type RecipeSpec } from '@kg/core';
import { MACHINES, define, fingerprint, machineExecutor, machineRecipe, type MachineDef } from '../src/machines';
import { STEPS, critique, rerank, truncate, vectorKnn } from '../src/steps';
import { runnerExecutor } from '../src/runner';
import { searchWith, stripRecipe } from './helpers';
import { QueryLlmFactory } from './llm';

const Q = 'how does entropy relate to Carnot efficiency of a heat engine';
const settings = { model: 'm', maxRounds: 2 };
const id = (r: unknown) => recipeId(r as RecipeSpec);

describe('3. recipe identity = machine + version + settings (+ topology)', () => {
  it('is stable and sensitive to settings, machine version and topology', () => {
    const r1 = machineRecipe('critique-loop', settings);
    expect(id(r1)).toBe(id(machineRecipe('critique-loop', { maxRounds: 2, model: 'm' }))); // key order irrelevant (canonical JSON)
    expect(id(r1)).toBe('rc_' + id(r1).slice(3));
    expect(id(machineRecipe('critique-loop', { ...settings, maxRounds: 3 }))).not.toBe(id(r1));
    expect(id({ ...r1, version: 'critique-loop/2' })).not.toBe(id(r1));
    expect(id(machineRecipe('decompose-fuse', settings))).not.toBe(id(r1));
    console.log('recipe ids', id(r1), fingerprint('critique-loop'));
  });

  it('a topology change without a version bump is rejected at run time (old recipe, new machine)', async () => {
    const r = machineRecipe('critique-loop', { model: 'm', maxRounds: 1 });
    const changed: MachineDef = { version: MACHINES['critique-loop']!.version, build: (s, run) => {
      const { stage, make } = define(run, {});
      return make({ retrieve: stage(vectorKnn, { pool: 50, kinds: ['chunk'] }, 'cut'), cut: stage(truncate, {}, 'done'), done: { type: 'final' } }, 'retrieve'); // someone "simplified" it
    } };
    expect(fingerprint('critique-loop', changed)).not.toBe(r.spec.topology);
    const res = await searchWith(machineExecutor({ ...MACHINES, 'critique-loop': changed }), r, Q, 3, QueryLlmFactory({ critique: [{ sufficient: true, newQueries: [] }] }));
    expect((res.error as KgError).message).toMatch(/no longer has the topology/);
  });

  it('a behaviour change that keeps the topology (a guard body) is NOT in the fingerprint: only the golden run catches it', async () => {
    const orig = MACHINES['critique-loop']!;
    const mutated: MachineDef = { version: orig.version, build: (s, run) => {
      const { stage, route, make } = define(run, { budget: (c) => c.round <= 2 /* was < */, satisfied: (c) => c.state.done });
      return make({
        retrieve: stage(vectorKnn, { pool: 50, kinds: ['chunk'] }, 'review'),
        review: route({ guard: 'budget', target: 'critique' }, { target: 'cut' }),
        critique: stage(critique, { model: String(s['model']), maxNewQueries: 2 }, 'verdict', (c) => ({ round: c.round + 1 })),
        verdict: route({ guard: 'satisfied', target: 'cut' }, { target: 'retrieve' }),
        cut: stage(truncate, {}, 'done'),
        done: { type: 'final' },
      }, 'retrieve');
    } };
    expect(fingerprint('critique-loop', mutated)).toBe(fingerprint('critique-loop', orig)); // same topology, same recipe id
    const golden = async (exec: ReturnType<typeof machineExecutor>) => {
      const llm = QueryLlmFactory({ critique: Array.from({ length: 5 }, (_, i) => ({ sufficient: false, newQueries: [`Carnot cycle step ${i}`] })) });
      const r = await searchWith(exec, machineRecipe('critique-loop', { model: 'm', maxRounds: 2 }), Q, 4, llm);
      return sha256hex(canonicalJson(stripRecipe(r.events) as unknown as Json)).slice(0, 12);
    };
    const g0 = await golden(machineExecutor());
    const g1 = await golden(machineExecutor({ ...MACHINES, 'critique-loop': mutated }));
    expect(g1).not.toBe(g0);
    console.log('golden critique-loop/1', g0, 'mutated', g1);
  });

  it('the runner has the same blind spot for a STEP implementation change (recipe id unchanged), caught by the same golden run', async () => {
    const r: RecipeSpec = { kind: 'search', version: 'x', spec: { steps: [{ type: 'vector-knn', params: { pool: 50, kinds: ['chunk'] } }, { type: 'truncate', params: {} }] } };
    const patched = { ...STEPS, truncate: (p: never) => { const s = truncate(p); return { ...s, run: async (st: never, e: never) => { const o = await s.run(st, e); return { ...o, state: { ...o.state, candidates: o.state.candidates.slice(0, 1) } }; } }; } };
    const a = await searchWith(runnerExecutor(STEPS), r, Q, 3);
    const b = await searchWith(runnerExecutor(patched as never), r, Q, 3);
    expect(b.res!.items.length).not.toBe(a.res!.items.length);
  });
});

describe('4. modularity: add a reranker', () => {
  const knn = { type: 'vector-knn', params: { pool: 50, kinds: ['chunk'] } };
  it('runner: recipe data + registry entry only', async () => {
    const r: RecipeSpec = { kind: 'search', version: 'knn-rerank/1', spec: { steps: [knn, { type: 'rerank', params: { weight: 0.05 } }, { type: 'truncate', params: {} }] } };
    const out = await searchWith(runnerExecutor({ ...STEPS, rerank }), r, Q, 3);
    expect(out.steps.map((t) => t.stepType)).toEqual(['vector-knn', 'rerank', 'truncate']);
  });
  it('machine: one more machine (or a bumped one) in code + registry entry + the same step', async () => {
    // --- the snippet that would be added to machines.ts (counted in results.md) ---
    const def: MachineDef = { version: 'knn-rerank-truncate/1', build: (s, run) => {
      const { stage, make } = define(run, {});
      return make({ retrieve: stage(vectorKnn, { pool: 50, kinds: ['chunk'] }, 'rerank'), rerank: stage(rerank, { weight: 0.05 }, 'cut'), cut: stage(truncate, {}, 'done'), done: { type: 'final' } }, 'retrieve');
    } };
    // ---
    const a = await searchWith(runnerExecutor({ ...STEPS, rerank }), { kind: 'search', version: 'knn-rerank/1', spec: { steps: [knn, { type: 'rerank', params: { weight: 0.05 } }, { type: 'truncate', params: {} }] } }, Q, 3);
    const reg = { ...MACHINES, 'knn-rerank-truncate': def };
    const recipe = { kind: 'search' as const, version: def.version, spec: { machine: 'knn-rerank-truncate', settings: {}, topology: fingerprint('x', def) } };
    const b = await searchWith(machineExecutor(reg), recipe, Q, 3);
    expect(b.error).toBeUndefined();
    expect(b.res!.items).toEqual(a.res!.items);
    expect(b.steps.map((t) => t.stepType)).toEqual(['vector-knn', 'rerank', 'truncate']);
  });
});
