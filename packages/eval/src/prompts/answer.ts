import type { EvalAnswererInfo, Llm, LlmRequest } from '@kg/core';
import { fill, fileDigest, loadPrompt } from './loader';

/** Settings of the answering model. Recorded in the run config so a rerun can name the model it used. */
export const ANSWER_SETTINGS = { model: 'qwen3.5:latest', temperature: 0, maxTokens: 300 } as const;

/** The request for one answer: the passages (if any) as context, then the question. */
export function answerRequest(question: string, passages: readonly string[]): LlmRequest {
  const p = loadPrompt('answer.md');
  const context = passages.length === 0 ? '' : `Context passages:\n${passages.map((t, i) => `[${i}] ${t}`).join('\n\n')}\n\n`;
  return {
    purpose: 'eval-answer',
    model: ANSWER_SETTINGS.model,
    system: p.system,
    messages: [{ role: 'user', content: fill(p.user, { context, question }) }],
    temperature: ANSWER_SETTINGS.temperature,
    maxTokens: ANSWER_SETTINGS.maxTokens,
  };
}

/** Answers a question from the passages given (none: from the model's own knowledge). Returns the answer text. */
export async function answer(llm: Llm, question: string, passages: readonly string[]): Promise<string> {
  return (await llm.complete(answerRequest(question, passages))).text;
}

/** What a run records about its answerer: the model and the digest of the answer prompt file. */
export function answererInfo(): EvalAnswererInfo {
  return { model: ANSWER_SETTINGS.model, promptDigest: fileDigest('answer.md') };
}
