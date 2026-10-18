import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { KgError, type BuildId, type ChunkId, type DocKey, type EvalQuestion, type EvalSet, type LlmRequest } from '@kg/core';
import { evalFixture, loadMiniCorpus } from '@kg/testkit';
import { machineMapOf, toMermaid, topologyOf } from '@kg/pipeline';
import { drive, scripted, withActors } from '@kg/pipeline/testing';
import { machineMapConformance, registerSuite } from '@kg/testkit/conformance';
import { promptDigest, evalGenerateMachine, evalQuestionMachine, evalRunMachine, judgeMachine } from '../src/index';
import type { RunInput } from '../src/machines/evalRun';
import type { Outcome, QuestionInput } from '../src/machines/evalQuestion';
import type { GenerationGroup } from '../src/machines/evalGenerate';

const PINS = JSON.parse(readFileSync(new URL('../src/machines/pins.json', import.meta.url), 'utf8')) as Record<string, { topology: string; promptDigest?: string }>;
const MACHINES = [
  { name: 'eval-run', machine: evalRunMachine },
  { name: 'eval-question', machine: evalQuestionMachine },
  { name: 'judge', machine: judgeMachine },
  { name: 'eval-generate', machine: evalGenerateMachine },
] as const;
const mapOf = (name: string) => machineMapOf(MACHINES.find((m) => m.name === name)!.machine, { machine: name, version: '1' });

for (const { name } of MACHINES) registerSuite(machineMapConformance(() => mapOf(name)));

describe('pins and diagrams', () => {
  for (const { name, machine } of MACHINES) {
    it(`${name}@1 is pinned to the topology the machine computes`, () => {
      expect(PINS[`${name}@1`]!.topology).toBe(topologyOf(machine));
    });

    it(`docs/${name}.mmd is the diagram generated from the machine`, () => {
      expect(readFileSync(new URL(`../docs/${name}.mmd`, import.meta.url), 'utf8')).toBe(toMermaid(mapOf(name)));
    });
  }

  it('the prompt-bearing machines pin the digest of the prompt files', () => {
    expect(PINS['judge@1']!.promptDigest).toBe(promptDigest());
    expect(PINS['eval-generate@1']!.promptDigest).toBe(promptDigest());
  });
});

/** Consecutive repeats removed: drive reports a routing initial state twice (as the start snapshot and as its microstep). */
const path = (visited: string[]) => visited.filter((s, i) => s !== visited[i - 1]);
const dummyRequest = {} as LlmRequest;
const good = '{"score": 1, "rationale": "stated"}';

describe('judge paths', () => {
  it('a malformed reply twice, then a valid one, with a retry budget of 2: calling and parsing three times, ends in done', async () => {
    const m = withActors(judgeMachine, { call: scripted(['bad', 'worse', good]) });
    const r = await drive(m, { llm: {} as never, request: dummyRequest, retryBudget: 2 });
    expect(path(r.visited)).toEqual(['calling', 'parsing', 'calling', 'parsing', 'calling', 'parsing', 'done']);
    expect(r.final).toBe('done');
    expect(r.output).toMatchObject({ error: null, verdict: { score: 1, rationale: 'stated', raw: good } });
  });

  it('with a retry budget of 1 the same replies end in failed with invalid_input', async () => {
    const m = withActors(judgeMachine, { call: scripted(['bad', 'worse', good]) });
    const r = await drive(m, { llm: {} as never, request: dummyRequest, retryBudget: 1 });
    expect(path(r.visited)).toEqual(['calling', 'parsing', 'calling', 'parsing', 'failed']);
    expect(r.final).toBe('failed');
    expect(r.output!.error!.code).toBe('invalid_input');
  });

  it('a transport error ends in failed with the error code', async () => {
    const m = withActors(judgeMachine, { call: scripted([new KgError('upstream', 'ollama down')]) });
    const r = await drive(m, { llm: {} as never, request: dummyRequest, retryBudget: 2 });
    expect(r.final).toBe('failed');
    expect(r.output!.error).toMatchObject({ code: 'upstream' });
  });
});

describe('generation paths', () => {
  const group: GenerationGroup = {
    type: 'single-hop',
    passages: [{ id: 'ch_aaaaaaaaaaaaaaaaaaaa' as ChunkId, text: 'a passage', sectionPath: [], docKey: 'gas' as DocKey }],
  };
  const reply = '{"questions": [{"question": "What does the passage say about gas?", "referenceAnswer": "It says a thing.", "type": "single-hop"}]}';

  it('one group, a valid reply: generating, parsing, validating, selecting, done', async () => {
    const m = withActors(evalGenerateMachine, { generate: scripted([reply]) });
    const r = await drive(m, { llm: {} as never, groups: [group], request: () => dummyRequest, retryBudget: 1 });
    expect(path(r.visited)).toEqual(['generating', 'parsing', 'validating', 'selecting', 'done']);
    expect(r.final).toBe('done');
    expect(r.output!.drafts).toHaveLength(1);
  });

  it('malformed replies beyond the budget end in failed', async () => {
    const m = withActors(evalGenerateMachine, { generate: scripted(['bad', 'bad']) });
    const r = await drive(m, { llm: {} as never, groups: [group], request: () => dummyRequest, retryBudget: 1 });
    expect(path(r.visited)).toEqual(['generating', 'parsing', 'generating', 'parsing', 'failed']);
    expect(r.final).toBe('failed');
    expect(r.output!.error?.code).toBe('invalid_input');
  });

  it('no groups: nothing is asked and the run is done with no drafts', async () => {
    const r = await drive(evalGenerateMachine, { llm: {} as never, groups: [], request: () => dummyRequest, retryBudget: 1 });
    expect(r.final).toBe('done');
    expect(r.output!.drafts).toEqual([]);
  });
});

const question: EvalQuestion = { id: 'q1', type: 'single-hop', question: 'Q?', referenceAnswer: 'A.', goldChunkIds: [], goldText: [], sourceDocKeys: [] };
const outcome: Outcome = { questionId: 'q1', condition: 'no-context', searchId: null, ranked: null, recall: null, answer: 'an answer', judgeScore: 1, judgeRaw: good };

describe('per-question path', () => {
  it('no-context: answering, judging, scoring, done (no search)', async () => {
    const m = withActors(evalQuestionMachine, {
      answer: scripted(['an answer']),
      judge: scripted([{ score: 1, rationale: 'stated', raw: good }]),
      score: scripted([outcome]),
    });
    const input: QuestionInput = {
      ctx: {} as never,
      deps: {} as never,
      question,
      condition: 'no-context',
      kind: 'none',
      build: 'bd_aaaaaaaaaaaaaaaaaaaa' as never,
      runId: 'er_00000000000000000000000001' as never,
      ks: [1],
      searchRecipeId: null,
    };
    const r = await drive(m, input);
    expect(path(r.visited)).toEqual(['answering', 'judging', 'scoring', 'done']);
    expect(r.output).toEqual({ outcome, error: null });
  });
});

describe('run path', () => {
  const run = async (o: { buildId?: string | null; allowStale?: boolean; conditions?: string[]; questions?: number; actors?: Record<string, unknown> }) => {
    const mc = await loadMiniCorpus();
    const full = evalFixture<EvalSet>('mini-set');
    const set: EvalSet = { ...full, questions: full.questions.slice(0, o.questions ?? 2) };
    const buildId = o.buildId === null ? undefined : ((o.buildId ?? mc.builds.v1) as BuildId);
    const deps = { rt: { currentBuild: () => null }, store: mc.store } as never;
    const m = withActors(evalRunMachine, {
      pin: scripted(['er_00000000000000000000000001']),
      question: scripted([{ outcome, error: null }, { outcome, error: null }, { outcome, error: null }]),
      complete: scripted([undefined]),
      ...o.actors,
    });
    const input: RunInput = {
      ctx: {} as never,
      deps,
      set,
      evalSetSha256: 'x',
      conditions: o.conditions ?? ['no-context'],
      ks: [1],
      buildId,
      allowStale: o.allowStale ?? true,
      searchRecipes: undefined,
    };
    return { r: await drive(m, input), mc };
  };

  it('checkingBuild, pinning (opening routes away at start and drive does not report it), then question and nextQuestion once per item, summarizing, completing, done', async () => {
    const { r } = await run({});
    expect(path(r.visited)).toEqual(['checkingBuild', 'pinning', 'nextQuestion', 'question', 'nextQuestion', 'question', 'nextQuestion', 'summarizing', 'completing', 'done']);
    expect(r.final).toBe('done');
    expect(r.output).toMatchObject({ runId: 'er_00000000000000000000000001', error: null });
    expect(r.output!.summary).toMatchObject({ questions: 2, orphaned: expect.any(Array) });
  });

  it('every condition runs for every question, in question order', async () => {
    const { r } = await run({ conditions: ['no-context', 'gold'], actors: { question: scripted([{ outcome, error: null }, { outcome, error: null }, { outcome, error: null }, { outcome, error: null }]) } });
    expect(path(r.visited).filter((s) => s === 'question')).toHaveLength(4);
  });

  it('no build at all: failed from opening with precondition', async () => {
    const { r } = await run({ buildId: null });
    expect(path(r.visited)).toEqual(['failed']);
    expect(r.output!.error!.code).toBe('precondition');
  });

  it('an unknown build: failed from checkingBuild with not_found, nothing pinned', async () => {
    const { r } = await run({ buildId: 'bd_zzzzzzzzzzzzzzzzzzzz' });
    expect(path(r.visited)).toEqual(['checkingBuild', 'failed']);
    expect(r.output!.error!.code).toBe('not_found');
  });

  it('a stale build without allowStale: failed with precondition; with allowStale it is pinned', async () => {
    const { r } = await run({ allowStale: false });
    expect(path(r.visited)).toEqual(['checkingBuild', 'failed']);
    expect(r.output!.error!.code).toBe('precondition');
  });

  it('an unknown condition: failed from checkingBuild with invalid_input before pinning', async () => {
    const { r } = await run({ conditions: ['hybrid'] });
    expect(path(r.visited)).toEqual(['checkingBuild', 'failed']);
    expect(r.output!.error!.code).toBe('invalid_input');
  });

  it('a failed question fails the run and nothing is completed', async () => {
    const { r } = await run({ actors: { question: scripted([{ outcome: null, error: new KgError('upstream', 'judge down') }]) } });
    expect(path(r.visited)).toEqual(['checkingBuild', 'pinning', 'nextQuestion', 'question', 'failed']);
    expect(r.output!.error!.code).toBe('upstream');
  });
});
