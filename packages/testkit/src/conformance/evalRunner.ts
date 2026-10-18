/**
 * evalRunnerConformance (pre-written for the `eval` package, review S3/S4): event order, Rule 6 build tags on a
 * pinned build, refusal of a stale build, orphaned gold, recall on the scripted retrievals, persisted results.
 *
 * Environment built here: the mini-corpus store (builds v1 and v2, v2 current), an InMemoryEventLog, and a KgApi
 * whose search returns fixtures/eval/retrievals.json for each question text (testkit fakeHandlers), so the
 * retrieved condition's recall must equal fixtures/eval/expected-metrics.json.
 */
import { expect } from 'vitest';
import {
  KgError,
  createKgApi,
  orphanedGold,
  type BuildId,
  type ChunkId,
  type CorpusStore,
  type EvalQuestion,
  type EvalRepo,
  type EvalRunOutput,
  type EvalSet,
  type EventEnvelope,
  type ItemKind,
  type JudgeVerdict,
  type KgApi,
  type Llm,
  type ToolRuntime,
} from '@kg/core';
import { InMemoryEvalRepo } from '../fakes/evalrepo';
import { InMemoryEventLog } from '../fakes/eventlog';
import { FixedClock, SeqIds } from '../fakes/infra';
import { fakeHandlers } from '../fakes/kgapi';
import type { ScriptedHit } from '../fakes/search';
import { evalFixture } from '../fixtures';
import { miniChunks } from '../harnesses';
import { loadMiniCorpus } from '../minicorpus';
import { expectKgError, type Suite } from './harness';

export interface EvalRunnerDeps {
  rt: ToolRuntime;
  api: KgApi;
  /** the eval runner's read access (staleness, orphaned gold, gold text) */
  store: Pick<CorpusStore, 'getBuild' | 'staleCheck' | 'getItems'>;
  answerer: Llm;
  judge: (q: EvalQuestion, answer: string, condition: string) => Promise<JudgeVerdict>;
  repo: EvalRepo;
}
export interface EvalRunOptions {
  conditions: string[];
  ks: number[];
  /** pinned build; default the current build */
  buildId?: BuildId;
  allowStale?: boolean;
}
/** Contract: runEval opens one session of kind 'eval' and does all its work in one EVAL_RUN_TOOL call. The
 * summary must contain `orphaned: OrphanedGold[]` (core orphanedGold for the run's build). */
export type RunEval = (d: EvalRunnerDeps, set: EvalSet, o: EvalRunOptions) => Promise<EvalRunOutput>;

type RetrievedItem = { itemId: string; kind: ItemKind; sourceChunkIds: string[]; rank: number };

async function env() {
  const mc = await loadMiniCorpus();
  const clock = new FixedClock();
  const ids = new SeqIds();
  const log = new InMemoryEventLog(clock, ids);
  const set = evalFixture<EvalSet>('mini-set');
  const retr = evalFixture<{ retrievals: Record<string, RetrievedItem[]> }>('retrievals').retrievals;
  const verdicts = evalFixture<{ questionId: string; condition: string; score: number; raw: string }[]>('judge-verdicts');
  const searches: Record<string, ScriptedHit[]> = {};
  for (const q of set.questions)
    searches[q.question] = retr[q.id]!.map((it) => ({ itemId: it.itemId as ChunkId, kind: it.kind, text: `text of ${it.itemId}`, score: 1 - it.rank / 10, sourceChunkIds: it.sourceChunkIds as ChunkId[] }));
  const current = { build: mc.builds.v2 };
  const api = createKgApi({ log, clock, ids, currentBuild: () => mc.store.currentBuild() }, fakeHandlers({ buildId: mc.builds.v2, items: miniChunks(1), searches }, log, current));
  const answerer: Llm = { complete: async (r) => ({ text: 'an answer', model: r.model, inputTokens: 1, outputTokens: 2 }) };
  const judge = async (q: EvalQuestion, _a: string, condition: string): Promise<JudgeVerdict> => {
    const v = verdicts.find((x) => x.questionId === q.id && x.condition === condition);
    if (!v) throw new KgError('not_found', `no verdict for ${q.id}/${condition}`);
    return { score: v.score, rationale: '', raw: v.raw };
  };
  const repo = new InMemoryEvalRepo();
  const deps: EvalRunnerDeps = { rt: { log, clock, ids, currentBuild: () => mc.store.currentBuild() }, api, store: mc.store, answerer, judge, repo };
  return { mc, log, set, deps, repo };
}
const evalSessionEvents = (log: InMemoryEventLog) => {
  const s = log.sessions({ kind: 'eval' });
  expect(s.length, 'runEval opens exactly one eval session').toBe(1);
  return log.events(s[0]!.sessionId) as EventEnvelope[];
};

/**
 * Relative order of one eval session (0.6.1), so both the bracketed shape (pipeline.started before eval.run.started,
 * pipeline.finished after eval.run.completed) and the unbracketed one pass: eval.run.started follows the outer
 * tool.called and precedes the first eval.question.scored and every nested query; eval.run.completed follows the last
 * eval.question.scored; tool.returned is last; a present pipeline.started precedes eval.run.started and a present
 * pipeline.finished follows eval.run.completed.
 */
export function expectEvalRunOrder(evs: EventEnvelope[]) {
  const idx = (t: string) => evs.flatMap((e, i) => (e.type === t ? [i] : []));
  const [called] = idx('tool.called');
  const started = idx('eval.run.started');
  const completed = idx('eval.run.completed');
  expect(started.length, 'eval.run.started events').toBe(1);
  expect(completed.length, 'eval.run.completed events').toBe(1);
  expect(called, 'an outer tool.called exists').toBeDefined();
  expect(started[0]!, 'eval.run.started after tool.called').toBeGreaterThan(called!);
  const scored = idx('eval.question.scored');
  const queries = idx('query');
  for (const i of [...scored, ...queries]) expect(started[0]!, `eval.run.started precedes ${evs[i]!.type} at ${i}`).toBeLessThan(i);
  if (scored.length > 0) expect(completed[0]!, 'eval.run.completed after the last eval.question.scored').toBeGreaterThan(scored.at(-1)!);
  expect(completed[0]!).toBeGreaterThan(started[0]!);
  expect(evs.at(-1)!.type, 'tool.returned is last').toBe('tool.returned');
  expect(evs.filter((e) => e.type === 'tool.returned').length).toBe(evs.filter((e) => e.type === 'tool.called').length);
  // nested searches bracket themselves (pipeline 'search'); only the eval-run bracket is meant here
  const own = (t: string) => idx(t).filter((i) => (evs[i]!.payload as { pipeline?: string }).pipeline === 'eval-run');
  const ps = own('pipeline.started');
  const pf = own('pipeline.finished');
  expect(ps.length, 'pipeline.started at most once').toBeLessThanOrEqual(1);
  expect(pf.length, 'pipeline.finished at most once').toBeLessThanOrEqual(1);
  expect(ps.length, 'pipeline.started and pipeline.finished come together').toBe(pf.length);
  if (ps.length === 1) {
    expect(ps[0]!, 'pipeline.started precedes eval.run.started').toBeLessThan(started[0]!);
    expect(pf[0]!, 'pipeline.finished follows eval.run.completed').toBeGreaterThan(completed[0]!);
    expect(pf[0]!, 'pipeline.finished precedes tool.returned').toBeLessThan(evs.length - 1);
  }
}

export function evalRunnerConformance(runEval: RunEval): Suite {
  const CONDS = ['no-context', 'gold', 'retrieved'];
  const KS = [1, 3, 5];
  return {
    name: 'evalRunnerConformance',
    cases: [
      {
        name: 'event order: one eval_run tool call; eval.run.started; per question a nested search (retrieved only); scored per condition; completed',
        async run() {
          const e = await env();
          await runEval(e.deps, e.set, { conditions: CONDS, ks: KS, buildId: e.mc.builds.v1, allowStale: true });
          const evs = evalSessionEvents(e.log);
          const calls = evs.filter((x) => x.type === 'tool.called');
          const outer = calls[0]!;
          expect((outer.payload as { tool: string }).tool).toBe('eval_run');
          expect(outer.parentId).toBeNull();
          expectEvalRunOrder(evs);
          const searches = calls.slice(1);
          expect(searches.map((c) => (c.payload as { tool: string }).tool)).toEqual(e.set.questions.map(() => 'search'));
          for (const c of searches) expect(c.parentId, 'P-3: nested search is parented to eval_run').toBe(outer.id);
          const scored = evs.filter((x): x is EventEnvelope<'eval.question.scored'> => x.type === 'eval.question.scored');
          expect(scored.length).toBe(e.set.questions.length * CONDS.length);
          for (const s of scored) {
            if (s.payload.condition === 'retrieved') expect(s.searchId, `${s.payload.questionId} retrieved names its search`).not.toBeNull();
            else expect(s.searchId).toBeNull();
          }
          for (const x of evs.filter((y) => y.type === 'llm.called')) expect(x.parentId).toBe(outer.id);
        },
      },
      {
        name: 'Rule 4 (0.6.1): eval.run.started and the persisted run config record the judge (recipe, model) and the answerer (model, prompt digest)',
        async run() {
          const e = await env();
          const out = await runEval(e.deps, e.set, { conditions: CONDS, ks: KS, buildId: e.mc.builds.v1, allowStale: true });
          const started = evalSessionEvents(e.log).find((x): x is EventEnvelope<'eval.run.started'> => x.type === 'eval.run.started')!;
          expect(started.payload.judge, 'judge on eval.run.started').toBeDefined();
          expect(started.payload.answerer, 'answerer on eval.run.started').toBeDefined();
          const config = e.repo.getRun(out.runId)!.config;
          expect(config.judge).toEqual(started.payload.judge);
          expect(config.answerer).toEqual(started.payload.answerer);
        },
      },
      {
        name: 'Rule 6: every eval.* event and every nested query carries the pinned build, although another build is current',
        async run() {
          const e = await env();
          const pinned = e.mc.builds.v1;
          expect(e.mc.store.currentBuild()).not.toBe(pinned);
          await runEval(e.deps, e.set, { conditions: CONDS, ks: KS, buildId: pinned, allowStale: true });
          const evs = evalSessionEvents(e.log);
          for (const x of evs.filter((y) => y.type.startsWith('eval.') || y.type === 'query' || y.type === 'search.result')) expect(x.buildId, x.type).toBe(pinned);
          const started = evs.find((x): x is EventEnvelope<'eval.run.started'> => x.type === 'eval.run.started')!;
          expect(started.payload.buildId).toBe(pinned);
        },
      },
      {
        name: 'retrieved recall@k equals the hand-computed metrics; judge scores and results are persisted',
        async run() {
          const e = await env();
          const out = await runEval(e.deps, e.set, { conditions: CONDS, ks: KS, buildId: e.mc.builds.v1, allowStale: true });
          const exp = evalFixture<{ perQuestion: Record<string, { recall: Record<string, number> }> }>('expected-metrics');
          const evs = evalSessionEvents(e.log);
          for (const s of evs.filter((x): x is EventEnvelope<'eval.question.scored'> => x.type === 'eval.question.scored' && x.payload.condition === 'retrieved'))
            for (const k of KS) expect(s.payload.recall?.[String(k)], `${s.payload.questionId}@${k}`).toBeCloseTo(exp.perQuestion[s.payload.questionId]!.recall[String(k)]!, 9);
          const results = e.repo.results(out.runId);
          expect(results.length).toBe(e.set.questions.length * CONDS.length);
          expect(e.repo.getRun(out.runId)?.buildId).toBe(e.mc.builds.v1);
        },
      },
      {
        name: 'a stale pinned build is refused (precondition) unless allowStale, and the refusal is logged',
        async run() {
          const e = await env();
          expect(e.mc.store.staleCheck(e.mc.builds.v1).stale).toBe(true);
          await expectKgError(() => runEval(e.deps, e.set, { conditions: ['retrieved'], ks: [1], buildId: e.mc.builds.v1 }), 'precondition');
          const evs = evalSessionEvents(e.log);
          expect(evs.at(-1)!.type).toBe('tool.failed');
        },
      },
      {
        name: 'S4: questions whose gold chunks left the build are reported as orphaned (core orphanedGold)',
        async run() {
          const e = await env();
          const out = await runEval(e.deps, e.set, { conditions: ['no-context'], ks: [1] });
          const expected = orphanedGold(e.set, e.mc.store, e.mc.builds.v2);
          expect(expected.length).toBeGreaterThan(0); // gas/1-ab, entropy/3-a1 are not in v2
          expect((out.summary as { orphaned: unknown }).orphaned).toEqual(expected);
        },
      },
    ],
  };
}
