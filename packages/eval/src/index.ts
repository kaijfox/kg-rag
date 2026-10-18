/**
 * @kg/eval: eval runs (metrics, runner, per-question machine) and the LLM side (question generation, answering,
 * judging), each with its machine. See README.md for the decisions.
 */
export { runEval, conditionKind } from './runner/run';
export type { RunDeps, EvalRunOptions, RunEval } from './runner/types';
export { recallAtK, allGoldAtK, coveredAtK, mean } from './metrics/recall';
export type { RankedSource, RecallOptions } from './metrics/recall';
export { retrievalMetrics, judgeMeans } from './metrics/summary';
export type { RetrievalMetrics } from './metrics/summary';
export { judge, judgeRequest, judgeRecipe, judgeInfo, makeJudge, JUDGE_SETTINGS } from './prompts/judge';
export { generateQuestions, generateQuestionsDetailed, describeDropped, generateRecipe, generationRequest, GENERATE_SETTINGS } from './prompts/generate';
export type { GenerateSettings, Generated } from './prompts/generate';
export { answer, answerRequest, answererInfo, ANSWER_SETTINGS } from './prompts/answer';
export { parseJudgeReply, parseGenerationReply } from './prompts/parse';
export { promptDigest } from './prompts/loader';
export { evalRunMachine } from './machines/evalRun';
export { evalQuestionMachine } from './machines/evalQuestion';
export { judgeMachine } from './machines/judge';
export { evalGenerateMachine } from './machines/evalGenerate';
export type { DroppedDraft } from './machines/evalGenerate';
export { retryRequest, RETRY_INSTRUCTION } from './machines/retry';
