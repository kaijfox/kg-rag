import { describe, expect, it } from 'vitest';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createActor, fromPromise, setup, toPromise } from 'xstate';
import { TOOLS, KgError, createKgApi, DEFAULT_SEARCH_RECIPE, type EventEnvelope, type SearchStep, type StepFactory } from '@kg/core';
import { InMemoryEventLog, FixedClock, SeqIds, loadMiniCorpus, miniSearchHarness } from '@kg/testkit';
import { runSuite, searchServiceConformance } from '@kg/testkit/conformance';
import { createApiHandlers } from '../../../../packages/app/src/skeleton/api';
import { createSearchService, type Executor } from '../src/service';
import { runnerExecutor } from '../src/runner';
import { MACHINES, machineExecutor, machineRecipe, anyExecutor } from '../src/machines';
import { STEPS, vectorKnn, truncate } from '../src/steps';
import { QueryLlmFactory } from './llm';
import { searchWith, stripRecipe } from './helpers';

const Q = 'how does entropy relate to Carnot efficiency of a heat engine';

describe('2. logging', () => {
  it('every search.step field is emitted from the machine: full event log equals the runner log (decomposition + loop)', async () => {
    const dec = { decompose: [{ subqueries: ['entropy of an isolated system', 'Carnot efficiency'] }] };
    const a = await searchWith(runnerExecutor(STEPS), { kind: 'search', version: 'd', spec: { steps: [
      { type: 'decompose', params: { model: 'm', maxSubqueries: 4 } }, { type: 'vector-knn', params: { pool: 50, kinds: ['chunk'], into: 'sub:{queryId}' } },
      { type: 'fuse', params: { from: ['sub:q0', 'sub:q1', 'sub:q2'], rrfK: 60 } }, { type: 'truncate', params: {} }] } }, Q, 5, QueryLlmFactory(dec));
    const b = await searchWith(machineExecutor(), machineRecipe('decompose-fuse', { model: 'm', maxSubqueries: 4 }), Q, 5, QueryLlmFactory(dec));
    expect(stripRecipe(b.events)).toEqual(stripRecipe(a.events));
    const step = b.events.find((e) => e.type === 'search.step')!;
    expect(step.searchId).toBe(b.res!.searchId);
    expect(step.buildId).toBe(b.res!.buildId);
    const t = (step.payload as unknown as { trace: Record<string, unknown> }).trace;
    expect(Object.keys(t).sort()).toEqual(['considered', 'durationMs', 'output', 'params', 'queries', 'stepIndex', 'stepType'].sort());
    const fuseTrace = (b.events.filter((e) => e.type === 'search.step')[2]!.payload as unknown as { trace: { pools: object; params: object } }).trace;
    expect(Object.keys(fuseTrace.pools)).toEqual(['sub:q0', 'sub:q1', 'sub:q2']);
  });

  it('a step that throws a KgError keeps its code through the actor system (tool.failed carries it)', async () => {
    const boom: StepFactory = () => ({ type: 'boom', async run() { throw new KgError('upstream', 'embedder down'); } });
    const r = await searchWith(runnerExecutor({ ...STEPS, boom }), { kind: 'search', version: 'b', spec: { steps: [{ type: 'boom', params: {} }] } }, Q);
    const reg = { ...MACHINES, boom: { version: 'boom/1', build: (_s: unknown, run: never) => MACHINES['knn-truncate']!.build({}, run) } };
    void reg;
    // machine: swap vector-knn's embedder to throw
    const mc = await loadMiniCorpus();
    mc.embedder.embed = async () => { throw new KgError('upstream', 'embedder down'); };
    const m = await searchWith(machineExecutor(), machineRecipe('knn-truncate', { pool: 10 }), Q, 3, undefined, mc);
    const failed = m.events.find((e) => e.type === 'tool.failed')!;
    expect((failed.payload as { error: { code: string } }).error.code).toBe('upstream');
    expect(r.error).toBeInstanceOf(KgError);
    expect(m.error).toBeInstanceOf(KgError);
  });

  it('a machine that forgets the logging actor is caught by the service conformance suite', async () => {
    const forgetful: Executor = async (run) => {
      const m = setup({ actors: { bare: fromPromise(async ({ input }: { input: { s: SearchStep; st: typeof run.state } }) => (await input.s.run(input.st, run.env)).state) } }).createMachine({
        context: { st: run.state }, initial: 'a', output: ({ context }) => context.st,
        states: { a: { invoke: { src: 'bare', input: ({ context }: { context: { st: typeof run.state } }) => ({ s: vectorKnn({ pool: 10, kinds: ['chunk'] }), st: context.st }), onDone: { target: 'z', actions: ({ event }) => void event } }, }, z: { type: 'final' } },
      } as never);
      const actor = createActor(m); actor.start(); await toPromise(actor); return run.state;
    };
    const res = await runSuite(searchServiceConformance(() => miniSearchHarness((mc) => createSearchService({ store: mc.store, embedder: mc.embedder, execute: forgetful }))));
    expect(res.failed.length).toBeGreaterThan(0);
  });
});

/** Nested tool calls (R-27): a step that calls api.getItems from inside the pipeline. */
async function nested(makeExec: (probe: StepFactory) => { exec: Executor; recipe: unknown }, opts: { concurrent?: number } = {}) {
  const mc = await loadMiniCorpus();
  const clock = new FixedClock(); const ids = new SeqIds();
  const log = new InMemoryEventLog(clock, ids);
  let api!: ReturnType<typeof createKgApi>;
  let session!: never;
  const probe: StepFactory = () => ({ type: 'probe', async run(state) {
    await new Promise((r) => setTimeout(r, 5)); // cross an async boundary like a real LLM/embedder call
    await api.getItems(session, { itemIds: [Object.values(mc.labels)[0]!], buildId: state.buildId });
    return { state: { ...state }, trace: { stepType: 'probe', params: {}, considered: [], output: [] } };
  } });
  const { exec, recipe } = makeExec(probe);
  const search = createSearchService({ store: mc.store, embedder: mc.embedder, execute: exec });
  api = createKgApi({ log, clock, ids, currentBuild: () => mc.store.currentBuild() }, createApiHandlers({ store: mc.store, log, search, ingest: { ingest: async () => { throw new Error('n/a'); } } }));
  session = (await api.openSession({ kind: 'test', label: 'nest' })).sessionId as never;
  const rid = mc.store.putRecipe(recipe as never);
  const n = opts.concurrent ?? 1;
  await Promise.all(Array.from({ length: n }, () => api.search(session, { query: Q, k: 2, searchRecipeId: rid })));
  const ev = log.events(session) as EventEnvelope[];
  const called = ev.filter((e) => e.type === 'tool.called');
  const searches = called.filter((e) => (e.payload as { tool: string }).tool === 'search');
  const gets = called.filter((e) => (e.payload as { tool: string }).tool === 'get_items');
  return { searches, gets, ev };
}
const probeRecipe = { kind: 'search', version: 'probe/1', spec: { steps: [{ type: 'probe', params: {} }, { type: 'vector-knn', params: { pool: 5, kinds: ['chunk'] } }, { type: 'probe', params: {} }] } };

describe('2b. nested tool calls link through the actor system (R-27, AsyncLocalStorage)', () => {
  it('runner: baseline', async () => {
    const r = await nested((probe) => ({ exec: runnerExecutor({ ...STEPS, probe }), recipe: probeRecipe }));
    expect(r.gets.map((g) => g.parentId)).toEqual([r.searches[0]!.id, r.searches[0]!.id]);
  });
  it('machine (actor started inside the handler): linked after every actor transition and a timer', async () => {
    const r = await nested((probe) => ({ exec: anyExecutor({ ...STEPS, probe }), recipe: probeRecipe }));
    expect(r.gets.map((g) => g.parentId)).toEqual([r.searches[0]!.id, r.searches[0]!.id]);
  });
  it('machine: 3 concurrent searches in one session keep their own parents', async () => {
    const r = await nested((probe) => ({ exec: anyExecutor({ ...STEPS, probe }), recipe: probeRecipe }), { concurrent: 3 });
    expect(r.gets.length).toBe(6);
    const per = new Map<string, number>();
    for (const g of r.gets) per.set(g.parentId!, (per.get(g.parentId!) ?? 0) + 1);
    // parallel top-level searches (R-27: parallel calls stay unlinked among themselves), each probe belongs to its own search
    expect([...per.values()]).toEqual([2, 2, 2]);
    expect(new Set(r.searches.map((s) => s.id))).toEqual(new Set(per.keys()));
  });
  it('context is inherited from whoever causes the transition: kept inside the handler, LOST when an outside event or an outside start drives the invoke', async () => {
    const als = new AsyncLocalStorage<string>();
    const mk = (seen: (string | undefined)[]) => setup({ actors: { hop: fromPromise(async () => { seen.push(als.getStore()); await new Promise((r) => setTimeout(r, 1)); }) } }).createMachine({
      initial: 'idle',
      states: { idle: { on: { GO: 'one' } }, one: { invoke: { src: 'hop', onDone: 'two' } }, two: { invoke: { src: 'hop', onDone: 'done' } }, done: { type: 'final' } },
    });
    const inside: (string | undefined)[] = [];
    const a1 = createActor(mk(inside)); a1.start();                       // started outside, driven from inside
    await als.run('handler', async () => { a1.send({ type: 'GO' }); await toPromise(a1); });
    expect(inside).toEqual(['handler', 'handler']);                      // every later hop still sees it
    const outside: (string | undefined)[] = [];
    const a2 = createActor(mk(outside)); a2.start();
    a2.send({ type: 'GO' });                                              // event from outside any handler (timer, queue, resume)
    await toPromise(a2);
    expect(outside).toEqual([undefined, undefined]);                      // lost for the whole remainder of the run
  });
});
void DEFAULT_SEARCH_RECIPE; void TOOLS; void truncate;
