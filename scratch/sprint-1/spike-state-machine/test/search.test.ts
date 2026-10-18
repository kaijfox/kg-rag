import { describe, expect, it } from 'vitest';
import { recipeId, DEFAULT_SEARCH_RECIPE, type RecipeSpec, type SearchRecipeSpec } from '@kg/core';
import { miniSearchHarness, miniStepHarness } from '@kg/testkit';
import { registerSuite, searchFixtureSuite, searchServiceConformance, searchStepConformance } from '@kg/testkit/conformance';
import { createSearchService } from '../src/service';
import { runnerExecutor } from '../src/runner';
import { MACHINES, anyExecutor, machineExecutor, machineRecipe, pipelineExecutor } from '../src/machines';
import { STEPS, fuse, vectorKnn } from '../src/steps';
import { QueryLlmFactory } from './llm';
import { searchWith, stripRecipe } from './helpers';

const Q = 'how does entropy relate to Carnot efficiency of a heat engine';

// ---- acceptance: the shipped conformance suites against each design
for (const [name, execute] of [['A runner', runnerExecutor(STEPS)], ['B machine pipeline/anyExecutor', anyExecutor(STEPS)]] as const) {
  describe(name, () => {
    registerSuite(searchServiceConformance(() => miniSearchHarness((mc) => createSearchService({ store: mc.store, embedder: mc.embedder, execute }))));
    registerSuite(searchFixtureSuite((mc) => createSearchService({ store: mc.store, embedder: mc.embedder, execute })));
  });
}
registerSuite(searchStepConformance(() => miniStepHarness(vectorKnn({ pool: 100, kinds: ['chunk'] }), undefined, { retrieval: true })));
registerSuite(searchStepConformance(() => miniStepHarness(vectorKnn({ pool: 100, kinds: ['chunk'], into: 'sub:{queryId}' }), undefined, { retrieval: true, into: ['sub:q0', 'sub:q1'] })));

// ---- step 1: skeleton behaviour as a dedicated machine, event-for-event
describe('1. knn-truncate machine == skeleton runner', () => {
  it('identical event log (modulo the recipe id)', async () => {
    const a = await searchWith(runnerExecutor(STEPS), DEFAULT_SEARCH_RECIPE, Q);
    const b = await searchWith(machineExecutor(), machineRecipe('knn-truncate', { pool: 100 }), Q);
    expect(b.error).toBeUndefined();
    expect(stripRecipe(b.events)).toEqual(stripRecipe(a.events));
    expect(b.res!.items.length).toBe(3);
  });
});

const dec = (n: number) => ({ subqueries: ['entropy of an isolated system', 'Carnot efficiency of a heat engine'].slice(0, n) });
const decRunner = (from: string[]): RecipeSpec => ({ kind: 'search', version: 'decompose/1', spec: { steps: [
  { type: 'decompose', params: { model: 'm', maxSubqueries: 4 } },
  { type: 'vector-knn', params: { pool: 50, kinds: ['chunk'], into: 'sub:{queryId}' } },
  { type: 'fuse', params: { from, rrfK: 60 } },
  { type: 'truncate', params: {} },
] } });

describe('1a. decomposition with per-subquery pools + fusion', () => {
  it('runner (steps list) and machine give the same result and the same traces', async () => {
    const a = await searchWith(runnerExecutor(STEPS), decRunner(['sub:q0', 'sub:q1', 'sub:q2']), Q, 5, QueryLlmFactory({ decompose: [dec(2)] }));
    const b = await searchWith(machineExecutor(), machineRecipe('decompose-fuse', { model: 'm', maxSubqueries: 4 }), Q, 5, QueryLlmFactory({ decompose: [dec(2)] }));
    expect(a.error).toBeUndefined(); expect(b.error).toBeUndefined();
    expect(b.res!.items).toEqual(a.res!.items);
    expect(b.steps.map((t) => [t.stepType, t.considered, t.output, t.pools])).toEqual(a.steps.map((t) => [t.stepType, t.considered, t.output, t.pools]));
    expect(b.steps.map((t) => t.stepType)).toEqual(['decompose', 'vector-knn', 'fuse', 'truncate']);
  });
  it('GAP: a static fuse `from` list breaks when the LLM returns fewer sub-questions; the machine computes it', async () => {
    const llm = () => QueryLlmFactory({ decompose: [dec(1)] });
    const a = await searchWith(runnerExecutor(STEPS), decRunner(['sub:q0', 'sub:q1', 'sub:q2']), Q, 5, llm());
    expect((a.error as Error).message).toMatch(/fuse: no pool sub:q2/);
    const b = await searchWith(machineExecutor(), machineRecipe('decompose-fuse', { model: 'm', maxSubqueries: 4 }), Q, 5, llm());
    expect(b.error).toBeUndefined();
  });
});

const crit = (maxRounds: number): RecipeSpec => {
  const knn = { type: 'vector-knn', params: { pool: 50, kinds: ['chunk'] } };
  const c = { type: 'critique', params: { model: 'm', maxNewQueries: 2 } };
  const steps = [knn, ...Array.from({ length: maxRounds }, () => [c, knn]).flat(), { type: 'truncate', params: { final: true } }];
  return { kind: 'search', version: 'critique/1', spec: { steps } };
};
describe('1b. critique loop: unrolled (runner) vs real loop (machine)', () => {
  const insufficient = (n: number) => Array.from({ length: n }, (_, i) => ({ sufficient: false, newQueries: [`Carnot cycle step ${i}`] }));
  it('never satisfied: both stop at the bound with the same 6 steps and the same result', async () => {
    const mk = () => QueryLlmFactory({ critique: insufficient(3) });
    const a = await searchWith(runnerExecutor(STEPS), crit(2), Q, 4, mk());
    const b = await searchWith(machineExecutor(), machineRecipe('critique-loop', { model: 'm', maxRounds: 2 }), Q, 4, mk());
    expect(a.steps.map((t) => t.stepType)).toEqual(['vector-knn', 'critique', 'vector-knn', 'critique', 'vector-knn', 'truncate']);
    expect(b.steps.map((t) => t.stepType)).toEqual(a.steps.map((t) => t.stepType));
    expect(b.res!.items).toEqual(a.res!.items);
    expect(b.steps.map((t) => [t.considered, t.output])).toEqual(a.steps.map((t) => [t.considered, t.output]));
  });
  it('satisfied at round 1: both skip the rest and still truncate', async () => {
    const mk = () => QueryLlmFactory({ critique: [{ sufficient: true, newQueries: [] }] });
    const a = await searchWith(runnerExecutor(STEPS), crit(2), Q, 4, mk());
    const b = await searchWith(machineExecutor(), machineRecipe('critique-loop', { model: 'm', maxRounds: 2 }), Q, 4, mk());
    expect(a.steps.map((t) => t.stepType)).toEqual(['vector-knn', 'critique', 'truncate']);
    expect(b.steps.map((t) => t.stepType)).toEqual(['vector-knn', 'critique', 'truncate']);
    expect(b.res!.items).toEqual(a.res!.items);
  });
  it('the bound is a setting of one machine; the runner needs a new recipe shape per bound', () => {
    expect(recipeId(crit(2))).not.toBe(recipeId(crit(3)));
    expect(JSON.stringify(crit(2)).length).toBeGreaterThan(JSON.stringify(machineRecipe('critique-loop', { model: 'm', maxRounds: 2 })).length);
  });
});

describe('machine design keeps recipes-as-data for step lists (generic pipeline machine)', () => {
  it('pipeline machine == runner on an arbitrary step list incl. done-skip', async () => {
    const mk = () => QueryLlmFactory({ critique: [{ sufficient: true, newQueries: [] }] });
    const a = await searchWith(runnerExecutor(STEPS), crit(2), Q, 4, mk());
    const b = await searchWith(pipelineExecutor(STEPS), crit(2), Q, 4, mk());
    expect(b.events).toEqual(a.events);
  });
});
void MACHINES; void fuse; void ({} as SearchRecipeSpec);
