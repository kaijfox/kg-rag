/** searchStepConformance and searchServiceConformance. */
import { expect } from 'vitest';
import {
  TOOLS,
  isProperlyRanked,
  runTool,
  searchResponseSchema,
  sortCandidates,
  type BuildId,
  type EventEnvelope,
  type RecipeId,
  type SearchService,
  type SearchState,
  type SearchStep,
  type StepEnv,
  type StepTrace,
} from '@kg/core';
import { InMemoryEventLog } from '../fakes/eventlog';
import { FixedClock, SeqIds } from '../fakes/infra';
import { deepFreeze, type Suite } from './harness';

export interface StepHarness {
  step: SearchStep;
  state: SearchState;
  env: StepEnv;
  /** true for retrieval steps (vector-knn, later graph walk): they must merge, P-2b */
  retrieval?: boolean;
  /**
   * P-1: set when the step is configured to retrieve `into` named pools. The pool names it is expected to
   * write for this harness's state (after `{queryId}` expansion). The step must then leave `candidates`
   * alone and write exactly these pools (plus whatever pools the input state already had).
   */
  into?: string[];
}

export function searchStepConformance(make: () => StepHarness | Promise<StepHarness>): Suite {
  const go = async () => {
    const h = await make();
    const before = structuredClone(h.state);
    const out = await h.step.run(deepFreeze(h.state), h.env);
    return { h, before, out };
  };
  return {
    name: 'searchStepConformance',
    cases: [
      {
        name: 'does not mutate its input state',
        async run() {
          const { h, before } = await go();
          expect(h.state).toEqual(before);
        },
      },
      {
        name: 'output candidates are ordered by sortCandidates and unique',
        async run() {
          const { out } = await go();
          expect(out.state.candidates).toEqual(sortCandidates(out.state.candidates));
          expect(new Set(out.state.candidates.map((c) => c.itemId)).size).toBe(out.state.candidates.length);
        },
      },
      {
        name: 'trace: considered and output are properly ranked, output is a subset of considered and equals the new candidates',
        async run() {
          const { h, out } = await go();
          const t = out.trace;
          expect(t.stepType).toBe(h.step.type);
          expect(isProperlyRanked(t.considered)).toBe(true);
          expect(isProperlyRanked(t.output)).toBe(true);
          const considered = new Set(t.considered.map((r) => r.itemId));
          for (const r of t.output) expect(considered.has(r.itemId)).toBe(true);
          expect(t.output.map((r) => [r.itemId, r.score])).toEqual(out.state.candidates.map((c) => [c.itemId, c.score]));
        },
      },
      {
        name: 'considered contains every input candidate (the previous step\'s output)',
        async run() {
          const { before, out } = await go();
          const c = new Set(out.trace.considered.map((r) => r.itemId));
          for (const x of before.candidates) expect(c.has(x.itemId), `input candidate ${x.itemId} not considered`).toBe(true);
        },
      },
      {
        name: 'P-2b: a retrieval step merges into existing candidates and re-running it is idempotent',
        async run() {
          const h = await make();
          if (!h.retrieval) return;
          expect(h.state.candidates.length, 'harness must seed at least one candidate').toBeGreaterThan(0);
          const once = await h.step.run(structuredClone(h.state), h.env);
          for (const x of h.state.candidates) {
            const kept = once.state.candidates.find((c) => c.itemId === x.itemId);
            expect(kept, `existing candidate ${x.itemId} was dropped`).toBeDefined();
            expect(kept!.score).toBeGreaterThanOrEqual(x.score);
          }
          const twice = await h.step.run(structuredClone(once.state), h.env);
          expect(twice.state.candidates).toEqual(once.state.candidates);
        },
      },
      {
        name: 'P-1: pools default to {}: a step given no pools returns pools that are an empty object (or only its own into pools)',
        async run() {
          const { h, out } = await go();
          expect(h.state.pools, 'harness state must start with pools {}').toEqual({});
          expect(Object.keys(out.state.pools).sort()).toEqual([...(h.into ?? [])].sort());
          if (!h.into) expect(out.trace.pools === undefined || Object.keys(out.trace.pools).length === 0).toBe(true);
        },
      },
      {
        name: 'P-1: pools the step did not write pass through unchanged',
        async run() {
          const h = await make();
          const carried = h.state.candidates.length > 0 ? h.state.candidates : [];
          const state: SearchState = { ...structuredClone(h.state), pools: { __carried__: structuredClone(sortCandidates(carried)) } };
          const out = await h.step.run(deepFreeze(state), h.env);
          expect(out.state.pools['__carried__'], 'a pool the step does not write was dropped or rewritten').toEqual(state.pools['__carried__']);
        },
      },
      {
        name: 'P-1: into: candidates untouched, pools unique/ranked/merged, trace.pools matches, re-run idempotent',
        async run() {
          const h = await make();
          if (!h.into) return;
          const once = await h.step.run(structuredClone(h.state), h.env);
          const input = sortCandidates(h.state.candidates);
          expect(once.state.candidates, 'an into step must not touch candidates').toEqual(input);
          expect(once.trace.output.map((r) => r.itemId)).toEqual(input.map((c) => c.itemId));
          for (const name of h.into) {
            const pool = once.state.pools[name];
            expect(pool, `pool ${name} not written`).toBeDefined();
            expect(pool!.length).toBeGreaterThan(0);
            expect(pool).toEqual(sortCandidates(pool!));
            expect(new Set(pool!.map((c) => c.itemId)).size).toBe(pool!.length);
            for (const c of pool!) expect(c.sourceChunkIds.length).toBeGreaterThan(0);
            for (const x of h.state.pools[name] ?? []) {
              const kept = pool!.find((c) => c.itemId === x.itemId);
              expect(kept, `existing pool item ${x.itemId} was dropped`).toBeDefined();
              expect(kept!.score).toBeGreaterThanOrEqual(x.score);
            }
            const refs = once.trace.pools?.[name];
            expect(refs, `trace.pools lacks ${name}`).toBeDefined();
            expect(isProperlyRanked(refs!)).toBe(true);
            expect(refs!.map((r) => [r.itemId, r.score])).toEqual(pool!.map((c) => [c.itemId, c.score]));
          }
          const twice = await h.step.run(structuredClone(once.state), h.env);
          expect(twice.state.pools).toEqual(once.state.pools);
          expect(twice.state.candidates).toEqual(once.state.candidates);
        },
      },
      {
        name: 'Rule 1: every candidate has non-empty sourceChunkIds',
        async run() {
          const { out } = await go();
          for (const c of out.state.candidates) expect(c.sourceChunkIds.length).toBeGreaterThan(0);
        },
      },
      {
        name: 'query, k and buildId pass through unchanged',
        async run() {
          const { h, out } = await go();
          expect([out.state.query, out.state.k, out.state.buildId]).toEqual([h.state.query, h.state.k, h.state.buildId]);
        },
      },
    ],
  };
}

export interface SearchServiceHarness {
  service: SearchService;
  /** queries that return at least one result */
  queries: string[];
  /** the build searches run against by default */
  buildId: BuildId;
  /** another build to request explicitly (optional) */
  otherBuildId?: BuildId;
  /** search recipe each build's manifest names (optional; checks the recipe comes from the SEARCHED build, M31) */
  recipeOf?: (b: BuildId) => RecipeId;
  /** texts the embedder was asked to embed, and the space's query rendering (optional; checks conditioning, M23) */
  embeddedTexts?: () => readonly string[];
  renderQuery?: (q: string) => string;
}

async function runSearch(h: SearchServiceHarness, query: string, k: number, buildId?: BuildId) {
  const clock = new FixedClock();
  const ids = new SeqIds();
  const log = new InMemoryEventLog(clock, ids);
  const s = log.openSession({ kind: 'test', label: null, meta: {} });
  const rt = { log, clock, ids, currentBuild: () => h.buildId };
  const input = buildId ? { query, k, buildId } : { query, k };
  const resp = await runTool(rt, TOOLS.search, s, input, (ctx, i) => h.service.search(ctx, i));
  return { resp, events: log.events(s) };
}

export function searchServiceConformance(make: () => SearchServiceHarness | Promise<SearchServiceHarness>): Suite {
  return {
    name: 'searchServiceConformance',
    cases: [
      {
        name: 'event sequence: tool.called, query, pipeline.started, search.step x n (n >= 1), pipeline.finished, search.result, tool.returned',
        async run() {
          const h = await make();
          const { events } = await runSearch(h, h.queries[0]!, 5);
          const types = events.map((e) => e.type);
          expect(types[0]).toBe('session.started');
          expect(types[1]).toBe('tool.called');
          expect(types[2]).toBe('query');
          expect(types[3]).toBe('pipeline.started');
          expect(types.at(-3)).toBe('pipeline.finished');
          expect(types.at(-2)).toBe('search.result');
          expect(types.at(-1)).toBe('tool.returned');
          const steps = types.slice(4, -3);
          expect(steps.length).toBeGreaterThan(0);
          expect(steps.every((t) => t === 'search.step')).toBe(true);
        },
      },
      {
        name: 'pipeline.started names the search machine: pipeline search, non-empty machine and version, 16-hex topology, the search\'s buildId and searchId',
        async run() {
          const h = await make();
          const { resp, events } = await runSearch(h, h.queries[0]!, 5);
          const started = events.find((e): e is EventEnvelope<'pipeline.started'> => e.type === 'pipeline.started')!;
          expect(started.payload.pipeline).toBe('search');
          expect(started.payload.machine.length).toBeGreaterThan(0);
          expect(started.payload.version.length).toBeGreaterThan(0);
          expect(started.payload.topology).toMatch(/^[0-9a-f]{16}$/);
          expect(started.buildId).toBe(resp.buildId);
          expect(started.searchId).toBe(resp.searchId);
        },
      },
      {
        name: 'pipeline.finished closes the search: pipeline search, status done, a non-empty state, the search\'s buildId and searchId',
        async run() {
          const h = await make();
          const { resp, events } = await runSearch(h, h.queries[0]!, 5);
          const finished = events.filter((e): e is EventEnvelope<'pipeline.finished'> => e.type === 'pipeline.finished');
          expect(finished.length).toBe(1);
          expect(finished[0]!.payload.pipeline).toBe('search');
          expect(finished[0]!.payload.status).toBe('done');
          expect(finished[0]!.payload.state.length).toBeGreaterThan(0);
          expect(finished[0]!.buildId).toBe(resp.buildId);
          expect(finished[0]!.searchId).toBe(resp.searchId);
        },
      },
      {
        name: 'every search.step trace has a non-empty state, and every step lies between pipeline.started and pipeline.finished',
        async run() {
          const h = await make();
          const { events } = await runSearch(h, h.queries[0]!, 3);
          const steps = events.filter((e): e is EventEnvelope<'search.step'> => e.type === 'search.step');
          expect(steps.length).toBeGreaterThan(0);
          for (const s of steps) expect(s.payload.trace.state.length, `step ${s.payload.trace.stepIndex}`).toBeGreaterThan(0);
          const started = events.findIndex((e) => e.type === 'pipeline.started');
          const finished = events.findIndex((e) => e.type === 'pipeline.finished');
          for (const s of steps) {
            const at = events.indexOf(s);
            expect(at > started && at < finished).toBe(true);
          }
        },
      },
      {
        name: 'every search event carries the response searchId and buildId, and the tool.called parent',
        async run() {
          const h = await make();
          const { resp, events } = await runSearch(h, h.queries[0]!, 5);
          const parent = events[1]!.id;
          for (const e of events.filter((x) => x.type === 'query' || x.type === 'pipeline.started' || x.type === 'search.step' || x.type === 'pipeline.finished' || x.type === 'search.result')) {
            expect(e.searchId).toBe(resp.searchId);
            expect(e.buildId).toBe(resp.buildId);
            expect(e.parentId).toBe(parent);
          }
          expect(resp.buildId).toBe(h.buildId);
        },
      },
      {
        name: 'step traces: contiguous stepIndex from 0, ranked, output within considered; the last output explains the result',
        async run() {
          const h = await make();
          const { resp, events } = await runSearch(h, h.queries[0]!, 3);
          const traces = events.filter((e): e is EventEnvelope<'search.step'> => e.type === 'search.step').map((e) => e.payload.trace as StepTrace);
          traces.forEach((t, i) => {
            expect(t.stepIndex).toBe(i);
            expect(isProperlyRanked(t.considered)).toBe(true);
            expect(isProperlyRanked(t.output)).toBe(true);
            const c = new Set(t.considered.map((r) => r.itemId));
            for (const r of t.output) expect(c.has(r.itemId)).toBe(true);
          });
          expect(traces.at(-1)!.output.slice(0, 3).map((r) => r.itemId)).toEqual(resp.items.map((i) => i.itemId));
          // each step considers everything the previous step passed on (nothing silently dropped before logging)
          traces.forEach((t, i) => {
            if (i === 0) return;
            const c = new Set(t.considered.map((r) => r.itemId));
            for (const r of traces[i - 1]!.output) expect(c.has(r.itemId), `step ${i} did not consider ${r.itemId}`).toBe(true);
          });
        },
      },
      {
        name: 'the query is embedded through the space query template',
        async run() {
          const h = await make();
          if (!h.embeddedTexts || !h.renderQuery) return;
          await runSearch(h, h.queries[0]!, 3);
          expect(h.embeddedTexts()).toContain(h.renderQuery(h.queries[0]!));
          expect(h.renderQuery(h.queries[0]!)).not.toBe(h.queries[0]); // the harness template must not be the identity
        },
      },
      {
        name: 'response validates, ranks are 1..n, n <= k, and search.result matches the response',
        async run() {
          const h = await make();
          for (const k of [1, 3]) {
            const { resp, events } = await runSearch(h, h.queries[0]!, k);
            expect(searchResponseSchema.safeParse(resp).success).toBe(true);
            expect(resp.items.length).toBeGreaterThan(0);
            expect(resp.items.length).toBeLessThanOrEqual(k);
            const r = events.find((e): e is EventEnvelope<'search.result'> => e.type === 'search.result')!;
            expect(r.payload.items).toEqual(resp.items.map(({ itemId, kind, rank, score, sourceChunkIds }) => ({ itemId, kind, rank, score, sourceChunkIds })));
            expect(r.payload.stale).toBe(resp.stale);
          }
        },
      },
      {
        name: 'an explicitly requested build is honoured',
        async run() {
          const h = await make();
          if (!h.otherBuildId) return;
          const { resp, events } = await runSearch(h, h.queries[0]!, 3, h.otherBuildId);
          expect(resp.buildId).toBe(h.otherBuildId);
          for (const e of events.filter((x) => x.searchId === resp.searchId)) expect(e.buildId, e.type).toBe(h.otherBuildId);
          if (h.recipeOf) {
            const q = events.find((e): e is EventEnvelope<'query'> => e.type === 'query')!;
            expect(q.payload.searchRecipeId).toBe(h.recipeOf(h.otherBuildId));
            expect(h.recipeOf(h.otherBuildId)).not.toBe(h.recipeOf(h.buildId)); // the harness must make them differ
          }
        },
      },
    ],
  };
}
