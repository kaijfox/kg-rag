import { describe, expect, it } from 'vitest';
import { DEFAULT_SEARCH_RECIPE, EVENT_TYPES, KgError, createKgApi, recipeId, type ChunkId, type KgApi, type EvalSet, type EventEnvelope, type ItemKind } from '@kg/core';
import { machineMapOf } from '@kg/pipeline';
import { FixedClock, InMemoryEvalRepo, ScriptedLlm, InMemoryEventLog, SeqIds, evalFixture, fakeHandlers, loadMiniCorpus, type MiniCorpus, type ScriptedHit } from '@kg/testkit';
import { ANSWER_SETTINGS, evalQuestionMachine, evalRunMachine, judgeMachine, evalGenerateMachine, judgeInfo, answererInfo, makeJudge, runEval, type RunDeps } from '../src/index';

type Retrieval = { itemId: string; kind: ItemKind; sourceChunkIds: string[]; rank: number };

async function env() {
  const mc: MiniCorpus = await loadMiniCorpus();
  const clock = new FixedClock();
  const ids = new SeqIds();
  const log = new InMemoryEventLog(clock, ids);
  const set = evalFixture<EvalSet>('mini-set');
  const retr = evalFixture<{ retrievals: Record<string, Retrieval[]> }>('retrievals').retrievals;
  const verdicts = evalFixture<{ questionId: string; condition: string; score: number; raw: string }[]>('judge-verdicts');
  const searches: Record<string, ScriptedHit[]> = {};
  for (const q of set.questions)
    searches[q.question] = retr[q.id]!.map((it) => ({ itemId: it.itemId as ChunkId, kind: it.kind, text: `text of ${it.itemId}`, score: 1 - it.rank / 10, sourceChunkIds: it.sourceChunkIds as ChunkId[] }));
  const current = { build: mc.builds.v2 };
  const api = createKgApi({ log, clock, ids, currentBuild: () => mc.store.currentBuild() }, fakeHandlers({ buildId: mc.builds.v2, items: [], searches }, log, current));
  const repo = new InMemoryEvalRepo();
  const deps: RunDeps = {
    rt: { log, clock, ids, currentBuild: () => mc.store.currentBuild() },
    api,
    store: mc.store,
    answerer: { complete: async (r) => ({ text: 'an answer', model: r.model, inputTokens: 1, outputTokens: 2 }) },
    judge: async (q, _a, condition) => {
      const v = verdicts.find((x) => x.questionId === q.id && x.condition === condition);
      if (!v) return { score: 0, rationale: 'no scripted verdict', raw: '{}' };
      return { score: v.score, rationale: '', raw: v.raw };
    },
    repo,
  };
  return { mc, log, set, deps, repo };
}

const sessionEvents = (log: InMemoryEventLog): EventEnvelope[] => {
  const [s] = log.sessions({ kind: 'eval' });
  return log.events(s!.sessionId) as EventEnvelope[];
};

describe('golden run: no-context under a pinned build', () => {
  it('one session, one eval_run call, then per question a call of the answerer and a scored event', async () => {
    const e = await env();
    await runEval(e.deps, e.set, { conditions: ['no-context'], ks: [1], buildId: e.mc.builds.v1, allowStale: true });
    const types = sessionEvents(e.log).map((x) => x.type);
    const perQuestion = ['llm.called', 'eval.question.scored'];
    expect(types).toEqual([
      'session.started',
      'tool.called',
      'pipeline.started',
      'eval.run.started',
      ...e.set.questions.flatMap(() => perQuestion),
      'eval.run.completed',
      'pipeline.finished',
      'tool.returned',
    ]);
    const finished = sessionEvents(e.log).find((x) => x.type === 'pipeline.finished')!;
    expect(finished.payload).toEqual({ pipeline: 'eval-run', status: 'done', state: 'done' });
  });
});

describe('condition names', () => {
  it('an unknown condition is refused before the run starts, and the refusal is logged', async () => {
    const e = await env();
    await expect(runEval(e.deps, e.set, { conditions: ['hybrid'], ks: [1], buildId: e.mc.builds.v1, allowStale: true })).rejects.toMatchObject({ code: 'invalid_input' });
    const types = sessionEvents(e.log).map((x) => x.type);
    expect(types).not.toContain('eval.run.started');
    expect(types.at(-1)).toBe('tool.failed');
  });

  it('a variant name with a search recipe is a retrieved condition', async () => {
    const e = await env();
    const recipe = recipeId(DEFAULT_SEARCH_RECIPE);
    const out = await runEval(e.deps, e.set, { conditions: ['retrieved-alt'], ks: [1, 5], buildId: e.mc.builds.v1, allowStale: true, searchRecipes: { 'retrieved-alt': recipe } });
    expect(out.summary).toMatchObject({ byCondition: { 'retrieved-alt': { retrieval: { ks: [1, 5] } } } });
  });
});

describe('oracle-gold-first', () => {
  it('puts the gold chunks first, so recall at k >= |gold| is 1 when every gold chunk is in the build', async () => {
    const e = await env();
    const out = await runEval(e.deps, e.set, { conditions: ['oracle-gold-first'], ks: [1, 5], buildId: e.mc.builds.v1, allowStale: true });
    const q1 = e.repo.results(out.runId).find((r) => r.questionId === 'q1')!;
    expect(q1.condition).toBe('oracle-gold-first');
    expect(q1.recall).toEqual({ '1': 1, '5': 1 });
    expect(q1.searchId).not.toBeNull();
  });
});

describe('declared logs', () => {
  it('every event a full run emits is declared by a work state of one of the eval machines', async () => {
    const e = await env();
    await runEval(e.deps, e.set, { conditions: ['no-context', 'gold', 'retrieved', 'oracle-gold-first'], ks: [1, 3, 5], buildId: e.mc.builds.v1, allowStale: true });
    const declared = new Set(
      [evalRunMachine, evalQuestionMachine, judgeMachine, evalGenerateMachine].flatMap((m, i) =>
        machineMapOf(m, { machine: ['eval-run', 'eval-question', 'judge', 'eval-generate'][i]!, version: '1' }).nodes.flatMap((n) => n.logs),
      ),
    );
    const emitted = new Set(sessionEvents(e.log).map((x) => x.type));
    for (const t of emitted) {
      expect(EVENT_TYPES as string[]).toContain(t);
      if (t === 'eval.question.scored' || t === 'llm.called' || t === 'search.result') expect(declared.has(t), t).toBe(true);
    }
    expect(emitted.has('eval.question.scored') && emitted.has('llm.called')).toBe(true);
  });
});

describe('the whole run is one eval-run pipeline', () => {
  it('a refusal before the pin is inside the bracket: pipeline.started, pipeline.finished failed at the failing state, tool.failed', async () => {
    const e = await env();
    await expect(runEval(e.deps, e.set, { conditions: ['retrieved'], ks: [1], buildId: e.mc.builds.v1 })).rejects.toMatchObject({ code: 'precondition' });
    const types = sessionEvents(e.log).map((x) => x.type);
    expect(types).toEqual(['session.started', 'tool.called', 'pipeline.started', 'pipeline.finished', 'tool.failed']);
    expect(sessionEvents(e.log)[3]!.payload).toMatchObject({ pipeline: 'eval-run', status: 'failed', state: 'failed', error: { code: 'precondition' } });
  });

  it('a failing work state is named in pipeline.finished', async () => {
    const e = await env();
    const deps = { ...e.deps, answerer: { complete: async () => { throw new KgError('upstream', 'answerer down'); } } };
    await expect(runEval(deps, e.set, { conditions: ['no-context'], ks: [1], buildId: e.mc.builds.v1, allowStale: true })).rejects.toMatchObject({ code: 'upstream' });
    const fin = sessionEvents(e.log).find((x) => x.type === 'pipeline.finished')!;
    expect(fin.payload).toMatchObject({ pipeline: 'eval-run', status: 'failed', state: 'question', error: { code: 'upstream' } });
  });

  it('an unknown build is not_found and writes no run', async () => {
    const e = await env();
    await expect(runEval(e.deps, e.set, { conditions: ['no-context'], ks: [1], buildId: 'bd_zzzzzzzzzzzzzzzzzzzz' as never })).rejects.toMatchObject({ code: 'not_found' });
    expect(sessionEvents(e.log).map((x) => x.type)).not.toContain('eval.run.started');
  });
});

describe('judge and answerer are recorded', () => {
  it('eval.run.started and the run config carry the judge recipe and model and the answerer model and prompt digest', async () => {
    const e = await env();
    const out = await runEval(e.deps, e.set, { conditions: ['no-context'], ks: [1], buildId: e.mc.builds.v1, allowStale: true });
    const started = sessionEvents(e.log).find((x) => x.type === 'eval.run.started')!;
    expect(started.payload).toMatchObject({ judge: judgeInfo(), answerer: answererInfo() });
    expect(judgeInfo().recipeId).toMatch(/^rc_/);
    expect(answererInfo()).toEqual({ model: ANSWER_SETTINGS.model, promptDigest: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect(e.repo.getRun(out.runId)!.config).toMatchObject({ judge: judgeInfo(), answerer: answererInfo(), conditions: ['no-context'], ks: [1] });
  });
});

describe('the judge is logged like the answerer', () => {
  it('one llm.called with purpose eval-judge per result, parented to the eval_run call, beside one eval-answer each', async () => {
    const e = await env();
    const judgeLlm = new ScriptedLlm({ byPurpose: { 'eval-judge': '{"score": 1, "rationale": "stated"}' } });
    const deps: RunDeps = { ...e.deps, judge: makeJudge(judgeLlm) };
    const out = await runEval(deps, e.set, { conditions: ['no-context', 'gold'], ks: [1], buildId: e.mc.builds.v1, allowStale: true });
    const evs = sessionEvents(e.log);
    const calls = evs.filter((x): x is EventEnvelope<'llm.called'> => x.type === 'llm.called');
    const results = e.repo.results(out.runId);
    expect(results).toHaveLength(e.set.questions.length * 2);
    expect(calls.filter((c) => c.payload.purpose === 'eval-judge')).toHaveLength(results.length);
    expect(calls.filter((c) => c.payload.purpose === 'eval-answer')).toHaveLength(results.length);
    const outer = evs.find((x) => x.type === 'tool.called')!;
    for (const c of calls) expect(c.parentId).toBe(outer.id);
    expect(new Set(calls.map((c) => c.payload.requestSha256)).size, 'judge requests differ per answer/question').toBeGreaterThan(1);
  });
});

describe('what each condition feeds the answerer and the search', () => {
  it('the gold condition gives every gold text of a multi-hop question, in order', async () => {
    const e = await env();
    const seen: string[] = [];
    const deps: RunDeps = { ...e.deps, answerer: { complete: async (r) => (seen.push(r.messages[0]!.content), { text: 'a', model: r.model, inputTokens: 1, outputTokens: 1 }) } };
    const q3 = { ...e.set, questions: e.set.questions.filter((q) => q.id === 'q3') };
    expect(q3.questions[0]!.goldText.length).toBeGreaterThan(1);
    await runEval(deps, q3, { conditions: ['gold'], ks: [1], buildId: e.mc.builds.v1, allowStale: true });
    expect(seen).toHaveLength(1);
    q3.questions[0]!.goldText.forEach((t, i) => expect(seen[0]).toContain(`[${i}] ${t}`));
  });

  it('a condition with its own search recipe searches with that recipe; the others use the build default', async () => {
    const e = await env();
    const inputs: { searchRecipeId?: unknown }[] = [];
    const api: KgApi = { ...e.deps.api, search: (s, i) => (inputs.push(i), e.deps.api.search(s, i)) };
    const recipe = recipeId(DEFAULT_SEARCH_RECIPE);
    const one = { ...e.set, questions: e.set.questions.slice(0, 1) };
    await runEval({ ...e.deps, api }, one, { conditions: ['retrieved', 'retrieved-alt'], ks: [1], buildId: e.mc.builds.v1, allowStale: true, searchRecipes: { 'retrieved-alt': recipe } });
    expect(inputs).toHaveLength(2);
    expect(inputs[0]!.searchRecipeId).toBeUndefined();
    expect(inputs[1]!.searchRecipeId).toBe(recipe);
  });
});

describe('oracle-gold-first list', () => {
  it('has each item once even when a gold chunk is also retrieved, and starts with the gold chunks in gold order', async () => {
    const e = await env();
    const q3 = e.set.questions.find((q) => q.id === 'q3')!;
    const out = await runEval(e.deps, { ...e.set, questions: [q3] }, { conditions: ['oracle-gold-first'], ks: [5], buildId: e.mc.builds.v1, allowStale: true });
    const list = e.repo.results(out.runId)[0]!.retrieved!;
    expect(new Set(list).size).toBe(list.length);
    expect(list.slice(0, q3.goldChunkIds.length)).toEqual(q3.goldChunkIds);
    expect(list.length).toBeLessThanOrEqual(5);
  });

  it('leaves out a gold chunk that is not a member of the pinned build from the list', async () => {
    const e = await env();
    const q4 = e.set.questions.find((q) => q.id === 'q4')!;
    const [kept, missing] = q4.goldChunkIds; // the fixture: the second gold chunk of q4 is not in build v2 and is not itself retrieved
    expect(e.mc.store.getBuild(e.mc.builds.v2)!.itemIds).not.toContain(missing);
    const out = await runEval(e.deps, { ...e.set, questions: [q4] }, { conditions: ['oracle-gold-first'], ks: [5], buildId: e.mc.builds.v2 });
    const r = e.repo.results(out.runId)[0]!;
    expect(r.retrieved![0]).toBe(kept);
    expect(r.retrieved).not.toContain(missing);
  });
});
