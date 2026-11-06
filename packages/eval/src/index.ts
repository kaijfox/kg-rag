/** @kg/eval: question generation, answering, judging, retrieval metrics and runs, as plain functions over the kernel. */
export type { EvalQuestion, EvalSet, QuestionDraft, QuestionType, JudgeVerdict, RankedSource } from './types';
export { runEval, evalSetId, type RunOptions } from './run';
export { answer, answerRequest, ANSWER_SETTINGS } from './answer';
export { judge, judgeRequest, JUDGE_SETTINGS } from './judge';
export { generateQuestions, generationRequest, pickGroups, sortDrafts, reusesWording, rng, GENERATE_SETTINGS, type Group, type GenerateSettings, type DroppedDraft } from './generate';
export { parseJudgeReply, parseGenerationReply, minimumUses } from './prompts/parse';
export { promptDigest } from './prompts/loader';
export { retryRequest, askParsed, RETRY_INSTRUCTION } from './ask';
export { recallAtK, allGoldAtK, coveredAtK, mean } from './metrics/recall';
export { retrievalMetrics, judgeMeans, type RetrievalMetrics } from './metrics/summary';
