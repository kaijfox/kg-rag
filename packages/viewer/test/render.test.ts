import { describe, expect, it } from 'vitest';
import { validateMachineMap, type EventEnvelope, type MachineMap } from '@kg/core';
import { logFixture, machineMapFixture } from '@kg/testkit';
import { diagramOf, eventTree, orderSessions, pickRun, renderTimeline, runsOf, textOf, type Tree } from '../web/render.js';

const env = (type: string, seq: number, payload: unknown, extra: Partial<EventEnvelope> = {}): EventEnvelope =>
  ({ id: `ev_${seq}`, sessionId: 'se_test', seq, ts: '2026-10-17T12:00:00.000Z', schemaVersion: 1, type, buildId: null, searchId: null, parentId: null, payload, ...extra }) as EventEnvelope;
const started = (machine = 'similarity', version = '1', topology = '69bc55d30db24c90') =>
  env('pipeline.started', 1, { pipeline: 'search', machine, version, topology, recipeId: null }, { searchId: 'sr_1' as never, buildId: 'bd_1' as never });
const finished = (state: string, status: 'done' | 'failed' = 'done') =>
  env('pipeline.finished', 9, { pipeline: 'search', status, state, ...(status === 'failed' ? { error: { code: 'internal', message: 'boom' } } : {}) }, { searchId: 'sr_1' as never, buildId: 'bd_1' as never });
const step = (state: string, i: number) =>
  env('search.step', 2 + i, { trace: { stepIndex: i, state, stepType: state, params: {}, considered: [], output: [], durationMs: 1 } }, { searchId: 'sr_1' as never, buildId: 'bd_1' as never });

/** Every tag name in a tree; the page builds only these, so a log value can never add one. */
const tags = (t: Tree): string[] => [t.tag, ...t.kids.flatMap((k) => (typeof k === 'object' && k !== null && 'tag' in k ? tags(k) : []))];
const findRow = (rows: Tree[], needle: string) => rows.find((r) => textOf(r).includes(needle))!;

const search = machineMapFixture();

describe('renderTimeline', () => {
  it('renders the agent session as one row per event and shows the failed call error code', () => {
    const envs = logFixture('session-agent');
    const rows = renderTimeline(envs);
    expect(rows.length).toBe(envs.length);
    expect(rows.every((r) => r.tag === 'div' && r.cls?.startsWith('ev '))).toBe(true);
    expect(textOf(findRow(rows, 'tool.failed')!)).toContain('not_found');
    const steps = rows.filter((r) => r.cls?.includes('search.step'));
    expect(steps.length).toBe(6);
    expect(textOf(steps[0]!)).toContain('retrieve');
    expect(textOf(steps[1]!)).toContain('cut');
  });

  it('keeps log text as text: markup in payloads never adds an element', () => {
    const q = eventTree(env('query', 3, { query: '<img src=x onerror=alert(1)>', k: 3, searchRecipeId: 'rc_x' }));
    expect(textOf(q)).toContain('<img src=x onerror=alert(1)>');
    expect(tags(q).every((t) => ['div', 'span', 'b', 'details', 'summary', 'pre'].includes(t))).toBe(true);
    expect(tags(q)).not.toContain('img');
  });

  it('a string in a numeric field is shown as text and adds no element', () => {
    const X = '<img src=x onerror=alert(1)>';
    const trace = { stepIndex: X, state: 'retrieve', stepType: 't', params: {}, considered: [{ itemId: 'ch_a', score: 0.1, rank: X, queryId: 'q0' }], output: [{ itemId: 'ch_a', score: 0.1, rank: X, queryId: 'q0' }], pools: { side: [{ itemId: 'ch_a', score: 0.1, rank: X, queryId: 'q0' }] }, durationMs: X };
    const rows = [
      eventTree(env('query', 1, { query: 'q', k: X })),
      eventTree(env('search.step', 2, { trace })),
      eventTree(env('search.result', 3, { items: [{ rank: X, score: X, itemId: 'ch_a' }], stale: false })),
      eventTree(env('ingest.chunked', 4, { docKey: 'd', chunkCount: X, inserted: X, reused: X, dropped: X })),
      eventTree(env('llm.called', 5, { purpose: 'p', model: 'm', inputTokens: X, outputTokens: X, durationMs: X })),
      eventTree(env('tool.returned', 6, { tool: 't', durationMs: X, summary: {} })),
    ];
    for (const r of rows) expect(tags(r)).not.toContain('img');
    expect(textOf(rows[0]!)).toContain(X);
    expect(textOf(rows[2]!)).toContain(X);
    expect(textOf(rows[3]!)).toContain(X);
    expect(textOf(rows[4]!)).toContain(X);
  });

  it('shows the state beside each step and the pools when a step has them', () => {
    const withPools = env(
      'search.step',
      4,
      { trace: { stepIndex: 0, state: 'retrieve', stepType: 'vector-knn', params: {}, considered: [], output: [], pools: { side: [{ itemId: 'ch_a', score: 0.5, rank: 1, queryId: 'q0' }] }, durationMs: 1 } },
      { searchId: 'sr_1' as never, buildId: 'bd_1' as never },
    );
    const row = renderTimeline([withPools], (id) => ({ label: `L:${id}`, text: '' }))[0]!;
    const text = textOf(row);
    expect(text).toContain('pools: side (1)');
    expect(text).toContain('L:ch_a');
    expect(textOf(renderTimeline([step('cut', 0)])[0]!)).toContain('cut');
  });
});

describe('diagramOf', () => {
  const agent = logFixture('session-agent');
  const runs = runsOf(agent);

  it('draws only the states the run logged, each with its visit count, and no states it did not reach', () => {
    const prefix = runs[1]!.events.slice(0, 2);
    const text = diagramOf(search, prefix)!;
    expect(text.split('\n')[0]).toBe('stateDiagram-v2');
    expect(text.match(/state "/g)?.length).toBe(1);
    expect(text).toContain('state "vector-knn retrieval (x1)" as n0');
    expect(text).not.toContain('cut');
    expect(text.split('\n').filter((l) => l.includes('-->') && !l.includes('[*]'))).toEqual([]);
    expect(text).not.toContain('next');
  });

  it('draws a finished run with its edges between drawn states and the final state', () => {
    const text = diagramOf(search, runs[0]!.events)!;
    expect(text).toContain('state "vector-knn retrieval (x1)" as n0');
    const final = /state "done \(x1\)" as (n\d+)/.exec(text)?.[1];
    expect(final).toBeDefined();
    expect(text).toContain(`class ${final} visited,final`);
    expect(text).toContain(`${final} --> [*]`);
    expect(text).toContain('[*] --> n0');
    expect(text).not.toContain('linkStyle');
  });

  it('marks the state of a failed run as the stop state', () => {
    const text = diagramOf(search, [started(), step('retrieve', 0), finished('retrieve', 'failed')])!;
    expect(text).toContain('class n0 visited,stop');
  });

  it('draws an ingest run whose events map to states by their logs', () => {
    const ingest: MachineMap = {
      machine: 'ingest-demo',
      version: '1',
      topology: '0123456789abcdef',
      initial: 'parse',
      nodes: [
        { id: 'parse', parent: null, kind: 'work', label: 'parse', logs: ['ingest.parsed'], step: 'parse', loop: false },
        { id: 'chunk', parent: null, kind: 'work', label: 'chunk', logs: ['ingest.chunked'], step: 'chunk', loop: false },
        { id: 'done', parent: null, kind: 'final', label: 'done', logs: [], step: null, loop: false },
      ],
      edges: [
        { from: 'parse', to: 'chunk', event: 'done', guard: null },
        { from: 'chunk', to: 'done', event: 'done', guard: null },
      ],
    };
    expect(validateMachineMap(ingest)).toEqual([]);
    const run = [
      env('pipeline.started', 2, { pipeline: 'ingest', machine: 'ingest-demo', version: '1', topology: '0123456789abcdef', recipeId: null }),
      env('ingest.parsed', 3, { docKey: 'entropy', artifactId: 'ar_x', origin: 'parsed', stats: { pages: 1, chars: 1, charsPerPage: [1], undecodedFormulas: 0, elapsedMs: 1 } }),
      env('ingest.chunked', 4, { docKey: 'entropy', docVersionId: 'dv_x', chunkCount: 1, inserted: 1, reused: 0, dropped: 0 }),
      env('pipeline.finished', 5, { pipeline: 'ingest', status: 'done', state: 'done' }),
    ];
    const text = diagramOf(ingest, run)!;
    expect(text).toContain('state "parse (x1)" as n0');
    expect(text).toContain('state "chunk (x1)" as n1');
    expect(text).toContain('state "done (x1)" as n2');
    expect(text).toContain('n0 --> n1 : done');
    expect(text).toContain('n1 --> n2 : done');
    expect(text).toContain('class n2 visited,final');
  });

  it('falls back to the flat timeline: no pipeline.started, another version, an unknown state, nothing logged', () => {
    const live = logFixture('session-live-partial');
    const liveRuns = runsOf(live);
    expect(liveRuns.length).toBe(2);
    const liveSearch = live.filter((e) => e.searchId === 'sr_00000000000000000000000007');
    expect(diagramOf(search, liveSearch)).not.toBeNull();
    expect(diagramOf(search, liveSearch.filter((e) => e.type !== 'pipeline.started'))).toBeNull();
    expect(diagramOf({ ...search, version: '2' }, runs[0]!.events)).toBeNull();
    expect(diagramOf(null, runs[0]!.events)).toBeNull();
    expect(diagramOf(search, [started(), step('nowhere', 0)])).toBeNull();
    expect(diagramOf(search, [started()])).toBeNull();
  });

});

describe('session order and run following', () => {
  const s = (sessionId: string, startedAt: string, lastEventAt = startedAt) => ({ sessionId, startedAt, lastEventAt });
  it('orders sessions by start, newest first, whatever their last event', () => {
    const list = [s('a', '2026-01-01T00:00:00Z', '2026-01-09T00:00:00Z'), s('c', '2026-01-03T00:00:00Z'), s('b', '2026-01-02T00:00:00Z')];
    expect(orderSessions(list).map((x) => x.sessionId)).toEqual(['c', 'b', 'a']);
    list[0] = s('a', '2026-01-01T00:00:00Z', '2026-01-20T00:00:00Z');
    expect(orderSessions(list).map((x) => x.sessionId)).toEqual(['c', 'b', 'a']);
  });
  it('breaks a tie on the start by ID, and does not change its input', () => {
    const list = [s('a', 't'), s('b', 't')];
    expect(orderSessions(list).map((x) => x.sessionId)).toEqual(['b', 'a']);
    expect(list.map((x) => x.sessionId)).toEqual(['a', 'b']);
  });
  it('a following reader moves to a new run; a reader who picked an earlier run stays on it', () => {
    expect(pickRun(['1', '5'], '1', true)).toBe('5');
    expect(pickRun(['1', '5', '9'], '5', false)).toBe('5');
    expect(pickRun(['1', '5'], null, false)).toBe('5');
    expect(pickRun(['1'], '7', false)).toBe('1');
    expect(pickRun([], '1', true)).toBeNull();
  });
});

