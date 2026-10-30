import { topologyOf } from '@kg/pipeline';
import { KgError, loggedLlm, recipeId, type Ctx, type EvalJudgeInfo, type EvalQuestion, type JudgeVerdict, type Llm, type LlmRequest, type MachineRecipeSpec } from '@kg/core';
import { judgeMachine, type JudgeOutput } from '../machines/judge';
import { settle } from '../machines/settle';
import { fill, loadPrompt, promptDigest } from './loader';

export const JUDGE_SETTINGS = { model: 'qwen3.5:latest', temperature: 0, maxTokens: 200, retryBudget: 2 } as const;

export function judgeRequest(question: string, reference: string, answer: string): LlmRequest {
  const p = loadPrompt('judge.md');
  return {
    purpose: 'eval-judge',
    model: JUDGE_SETTINGS.model,
    system: p.system,
    messages: [{ role: 'user', content: fill(p.user, { question, reference, answer }) }],
    temperature: JUDGE_SETTINGS.temperature,
    maxTokens: JUDGE_SETTINGS.maxTokens,
    json: true,
  };
}

/** Grades one answer. Malformed replies are asked again up to the retry budget, then the call is an invalid_input error. */
export async function judge(llm: Llm, question: string, reference: string, answer: string): Promise<JudgeVerdict> {
  const out = await settle<JudgeOutput>(judgeMachine, { llm, request: judgeRequest(question, reference, answer), retryBudget: JUDGE_SETTINGS.retryBudget });
  if (out.error) throw out.error;
  if (!out.verdict) throw new KgError('internal', 'judge finished without a verdict');
  return out.verdict;
}

/** The judge as the eval runner takes it. The runner passes its context, so every judge call is logged (llm.called) like the answerer's. */
export function makeJudge(llm: Llm): (q: EvalQuestion, answer: string, condition: string, ctx: Ctx) => Promise<JudgeVerdict> {
  return (q, answer, _condition, ctx) => judge(loggedLlm(llm, ctx), q.question, q.referenceAnswer, answer);
}

/** What a run records about its judge: the id of its recipe and the model. */
export function judgeInfo(): EvalJudgeInfo {
  return { recipeId: recipeId(judgeRecipe()), model: JUDGE_SETTINGS.model };
}

/** The judge's recipe: machine, version, typed settings, topology and the digest of the prompt files. */
export function judgeRecipe(): MachineRecipeSpec<'eval-judge', { model: string; temperature: number; maxTokens: number; retryBudget: number }> {
  return {
    kind: 'eval-judge',
    version: '1',
    spec: {
      machine: 'judge',
      settings: { model: JUDGE_SETTINGS.model, temperature: JUDGE_SETTINGS.temperature, maxTokens: JUDGE_SETTINGS.maxTokens, retryBudget: JUDGE_SETTINGS.retryBudget },
      topology: topologyOf(judgeMachine),
      promptDigest: promptDigest(['judge.md']),
    },
  };
}
