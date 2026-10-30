import { describe, expect, it } from 'vitest';
import { KgError, recipeId, requestSha256, type Ctx, type Chunk, type ChunkId, type Llm, type LlmRequest, type LlmResponse } from '@kg/core';
import { topologyOf } from '@kg/pipeline';
import { miniChunks } from '@kg/testkit';
import { ScriptedLlm } from '@kg/testkit';
import {
  ANSWER_SETTINGS,
  GENERATE_SETTINGS,
  JUDGE_SETTINGS,
  answer,
  describeDropped,
  generateQuestions,
  generateQuestionsDetailed,
  generateRecipe,
  judge,
  judgeRecipe,
  parseGenerationReply,
  parseJudgeReply,
  promptDigest,
} from '../src/index';
import { evalGenerateMachine, reusesWording } from '../src/machines/evalGenerate';
import { RETRY_INSTRUCTION } from '../src/machines/retry';
import { judgeMachine } from '../src/machines/judge';
import { GENERATE_PROMPTS } from '../src/prompts/generate';

/** Replies in order, one per call; the requests are kept for inspection. */
class SequenceLlm implements Llm {
  readonly requests: LlmRequest[] = [];
  constructor(private readonly replies: string[]) {}
  async complete(r: LlmRequest): Promise<LlmResponse> {
    this.requests.push(r);
    const text = this.replies.shift();
    if (text === undefined) throw new KgError('not_found', 'no scripted reply left');
    return { text, model: r.model, inputTokens: 1, outputTokens: 1 };
  }
}

const chunks = miniChunks(1);
const id = (i: number): ChunkId => chunks[i]!.id;
const recipe = () => generateRecipe({ ...GENERATE_SETTINGS, retryBudget: 1 });

describe('judge reply parsing', () => {
  it('accepts exactly {score: 0 | 0.5 | 1, rationale}', () => {
    expect(parseJudgeReply('{"score": 0.5, "rationale": "a detail is vague"}')).toEqual({ score: 0.5, rationale: 'a detail is vague' });
    expect(parseJudgeReply('{"score": 1, "rationale": "every fact present"}').score).toBe(1);
  });

  it('refuses other scores, extra keys, a missing rationale, and text that is not JSON', () => {
    for (const bad of ['{"score": 0.7, "rationale": "x"}', '{"score": 1, "rationale": "x", "extra": 1}', '{"score": 1, "rationale": ""}', '{"score": "1", "rationale": "x"}', 'Score: 1', '[1]']) {
      expect(() => parseJudgeReply(bad), bad).toThrow(KgError);
    }
    expect(() => parseJudgeReply('Score: 1')).toThrowError(expect.objectContaining({ code: 'invalid_input' }) as never);
  });
});

describe('generation reply parsing', () => {
  it('a single-hop question uses passage 0 by default', () => {
    const r = parseGenerationReply('{"questions": [{"question": "q?", "referenceAnswer": "a.", "type": "single-hop"}]}', 'single-hop', 1);
    expect(r).toEqual([{ question: 'q?', referenceAnswer: 'a.', uses: [0] }]);
  });

  it('multi-hop needs at least two passages, all in range and unique', () => {
    const ok = '{"questions": [{"question": "q?", "referenceAnswer": "a.", "type": "multi-hop", "uses": [1, 0]}]}';
    expect(parseGenerationReply(ok, 'multi-hop', 2)[0]!.uses).toEqual([0, 1]);
    for (const bad of [
      '{"questions": [{"question": "q?", "referenceAnswer": "a.", "type": "multi-hop", "uses": [0]}]}',
      '{"questions": [{"question": "q?", "referenceAnswer": "a.", "type": "multi-hop", "uses": [0, 5]}]}',
      '{"questions": [{"question": "q?", "referenceAnswer": "a.", "type": "multi-hop", "uses": [0, 0]}]}',
      '{"questions": [{"question": "q?", "referenceAnswer": "a.", "type": "single-hop"}]}',
      '{"questions": [{"question": "q?", "referenceAnswer": "a.", "type": "topic", "uses": [0, 1, 2]}]}',
    ]) {
      expect(() => parseGenerationReply(bad, 'multi-hop', 3), bad).toThrow(KgError);
    }
  });

  it('a passage number repeated is refused even when enough distinct numbers remain', () => {
    const mh = '{"questions": [{"question": "q?", "referenceAnswer": "a.", "type": "multi-hop", "uses": [0, 1, 1]}]}';
    const tp = '{"questions": [{"question": "q?", "referenceAnswer": "a.", "type": "topic", "uses": [0, 0, 1, 2]}]}';
    expect(() => parseGenerationReply(mh, 'multi-hop', 3)).toThrow(KgError);
    expect(() => parseGenerationReply(tp, 'topic', 3)).toThrow(KgError);
  });

  it('a topic question needs three passages when the section has three', () => {
    expect(() => parseGenerationReply('{"questions": [{"question": "q", "referenceAnswer": "a", "type": "topic", "uses": [0, 1]}]}', 'topic', 3)).toThrow(KgError);
    expect(parseGenerationReply('{"questions": [{"question": "q", "referenceAnswer": "a", "type": "topic", "uses": [0, 1]}]}', 'topic', 2)).toHaveLength(1);
  });
});

describe('generateQuestions', () => {
  const groups = (): { type: 'single-hop' | 'multi-hop' | 'topic'; chunkIds: ChunkId[] }[] => [
    { type: 'single-hop', chunkIds: [id(0)] },
    { type: 'multi-hop', chunkIds: [id(0), id(1)] },
  ];

  it('writes one draft per question with the gold chunks it uses, sorted by id', async () => {
    const llm = new SequenceLlm([
      '{"questions": [{"question": "How does a shrinking volume change pressure in a sealed vessel?", "referenceAnswer": "It raises it.", "type": "single-hop"}]}',
      '{"questions": [{"question": "Relate the two quantities.", "referenceAnswer": "They trade off.", "type": "multi-hop", "uses": [1, 0]}]}',
    ]);
    const out = await generateQuestions(llm, chunks, groups(), recipe());
    expect(out.map((d) => d.type)).toEqual(['single-hop', 'multi-hop']);
    expect(out[0]!.goldChunkIds).toEqual([id(0)]);
    expect(out[1]!.goldChunkIds).toEqual([id(0), id(1)].sort());
    expect(out[1]!.goldText).toHaveLength(2);
    expect(llm.requests.map((r) => r.purpose)).toEqual(['eval-generate', 'eval-generate']);
  });

  it('a generation retry also differs from the first request', async () => {
    const good = '{"questions": [{"question": "A question about entropy at equilibrium?", "referenceAnswer": "It is maximal.", "type": "single-hop"}]}';
    const llm = new SequenceLlm(['not json', good]);
    await generateQuestions(llm, chunks, [{ type: 'single-hop', chunkIds: [id(0)] }], recipe());
    expect(requestSha256(llm.requests[1]!)).not.toBe(requestSha256(llm.requests[0]!));
    expect(llm.requests[1]!.messages.at(-1)).toEqual({ role: 'user', content: RETRY_INSTRUCTION });
  });

  it('retries a malformed reply and gives up after the budget', async () => {
    const good = '{"questions": [{"question": "A question about entropy at equilibrium?", "referenceAnswer": "It is maximal.", "type": "single-hop"}]}';
    const retried = new SequenceLlm(['not json', good, good]);
    await generateQuestions(retried, chunks, [{ type: 'single-hop', chunkIds: [id(0)] }], recipe());
    expect(retried.requests).toHaveLength(2);
    const stuck = new SequenceLlm(['not json', 'still not', 'nope']);
    await expect(generateQuestions(stuck, chunks, [{ type: 'single-hop', chunkIds: [id(0)] }], recipe())).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('drops a question that repeats another question, and one that copies four words of its passage', async () => {
    const dup = '{"questions": [{"question": "Why is the pressure of a gas raised?", "referenceAnswer": "a", "type": "single-hop"}, {"question": "Why is the pressure of a gas raised?", "referenceAnswer": "b", "type": "single-hop"}]}';
    const out = await generateQuestions(new SequenceLlm([dup]), chunks, [{ type: 'single-hop', chunkIds: [id(0)] }], recipe());
    expect(out).toHaveLength(1);
    const run = chunks[0]!.text.split(/\s+/).slice(3, 8).join(' ');
    const copy = JSON.stringify({ questions: [{ question: `Why does ${run} matter?`, referenceAnswer: 'a', type: 'single-hop' }] });
    const none = await generateQuestions(new SequenceLlm([copy]), chunks, [{ type: 'single-hop', chunkIds: [id(0)] }], recipe());
    expect(none).toEqual([]);
  });

  it('reports each dropped draft with its group and reason, and the recipe id of the set', async () => {
    const run = chunks[0]!.text.split(/\s+/).slice(3, 8).join(' ');
    const ok = { question: 'Why is the pressure of a gas raised?', referenceAnswer: 'a', type: 'single-hop' };
    const copy = { question: `Why does ${run} matter?`, referenceAnswer: 'a', type: 'single-hop' };
    const llm = new SequenceLlm([JSON.stringify({ questions: [ok] }), JSON.stringify({ questions: [ok, copy] })]);
    const two = [{ type: 'single-hop' as const, chunkIds: [id(0)] }, { type: 'single-hop' as const, chunkIds: [id(0)] }];
    const out = await generateQuestionsDetailed(llm, chunks, two, recipe());
    expect(out.drafts).toHaveLength(1);
    expect(out.dropped).toEqual([
      { group: 1, reason: 'duplicate', question: ok.question },
      { group: 1, reason: 'wording-copy', question: copy.question },
    ]);
    expect(out.genRecipeId).toBe(recipeId(recipe()));
    expect(describeDropped(out.dropped)).toBe('2 drafts dropped: group 1 duplicate, group 1 wording-copy');
    expect(describeDropped([])).toBe('no drafts dropped');
  });

  it('the group index of a dropped draft counts groups skipped by the mix', async () => {
    const dup = '{"questions": [{"question": "Why is the pressure of a gas raised?", "referenceAnswer": "a", "type": "single-hop"}, {"question": "Why is the pressure of a gas raised?", "referenceAnswer": "b", "type": "single-hop"}]}';
    const r = generateRecipe({ ...GENERATE_SETTINGS, mix: { 'single-hop': 1, 'multi-hop': 0, topic: 0 } });
    const gs = [{ type: 'multi-hop' as const, chunkIds: [id(0), id(1)] }, { type: 'single-hop' as const, chunkIds: [id(0)] }];
    const out = await generateQuestionsDetailed(new SequenceLlm([dup]), chunks, gs, r);
    expect(out.dropped.map((d) => d.group)).toEqual([1]);
  });

  it('with a ctx every generation call is logged as llm.called', async () => {
    const emitted: { type: string; payload: Record<string, unknown> }[] = [];
    let t = 0;
    const ctx = { clock: { monotonicMs: () => (t += 5) }, emit: (type: string, payload: Record<string, unknown>) => (emitted.push({ type, payload }), {}) } as unknown as Ctx;
    const good = '{"questions": [{"question": "A question about entropy at equilibrium?", "referenceAnswer": "It is maximal.", "type": "single-hop"}]}';
    await generateQuestions(new SequenceLlm(['not json', good]), chunks, [{ type: 'single-hop', chunkIds: [id(0)] }], recipe(), { ctx });
    expect(emitted.map((e) => e.type)).toEqual(['llm.called', 'llm.called']);
    expect(emitted[0]!.payload).toMatchObject({ purpose: 'eval-generate' });
  });

  it('skips a type the mix sets to zero, and names unknown chunks as invalid_input', async () => {
    const llm = new SequenceLlm([]);
    const r = generateRecipe({ ...GENERATE_SETTINGS, mix: { 'single-hop': 0, 'multi-hop': 0, topic: 0 } });
    expect(await generateQuestions(llm, chunks, groups(), r)).toEqual([]);
    expect(llm.requests).toHaveLength(0);
    await expect(generateQuestions(new SequenceLlm([]), chunks, [{ type: 'single-hop', chunkIds: ['ch_missing00000000000000' as ChunkId] }], recipe())).rejects.toMatchObject({
      code: 'invalid_input',
    });
  });

  it('refuses a recipe that names another machine or topology', async () => {
    const r = { ...recipe(), spec: { ...recipe().spec, topology: '0000000000000000' } };
    await expect(generateQuestions(new SequenceLlm([]), chunks, groups(), r)).rejects.toMatchObject({ code: 'invalid_input' });
  });
});

describe('wording reuse', () => {
  const passage = 'the pressure of a gas rises when the volume shrinks';
  it('four consecutive words of a passage are a copy; three are not', () => {
    expect(reusesWording('why does the pressure of a thing change', [passage])).toBe(true); // "the pressure of a"
    expect(reusesWording('why does the pressure of change', [passage])).toBe(false); // "the pressure of" only
    expect(reusesWording('Pressure, of a GAS: rises?', [passage])).toBe(true); // case and punctuation ignored
  });
});

describe('judge', () => {
  it('returns the verdict of a valid reply', async () => {
    const v = await judge(new ScriptedLlm({ byPurpose: { 'eval-judge': '{"score": 1, "rationale": "stated"}' } }), 'Q?', 'the reference', 'an answer');
    expect(v).toMatchObject({ score: 1, rationale: 'stated' });
  });

  it('asks again on a malformed reply, up to the retry budget (two), then fails with invalid_input', async () => {
    const ok = '{"score": 0.5, "rationale": "partly"}';
    const second = new SequenceLlm(['bad', 'worse', ok]);
    expect((await judge(second, 'Q?', 'ref', 'ans')).score).toBe(0.5);
    expect(second.requests).toHaveLength(3);
    const never = new SequenceLlm(['bad', 'worse', 'worst']);
    await expect(judge(never, 'Q?', 'ref', 'ans')).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('a retry differs from the first request and from the earlier retries, and the first request is unchanged', async () => {
    const llm = new SequenceLlm(['bad', 'bad', '{"score": 0, "rationale": "wrong"}']);
    await judge(llm, 'Q?', 'ref', 'ans');
    const [a, b, c] = llm.requests as [LlmRequest, LlmRequest, LlmRequest];
    expect(requestSha256(b)).not.toBe(requestSha256(a));
    expect(requestSha256(c)).not.toBe(requestSha256(b));
    expect(b.messages).toEqual([...a.messages, { role: 'assistant', content: 'bad' }, { role: 'user', content: RETRY_INSTRUCTION }]);
    expect(c.messages).toHaveLength(a.messages.length + 4);
    expect({ ...b, messages: a.messages }).toEqual(a); // same prompt, model, settings
  });

  it('the judge recipe names the judge machine, its topology, the settings and the prompt digest', () => {
    const r = judgeRecipe();
    expect(r.kind).toBe('eval-judge');
    expect(r.spec.topology).toBe(topologyOf(judgeMachine));
    expect(r.spec.promptDigest).toBe(promptDigest(['judge.md']));
    expect(r.spec.promptDigest).not.toBe(promptDigest(GENERATE_PROMPTS));
    expect(r.spec.settings).toMatchObject({ model: JUDGE_SETTINGS.model, retryBudget: JUDGE_SETTINGS.retryBudget });
  });

  it('the generation recipe names its machine and topology', () => {
    expect(generateRecipe().spec.topology).toBe(topologyOf(evalGenerateMachine));
  });
});

describe('answer', () => {
  it('sends the passages as context and returns the text; no passages means no context block', async () => {
    const llm = new SequenceLlm(['an answer', 'another']);
    expect(await answer(llm, 'What is it?', ['passage one'])).toBe('an answer');
    expect(llm.requests[0]!.messages[0]!.content).toContain('[0] passage one');
    expect(await answer(llm, 'What is it?', [])).toBe('another');
    expect(llm.requests[1]!.messages[0]!.content.startsWith('Question:')).toBe(true);
    expect(llm.requests[1]!.model).toBe(ANSWER_SETTINGS.model);
  });
});

describe('the prompt files', () => {
  it('the digest is a sha256 hex string over the named files, and depends on those files only', () => {
    expect(promptDigest(['judge.md'])).toMatch(/^[0-9a-f]{64}$/);
    expect(promptDigest(['judge.md', 'answer.md'])).not.toBe(promptDigest(['judge.md']));
    expect(promptDigest(['answer.md', 'judge.md'])).toBe(promptDigest(['judge.md', 'answer.md']));
  });
});

export type { Chunk };
