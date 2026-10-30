import { KgError, type BuildId, type Ctx, type EvalQuestion, type EvalRunId, type EvalSet, type Json, type RecipeId } from '@kg/core';
import { assign, loggedActor, setup, toKgError } from '@kg/pipeline';
import { answererInfo } from '../prompts/answer';
import { judgeInfo } from '../prompts/judge';
import { conditionError, conditionKind } from '../runner/conditions';
import { summarize } from '../runner/summarize';
import type { RunDeps } from '../runner/types';
import { evalQuestionMachine, type ConditionKind, type Outcome, type QuestionInput } from './evalQuestion';

export interface QuestionItem {
  question: EvalQuestion;
  condition: string;
  kind: ConditionKind;
}

export interface RunInput {
  ctx: Ctx;
  deps: RunDeps;
  set: EvalSet;
  evalSetSha256: string;
  conditions: string[];
  ks: number[];
  /** the pinned build; default the current build */
  buildId: BuildId | undefined;
  allowStale: boolean;
  searchRecipes: Record<string, RecipeId> | undefined;
}

/** A question whose model call failed. It is recorded in the summary and the run goes on without it. */
export interface QuestionFailure {
  questionId: string;
  condition: string;
  code: string;
  message: string;
}

export interface RunContext {
  input: RunInput;
  build: BuildId | null;
  items: QuestionItem[];
  runId: EvalRunId | null;
  index: number;
  outcomes: Outcome[];
  failures: QuestionFailure[];
  summary: Json | null;
  error: KgError | null;
}

export interface RunOutput {
  runId: EvalRunId | null;
  summary: Json | null;
  error: KgError | null;
}

const resolvedBuild = (i: RunInput): BuildId | null => i.buildId ?? i.deps.rt.currentBuild();

const pin = loggedActor(
  ['eval.run.started'],
  async ({ input, build }: { input: RunInput; build: BuildId }): Promise<EvalRunId> => {
    const { ctx, deps, set, evalSetSha256, conditions, ks, searchRecipes } = input;
    const runId = ctx.ids.ulid('er_') as EvalRunId;
    const judge = judgeInfo();
    const answerer = answererInfo();
    const config: Record<string, Json> = { conditions, ks };
    if (searchRecipes) config.searchRecipes = searchRecipes;
    config.judge = judge as unknown as Json;
    config.answerer = answerer as unknown as Json;
    deps.repo.putRun({ runId, evalSetId: set.id, evalSetSha256, buildId: build, sessionId: ctx.sessionId, config, createdAt: ctx.clock.now() });
    ctx.emit(
      'eval.run.started',
      { runId, buildId: build, evalSetId: set.id, evalSetSha256, conditions, ks, ...(searchRecipes ? { searchRecipes } : {}), judge, answerer },
      { buildId: build },
    );
    return runId;
  },
);

const complete = loggedActor(['eval.run.completed'], async ({ ctx, runId, build, summary }: { ctx: Ctx; runId: EvalRunId; build: BuildId; summary: Json }): Promise<void> => {
  ctx.emit('eval.run.completed', { runId, summary }, { buildId: build });
});

/**
 * One eval run, whole: check the build, pin the run, run each question under each condition (the child), summarize,
 * complete. The pure steps (opening, checkingBuild, summarizing) are routing states; a refusal is a `failed` with the
 * error. A question that fails is recorded in `failures` and the run goes on; the summary says how many failed.
 */
export const evalRunMachine = setup({
  types: {
    context: {} as RunContext,
    input: {} as RunInput,
    output: {} as RunOutput,
  },
  actors: { pin, question: evalQuestionMachine, complete },
  guards: {
    noBuild: ({ context }) => resolvedBuild(context.input) === null,
    unknownBuild: ({ context }) => !context.input.deps.store.getBuild(context.build!),
    staleRefused: ({ context }) => !context.input.allowStale && context.input.deps.store.staleCheck(context.build!).stale,
    badCondition: ({ context }) => conditionError(context.input.conditions, context.input.searchRecipes) !== null,
    hasItem: ({ context }) => context.index < context.items.length,
    questionFailed: ({ event }) => (event as unknown as { output: { error: KgError | null } }).output.error !== null,
  },
}).createMachine({
  id: 'eval-run',
  context: ({ input }) => ({ input, build: null, items: [], runId: null, index: 0, outcomes: [], failures: [], summary: null, error: null }),
  initial: 'opening',
  output: ({ context }) => ({ runId: context.runId, summary: context.summary, error: context.error }),
  states: {
    opening: {
      meta: { routing: true },
      always: [
        { guard: 'noBuild', target: '#failed', actions: assign({ error: () => new KgError('precondition', 'there is no build to evaluate') }) },
        { target: 'checkingBuild', actions: assign({ build: ({ context }) => resolvedBuild(context.input) }) },
      ],
    },
    checkingBuild: {
      meta: { routing: true },
      always: [
        { guard: 'unknownBuild', target: '#failed', actions: assign({ error: ({ context }) => new KgError('not_found', `build ${context.build} not found`) }) },
        {
          guard: 'staleRefused',
          target: '#failed',
          actions: assign({
            error: ({ context }) =>
              new KgError('precondition', `build ${context.build} is stale (its chunks left the current ingest); pass allowStale to evaluate it anyway`),
          }),
        },
        { guard: 'badCondition', target: '#failed', actions: assign({ error: ({ context }) => conditionError(context.input.conditions, context.input.searchRecipes) }) },
        {
          target: 'pinning',
          actions: assign({
            items: ({ context }) => {
              const { set, conditions, searchRecipes } = context.input;
              return set.questions.flatMap((question) => conditions.map((condition) => ({ question, condition, kind: conditionKind(condition, searchRecipes) })));
            },
          }),
        },
      ],
    },
    pinning: {
      meta: { logs: 'eval.run.started', step: 'pin', label: 'record the run and its judge and answerer' },
      invoke: {
        src: 'pin',
        input: ({ context }) => ({ input: context.input, build: context.build! }),
        onDone: { target: 'nextQuestion', actions: assign({ runId: ({ event }) => event.output }) },
        onError: { target: '#failed', actions: assign({ error: ({ event }) => toKgError(event.error) }) },
      },
    },
    nextQuestion: {
      meta: { routing: true },
      always: [{ guard: 'hasItem', target: 'question' }, { target: 'summarizing' }],
    },
    question: {
      meta: { logs: 'eval.question.scored llm.called', step: 'question', label: 'run one question under one condition' },
      invoke: {
        src: 'question',
        input: ({ context }): QuestionInput => {
          const item = context.items[context.index]!;
          return {
            ctx: context.input.ctx,
            deps: context.input.deps,
            question: item.question,
            condition: item.condition,
            kind: item.kind,
            build: context.build!,
            runId: context.runId!,
            ks: context.input.ks,
            searchRecipeId: context.input.searchRecipes?.[item.condition] ?? null,
          };
        },
        onDone: [
          {
            guard: 'questionFailed',
            target: 'nextQuestion',
            actions: assign({
              index: ({ context }) => context.index + 1,
              failures: ({ context, event }) => {
                const item = context.items[context.index]!;
                const e = (event.output as { error: KgError }).error;
                return [...context.failures, { questionId: item.question.id, condition: item.condition, code: e.code, message: e.message }];
              },
            }),
          },
          {
            target: 'nextQuestion',
            actions: assign({
              index: ({ context }) => context.index + 1,
              outcomes: ({ context, event }) => [...context.outcomes, (event.output as { outcome: Outcome }).outcome],
            }),
          },
        ],
        onError: { target: '#failed', actions: assign({ error: ({ event }) => toKgError(event.error) }) },
      },
    },
    summarizing: {
      meta: { routing: true },
      always: {
        target: 'completing',
        actions: assign({
          summary: ({ context }) =>
            summarize(context.input.set, context.input.ks, context.input.conditions, context.outcomes, context.failures, context.build!, context.input.deps),
        }),
      },
    },
    completing: {
      meta: { logs: 'eval.run.completed', step: 'complete', label: 'emit the summary' },
      invoke: {
        src: 'complete',
        input: ({ context }) => ({ ctx: context.input.ctx, runId: context.runId!, build: context.build!, summary: context.summary! }),
        onDone: 'done',
        onError: { target: '#failed', actions: assign({ error: ({ event }) => toKgError(event.error) }) },
      },
    },
    done: { type: 'final' },
    failed: { id: 'failed', type: 'final' },
  },
});
