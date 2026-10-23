import { describe, expect, it } from 'vitest';
import { KgError, validateMachineMap, type Ctx } from '@kg/core';
import { assign, loggedActor, machineMapOf, runPipeline, setup, toKgError, toMermaid, topologyOf, type PipelineIdentity } from '../src/index';
import { drive, scripted, withActors } from '../src/testing';

// A tiny machine with a work state, a guarded routing state that can loop back, and a failure end.
type C = { n: number; error?: KgError };
const build = (guardName: 'again' | 'retry' = 'again') =>
  setup({
    types: { context: {} as C, input: {} as { n: number }, output: {} as number },
    actors: { work: loggedActor<number, number>(['search.step'], async (n) => n + 1) },
    guards: { again: ({ context }) => context.n < 3, retry: ({ context }) => context.n < 3 },
  }).createMachine({
    id: 'toy',
    context: ({ input }) => ({ n: input.n }),
    initial: 'work',
    output: ({ context }) => context.n,
    states: {
      work: {
        meta: { logs: 'search.step', step: 'add-one' },
        invoke: { src: 'work', input: ({ context }) => context.n, onDone: { target: 'check', actions: assign({ n: ({ event }) => event.output }) }, onError: { target: 'failed', actions: assign({ error: ({ event }) => toKgError(event.error) }) } },
      },
      check: { meta: { routing: true }, always: [{ guard: guardName, target: 'work' }, { target: 'done' }] },
      done: { type: 'final' },
      failed: { id: 'failed', type: 'final' },
    },
  });

const fakeCtx = () => {
  const events: { type: string; payload: Record<string, unknown> }[] = [];
  const ctx = { emit: (type: string, payload: Record<string, unknown>) => (events.push({ type, payload }), {}) } as unknown as Ctx;
  return { ctx, events };
};
const identity = (m: ReturnType<typeof build>): PipelineIdentity => ({ pipeline: 'ingest', machine: 'toy', version: '1', topology: topologyOf(m), recipeId: null });

describe('machine map', () => {
  it('is valid, marks work/routing/final nodes and the loop', () => {
    const map = machineMapOf(build(), { machine: 'toy', version: '1' });
    expect(validateMachineMap(map)).toEqual([]);
    expect(map.initial).toBe('work');
    expect(Object.fromEntries(map.nodes.map((n) => [n.id, n.kind]))).toEqual({ work: 'work', check: 'routing', done: 'final', failed: 'final' });
    expect(map.nodes.find((n) => n.id === 'work')).toMatchObject({ step: 'add-one', logs: ['search.step'], loop: true });
    expect(map.edges).toContainEqual({ from: 'check', to: 'work', event: 'always', guard: 'again' });
    expect(map.edges).toContainEqual({ from: 'work', to: 'failed', event: 'error', guard: null });
  });
  it('draws a diagram', () => {
    const text = toMermaid(machineMapOf(build(), { machine: 'toy', version: '1' }));
    expect(text).toMatch(/^stateDiagram-v2\n  \[\*\] --> work\n/);
    expect(text).toContain('check --> work : always [again]');
    expect(text).toContain('done --> [*]');
  });
});

describe('topology', () => {
  it('is 16 hex, stable, and changes when a guard is renamed', () => {
    expect(topologyOf(build())).toMatch(/^[0-9a-f]{16}$/);
    expect(topologyOf(build())).toBe(topologyOf(build()));
    expect(topologyOf(build('retry'))).not.toBe(topologyOf(build()));
  });
});

describe('runPipeline', () => {
  it('brackets a successful run with started and finished', async () => {
    const { ctx, events } = fakeCtx();
    const m = build();
    const out = await runPipeline(m, { n: 0 }, { run: { ctx, tag: {} }, identity: identity(m) });
    expect(out).toBe(3);
    expect(events.map((e) => e.type)).toEqual(['pipeline.started', 'pipeline.finished']);
    expect(events[0]!.payload).toMatchObject({ pipeline: 'ingest', machine: 'toy', version: '1', recipeId: null });
    expect(events[1]!.payload).toEqual({ pipeline: 'ingest', status: 'done', state: 'done' });
  });
  it('rethrows the kept error after pipeline.finished when a state fails', async () => {
    const { ctx, events } = fakeCtx();
    const m = withActors(build(), { work: scripted([new KgError('upstream', 'boom')]) });
    await expect(runPipeline(m, { n: 0 }, { run: { ctx, tag: {} }, identity: identity(m) })).rejects.toMatchObject({ code: 'upstream' });
    expect(events.map((e) => e.type)).toEqual(['pipeline.started', 'pipeline.finished']);
    expect(events[1]!.payload).toMatchObject({ status: 'failed', state: 'work', error: { code: 'upstream', message: 'boom' } });
  });
  it('names the work state that failed on a later pass of a loop, not failed', async () => {
    const { ctx, events } = fakeCtx();
    const m = withActors(build(), { work: scripted([1, new KgError('upstream', 'second')]) });
    await expect(runPipeline(m, { n: 0 }, { run: { ctx, tag: {} }, identity: identity(m) })).rejects.toMatchObject({ message: 'second' });
    expect(events[1]!.payload).toMatchObject({ status: 'failed', state: 'work' });
  });
  it('records the work state that threw as state, with status failed and the error code', async () => {
    const { ctx, events } = fakeCtx();
    const m = withActors(build(), { work: loggedActor<number, number>([], async () => { throw new KgError('precondition', 'no index'); }) });
    await expect(runPipeline(m, { n: 0 }, { run: { ctx, tag: {} }, identity: identity(m) })).rejects.toMatchObject({ code: 'precondition' });
    const fin = events.filter((e) => e.type === 'pipeline.finished');
    expect(fin).toHaveLength(1);
    expect(fin[0]!.payload).toMatchObject({ status: 'failed', state: 'work', error: { code: 'precondition', message: 'no index' } });
    expect(fin[0]!.payload.state).not.toBe('failed');
  });
  it('turns a plain thrown value into an internal error', async () => {
    const { ctx } = fakeCtx();
    const m = withActors(build(), { work: loggedActor<number, number>([], async () => { throw new Error('plain'); }) });
    await expect(runPipeline(m, { n: 0 }, { run: { ctx, tag: {} }, identity: identity(m) })).rejects.toMatchObject({ code: 'internal', message: 'plain' });
  });
});

describe('testing helpers', () => {
  it('drive reports the visited states and the output', async () => {
    const r = await drive(withActors(build(), { work: scripted([1, 2, 3]) }), { n: 0 });
    expect(r.visited).toEqual(['work', 'check', 'work', 'check', 'work', 'check', 'done']);
    expect(r.final).toBe('done');
    expect(r.output).toBe(3);
  });
  it('scripted fails loudly when called too often', async () => {
    const r = await drive(withActors(build(), { work: scripted([1]) }), { n: 0 });
    expect(r.final).toBe('failed');
  });
});
