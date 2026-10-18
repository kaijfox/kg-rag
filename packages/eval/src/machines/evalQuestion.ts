import {
  KgError,
  loggedLlm,
  type BuildId,
  type ChunkId,
  type Ctx,
  type EvalCondition,
  type EvalQuestion,
  type EvalRunId,
  type ItemId,
  type ItemKind,
  type RecipeId,
  type SearchId,
} from '@kg/core';
import { assign, loggedActor, setup, toKgError } from '@kg/pipeline';
import { answer } from '../prompts/answer';
import { recallAtK, type RankedSource } from '../metrics/recall';
import type { RunDeps } from '../runner/types';

/** The three kinds of context a condition can have. `none` answers without context. */
export type ConditionKind = 'none' | 'gold' | 'retrieved' | 'oracle';

export interface RankedItem extends RankedSource {
  itemId: string;
  text: string;
}

export interface Outcome {
  questionId: string;
  condition: EvalCondition;
  searchId: SearchId | null;
  ranked: RankedItem[] | null;
  recall: Record<string, number> | null;
  answer: string;
  judgeScore: number;
  judgeRaw: string;
}

export interface QuestionInput {
  ctx: Ctx;
  deps: RunDeps;
  question: EvalQuestion;
  condition: string;
  kind: ConditionKind;
  build: BuildId;
  runId: EvalRunId;
  ks: number[];
  searchRecipeId: RecipeId | null;
}

export interface QuestionContext {
  input: QuestionInput;
  passages: string[];
  ranked: RankedItem[] | null;
  searchId: SearchId | null;
  answer: string;
  verdict: { score: number; rationale: string; raw: string } | null;
  outcome: Outcome | null;
  error: KgError | null;
}

export interface QuestionOutput {
  outcome: Outcome | null;
  error: KgError | null;
}

const maxK = (ks: readonly number[]) => Math.max(...ks);

async function retrieve(input: QuestionInput): Promise<{ searchId: SearchId; items: RankedItem[] }> {
  const { ctx, deps, question, build, ks, searchRecipeId } = input;
  const res = await deps.api.search(ctx.sessionId, {
    query: question.question,
    k: maxK(ks),
    buildId: build,
    ...(searchRecipeId ? { searchRecipeId } : {}),
  });
  return {
    searchId: res.searchId,
    items: res.items.map((i) => ({ itemId: i.itemId, kind: i.kind, sourceChunkIds: [...i.sourceChunkIds], text: i.text })),
  };
}

/** The oracle list: gold chunks of the build in gold order, then the retrieved items not already present, cut to max k. */
async function oracle(input: QuestionInput): Promise<{ searchId: SearchId; items: RankedItem[] }> {
  const { deps, question, build, ks } = input;
  const retrieved = await retrieve(input);
  const members = new Set<string>(deps.store.getBuild(build)?.itemIds ?? []);
  const gold = question.goldChunkIds.filter((c) => members.has(c));
  const goldItems = deps.store.getItems(gold as ChunkId[]).map((i) => ({
    itemId: i.id,
    kind: i.kind as ItemKind,
    sourceChunkIds: [...i.sourceChunkIds],
    text: i.text,
  }));
  const present = new Set<string>(goldItems.map((i) => i.itemId));
  const rest = retrieved.items.filter((i) => !present.has(i.itemId));
  return { searchId: retrieved.searchId, items: [...goldItems, ...rest].slice(0, maxK(ks)) };
}

function scoreOf(input: QuestionInput, ranked: RankedItem[] | null): Record<string, number> | null {
  const q = input.question;
  if (!ranked || q.goldChunkIds.length === 0) return null;
  return Object.fromEntries(input.ks.map((k) => [String(k), recallAtK(q, ranked, k)]));
}

const retrieveActor = loggedActor(['search.result'], retrieve);
const oracleActor = loggedActor(['search.result'], oracle);
const answerActor = loggedActor(['llm.called'], ({ ctx, deps, question, passages }: { ctx: Ctx; deps: RunDeps; question: string; passages: string[] }) =>
  answer(loggedLlm(deps.answerer, ctx), question, passages),
);
const judgeActor = loggedActor(['llm.called'], ({ ctx, deps, question, answer, condition }: { ctx: Ctx; deps: RunDeps; question: EvalQuestion; answer: string; condition: string }) =>
  deps.judge(question, answer, condition, ctx),
);
const scoreActor = loggedActor(['eval.question.scored'], async ({ input, ranked, searchId, answer, verdict }: { input: QuestionInput; ranked: RankedItem[] | null; searchId: SearchId | null; answer: string; verdict: { score: number; raw: string } }) => {
  const { ctx, deps, question, condition, build, runId } = input;
  const recall = scoreOf(input, ranked);
  const judgeScore = verdict.score;
  ctx.emit('eval.question.scored', { runId, questionId: question.id, condition, recall, judgeScore }, { buildId: build, searchId });
  const outcome: Outcome = { questionId: question.id, condition, searchId, ranked, recall, answer, judgeScore, judgeRaw: verdict.raw };
  deps.repo.putResult({
    runId,
    questionId: question.id,
    condition,
    searchId,
    retrieved: ranked ? ranked.map((r) => r.itemId as ItemId) : null,
    recall,
    answer,
    judgeScore,
    judgeRaw: verdict.raw,
  });
  return outcome;
});

/** Context passages of the gold condition: the question's gold text, verbatim. */
const goldPassages = (q: EvalQuestion) => [...q.goldText];

/** One question under one condition: context, answer, judgement, score, persisted result. Logged inside eval_run (not bracketed). */
export const evalQuestionMachine = setup({
  types: {
    context: {} as QuestionContext,
    input: {} as QuestionInput,
    output: {} as QuestionOutput,
  },
  actors: {
    retrieve: retrieveActor,
    oracle: oracleActor,
    answer: answerActor,
    judge: judgeActor,
    score: scoreActor,
  },
  guards: {
    isNone: ({ context }) => context.input.kind === 'none',
    isGold: ({ context }) => context.input.kind === 'gold',
    isOracle: ({ context }) => context.input.kind === 'oracle',
  },
}).createMachine({
  id: 'eval-question',
  context: ({ input }) => ({ input, passages: [], ranked: null, searchId: null, answer: '', verdict: null, outcome: null, error: null }),
  initial: 'route',
  output: ({ context }) => ({ outcome: context.outcome, error: context.error }),
  states: {
    route: {
      meta: { routing: true },
      always: [
        { guard: 'isNone', target: 'answering' },
        { guard: 'isGold', target: 'answering', actions: assign({ passages: ({ context }) => goldPassages(context.input.question) }) },
        { guard: 'isOracle', target: 'contextOracle' },
        { target: 'contextRetrieved' },
      ],
    },
    contextRetrieved: {
      meta: { logs: 'search.result', step: 'retrieve', label: 'retrieve the question with the condition\'s search recipe' },
      invoke: {
        src: 'retrieve',
        input: ({ context }) => context.input,
        onDone: {
          target: 'answering',
          actions: assign({
            searchId: ({ event }) => event.output.searchId,
            ranked: ({ event }) => event.output.items,
            passages: ({ event }) => event.output.items.map((i) => i.text),
          }),
        },
        onError: { target: '#failed', actions: assign({ error: ({ event }) => toKgError(event.error) }) },
      },
    },
    contextOracle: {
      meta: { logs: 'search.result', step: 'oracle', label: 'gold chunks first, then the retrieved items' },
      invoke: {
        src: 'oracle',
        input: ({ context }) => context.input,
        onDone: {
          target: 'answering',
          actions: assign({
            searchId: ({ event }) => event.output.searchId,
            ranked: ({ event }) => event.output.items,
            passages: ({ event }) => event.output.items.map((i) => i.text),
          }),
        },
        onError: { target: '#failed', actions: assign({ error: ({ event }) => toKgError(event.error) }) },
      },
    },
    answering: {
      meta: { logs: 'llm.called', step: 'answer', label: 'answer from the context' },
      invoke: {
        src: 'answer',
        input: ({ context }) => ({ ctx: context.input.ctx, deps: context.input.deps, question: context.input.question.question, passages: context.passages }),
        onDone: { target: 'judging', actions: assign({ answer: ({ event }) => event.output }) },
        onError: { target: '#failed', actions: assign({ error: ({ event }) => toKgError(event.error) }) },
      },
    },
    judging: {
      meta: { logs: 'llm.called', step: 'judge', label: 'grade the answer against the reference' },
      invoke: {
        src: 'judge',
        input: ({ context }) => ({ ctx: context.input.ctx, deps: context.input.deps, question: context.input.question, answer: context.answer, condition: context.input.condition }),
        onDone: { target: 'scoring', actions: assign({ verdict: ({ event }) => event.output }) },
        onError: { target: '#failed', actions: assign({ error: ({ event }) => toKgError(event.error) }) },
      },
    },
    scoring: {
      meta: { logs: 'eval.question.scored', step: 'score', label: 'compute recall and persist the result' },
      invoke: {
        src: 'score',
        input: ({ context }) => ({ input: context.input, ranked: context.ranked, searchId: context.searchId, answer: context.answer, verdict: context.verdict! }),
        onDone: { target: 'done', actions: assign({ outcome: ({ event }) => event.output }) },
        onError: { target: '#failed', actions: assign({ error: ({ event }) => toKgError(event.error) }) },
      },
    },
    done: { type: 'final' },
    failed: { id: 'failed', type: 'final' },
  },
});
