import type { Llm, LlmRequest } from '@kg/kernel';
import { askParsed } from './ask';
import { fill, loadPrompt } from './prompts/loader';
import { parseJudgeReply } from './prompts/parse';
import type { JudgeVerdict } from './types';

export const JUDGE_SETTINGS = { model: 'qwen3.5:latest', temperature: 0, maxTokens: 200, retryBudget: 2 } as const;

export function judgeRequest(question: string, reference: string, answer: string, model: string = JUDGE_SETTINGS.model): LlmRequest {
  const p = loadPrompt('judge.md');
  return { purpose: 'eval-judge', model, system: p.system, messages: [{ role: 'user', content: fill(p.user, { question, reference, answer }) }], temperature: JUDGE_SETTINGS.temperature, maxTokens: JUDGE_SETTINGS.maxTokens, json: true };
}

/** Grades one answer. A malformed reply is asked again up to the retry budget, then the call fails with invalid_input. */
export async function judge(llm: Llm, question: string, reference: string, answer: string, model?: string): Promise<JudgeVerdict> {
  const { value, raw } = await askParsed(llm, judgeRequest(question, reference, answer, model), parseJudgeReply, JUDGE_SETTINGS.retryBudget);
  return { ...value, raw };
}
