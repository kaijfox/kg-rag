import type { Llm, LlmRequest } from '@kg/kernel';
import { fill, loadPrompt } from './prompts/loader';

export const ANSWER_SETTINGS = { model: 'qwen3.5:latest', temperature: 0, maxTokens: 300 } as const;

/** The request for one answer: the passages (if any) as context, then the question. */
export function answerRequest(question: string, passages: readonly string[], model: string = ANSWER_SETTINGS.model): LlmRequest {
  const p = loadPrompt('answer.md');
  const context = passages.length === 0 ? '' : `Context passages:\n${passages.map((t, i) => `[${i}] ${t}`).join('\n\n')}\n\n`;
  return { purpose: 'eval-answer', model, system: p.system, messages: [{ role: 'user', content: fill(p.user, { context, question }) }], temperature: ANSWER_SETTINGS.temperature, maxTokens: ANSWER_SETTINGS.maxTokens };
}

/** Answers from the passages given (none: from the model's own knowledge). */
export async function answer(llm: Llm, question: string, passages: readonly string[], model?: string): Promise<string> {
  return (await llm.complete(answerRequest(question, passages, model))).text;
}
