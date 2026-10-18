import { describe, expect, it } from 'vitest';
import { validateMachineMap, type EventEnvelope, type MachineMap } from '@kg/core';
import { logFixture, machineMapFixture, machineRunFixture } from '@kg/testkit';
import { diagramOf, escapeHtml, mermaidOf, nextOf, orderSessions, pathOverlay, pickRun, renderTimeline, runsOf } from '../src/index';

const env = (type: string, seq: number, payload: unknown, extra: Partial<EventEnvelope> = {}): EventEnvelope =>
  ({ id: `ev_${seq}`, sessionId: 'se_test', seq, ts: '2026-10-17T12:00:00.000Z', schemaVersion: 1, type, buildId: null, searchId: null, parentId: null, payload, ...extra }) as EventEnvelope;
const started = (machine = 'similarity', version = '1', topology = '69bc55d30db24c90') =>
  env('pipeline.started', 1, { pipeline: 'search', machine, version, topology, recipeId: null }, { searchId: 'sr_1' as never, buildId: 'bd_1' as never });
const finished = (state: string, status: 'done' | 'failed' = 'done') =>
  env('pipeline.finished', 9, { pipeline: 'search', status, state, ...(status === 'failed' ? { error: { code: 'internal', message: 'boom' } } : {}) }, { searchId: 'sr_1' as never, buildId: 'bd_1' as never });
const step = (state: string, i: number) =>
  env('search.step', 2 + i, { trace: { stepIndex: i, state, stepType: state, params: {}, considered: [], output: [], durationMs: 1 } }, { searchId: 'sr_1' as never, buildId: 'bd_1' as never });

const search = machineMapFixture();

describe('renderTimeline', () => {
  it('renders the agent session as one line per event and shows the failed call error code', () => {
    const envs = logFixture('session-agent');
    const html = renderTimeline(envs);
    const lines = html.split('\n');
    expect(lines.length).toBe(envs.length);
    expect(lines.every((l) => l.startsWith('<div class="ev ') && l.endsWith('</div>'))).toBe(true);
    const failed = lines.find((l) => l.includes('tool.failed'))!;
    expect(failed).toContain('not_found');
    const steps = lines.filter((l) => l.includes('search.step'));
    expect(steps.length).toBe(6);
    expect(steps[0]).toContain('<span class="state">retrieve</span>');
    expect(steps[1]).toContain('<span class="state">cut</span>');
  });

  it('escapes payload text', () => {
    const q = env('query', 3, { query: '<img src=x onerror=alert(1)>', k: 3, searchRecipeId: 'rc_x' }, { searchId: 'sr_1' as never, buildId: 'bd_1' as never });
    const line = renderTimeline([q]);
    expect(line).not.toContain('<img');
    expect(line).toContain('&lt;img');
    expect(escapeHtml(`a&b<"'>`)).toBe('a&amp;b&lt;&quot;&#39;&gt;');
  });

  it('escapes strings that arrive in numeric fields', () => {
    const X = '<img src=x onerror=alert(1)>';
    const q = (type: string, payload: unknown, extra: Partial<EventEnvelope> = {}) => renderTimeline([env(type, 1, payload, extra)]);
    const trace = { stepIndex: X, state: 'retrieve', stepType: 't', params: {}, considered: [{ itemId: 'ch_a', score: 0.1, rank: X, queryId: 'q0' }], output: [{ itemId: 'ch_a', score: 0.1, rank: X, queryId: 'q0' }], pools: { side: [{ itemId: 'ch_a', score: 0.1, rank: X, queryId: 'q0' }] }, durationMs: X };
    const lines = [
      q('query', { query: 'q', k: X }),
      q('search.step', { trace }),
      q('search.result', { items: [{ rank: X, score: X, itemId: 'ch_a' }], stale: false }),
      q('ingest.parsed', { docKey: 'd', origin: 'parsed', stats: { pages: X } }),
      q('ingest.chunked', { docKey: 'd', chunkCount: X, inserted: X, reused: X, dropped: X }),
      q('ingest.embedded', { docKey: 'd', embedded: X, skipped: X }),
      q('build.created', { buildId: 'bd_1', itemCount: X, revert: false }),
      q('feedback', { overall: X, items: [], note: null }),
      q('outcome', { success: X, note: '' }),
      q('llm.called', { purpose: 'p', model: 'm', inputTokens: X, outputTokens: X, durationMs: X }),
      renderTimeline([env('query', X as never, { query: 'q', k: 1 })]),
    ];
    for (const l of lines) {
      expect(l).not.toContain('<img');
      expect(l).toContain('&lt;img');
    }
    expect(q('tool.returned', { tool: 't', durationMs: X, summary: {} })).not.toContain('<img');
  });

  it('shows the state beside each step and the pools when a step has them', () => {
    const withPools = env(
      'search.step',
      4,
      {
        trace: {
          stepIndex: 0,
          state: 'retrieve',
          stepType: 'vector-knn',
          params: {},
          considered: [],
          output: [],
          pools: { side: [{ itemId: 'ch_a', score: 0.5, rank: 1, queryId: 'q0' }] },
          durationMs: 1,
        },
      },
      { searchId: 'sr_1' as never, buildId: 'bd_1' as never },
    );
    const line = renderTimeline([withPools], (id) => ({ label: `L:${id}`, text: '' }));
    expect(line).toContain('pools: side (1)');
    expect(line).toContain('L:ch_a');
    expect(renderTimeline([step('cut', 0)]).includes('<span class="state">cut</span>')).toBe(true);
  });
});

describe('mermaidOf', () => {
  it('draws the machine as stateDiagram-v2 without overlay classes', () => {
    const text = mermaidOf(search);
    expect(text.split('\n')[0]).toBe('stateDiagram-v2');
    expect(text).toContain('state "vector-knn retrieval" as n0');
    expect(text).toContain('    [*] --> n0');
    expect(text).toContain('    n0 --> n1 : done');
    expect(text).toContain('    n3 --> [*]');
    expect(text).not.toContain('classDef');
    expect(text).not.toContain('linkStyle');
  });
});

describe('pathOverlay', () => {
  it('marks a recorded search run: routing states are filled in between logged states', () => {
    const run = machineRunFixture();
    expect(runsOf(run).length).toBe(1);
    const o = pathOverlay(search, run);
    expect(o.visits).toEqual({ retrieve: 1, cut: 1 });
    expect(o.moves).toEqual([
      { from: 'retrieve', to: 'check', count: 1 },
      { from: 'check', to: 'cut', count: 1 },
      { from: 'cut', to: 'done', count: 1 },
    ]);
    expect(o.final).toBe('done');
    expect(o.stop).toBeNull();
  });

  it('follows a loop: a state visited twice, its routing state twice, the exit once', () => {
    const run = [started(), step('retrieve', 0), step('retrieve', 1), step('cut', 2), finished('done')];
    const o = pathOverlay(search, run);
    expect(o.visits).toEqual({ retrieve: 2, cut: 1 });
    expect(o.moves).toEqual([
      { from: 'retrieve', to: 'check', count: 2 },
      { from: 'check', to: 'retrieve', count: 1 },
      { from: 'check', to: 'cut', count: 1 },
      { from: 'cut', to: 'done', count: 1 },
    ]);
    expect(o.final).toBe('done');
    const text = mermaidOf(search, { ...o, next: [] });
    expect(text).toContain('state "vector-knn retrieval (2 rounds)" as n0');
    expect(text).toContain('class n0 visited');
    expect(text).toContain('class n1 visited');
    expect(text).toContain('class n4 unvisited');
    expect(text).toContain('class n3 visited,final');
    // traversed moves carry a count; stateDiagram-v2 has no linkStyle (Mermaid draws it as states)
    const edge = (from: string, to: string) => text.split('\n').find((l) => l.startsWith(`    ${from} --> ${to} :`)) ?? '';
    expect(edge('n0', 'n1')).toMatch(/ x2$/);
    expect(edge('n1', 'n0')).toMatch(/ x1$/);
    expect(edge('n1', 'n2')).toMatch(/ x1$/);
    expect(edge('n2', 'n3')).toMatch(/ x1$/);
    expect(edge('n0', 'n4')).not.toMatch(/ x\d+$/);
    expect(edge('n2', 'n4')).not.toMatch(/ x\d+$/);
    expect(text).not.toContain('linkStyle');
  });

  it('a failed run marks the state of pipeline.finished as the stop, and walks the error edge', () => {
    const o = pathOverlay(search, [started(), step('retrieve', 0), finished('failed', 'failed')]);
    expect(o.stop).toBe('failed');
    expect(o.final).toBe('failed');
    expect(o.visits).toEqual({ retrieve: 1 });
    expect(o.moves).toEqual([{ from: 'retrieve', to: 'failed', count: 1 }]);
  });

  it('a failed run that stopped in a work state marks it and leaves final empty', () => {
    const o = pathOverlay(search, [started(), step('retrieve', 0), finished('cut', 'failed')]);
    expect(o.stop).toBe('cut');
    expect(o.final).toBeNull();
    expect(o.moves).toEqual([
      { from: 'retrieve', to: 'check', count: 1 },
      { from: 'check', to: 'cut', count: 1 },
    ]);
  });

  it('works for an ingest run whose events map to states by their logs', () => {
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
    const o = pathOverlay(ingest, run);
    expect(o.visits).toEqual({ parse: 1, chunk: 1 });
    expect(o.moves).toEqual([
      { from: 'parse', to: 'chunk', count: 1 },
      { from: 'chunk', to: 'done', count: 1 },
    ]);
    expect(o.final).toBe('done');
  });
});

describe('live runs', () => {
  const agent = logFixture('session-agent');
  const runs = runsOf(agent);

  it('nextOf names the successors of the last logged state until pipeline.finished arrives', () => {
    expect(runs.length).toBe(3);
    const second = runs[1]!.events;
    // second = [pipeline.started, step retrieve, step cut, pipeline.finished, ...]
    expect(nextOf(search, second.slice(0, 2))).toEqual(['retrieve', 'cut']);
    expect(nextOf(search, second.slice(0, 3))).toEqual(['done']);
    expect(nextOf(search, second)).toEqual([]);
    expect(nextOf(search, [started()])).toEqual(['retrieve']);
  });

  it('diagramOf draws the live prefix with visits, the next states and no finish', () => {
    const prefix = runs[1]!.events.slice(0, 2);
    const text = diagramOf(search, prefix)!;
    expect(text).toContain('state "vector-knn retrieval (x1)" as n0');
    expect(text).toContain('class n0 visited,next');
    expect(text).toContain('class n2 unvisited,next');
    expect(text).not.toContain('class n3 visited,final');
  });

  it('diagramOf draws a finished agent run with its path and final state', () => {
    const text = diagramOf(search, runs[0]!.events)!;
    expect(text).toContain('state "vector-knn retrieval (x1)" as n0');
    expect(text).toContain('class n3 visited,final');
    expect(text).not.toContain('linkStyle');
  });

  it('falls back to the flat timeline: no pipeline.started, another version, an unknown state', () => {
    const live = logFixture('session-live-partial');
    const liveRuns = runsOf(live);
    expect(liveRuns.length).toBe(2);
    const liveSearch = live.filter((e) => e.searchId === 'sr_00000000000000000000000007');
    expect(diagramOf(search, liveSearch)).not.toBeNull();
    expect(diagramOf(search, liveSearch.filter((e) => e.type !== 'pipeline.started'))).toBeNull();
    expect(diagramOf(search, runs[0]!.events.slice(0, 2))).not.toBeNull();
    expect(diagramOf({ ...search, version: '2' }, runs[0]!.events)).toBeNull();
    expect(diagramOf(null, runs[0]!.events)).toBeNull();
    expect(diagramOf(search, [started(), step('nowhere', 0)])).toBeNull();
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
