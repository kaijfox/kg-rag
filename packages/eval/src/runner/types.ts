import type { BuildId, Ctx, CorpusStore, EvalQuestion, EvalRepo, EvalRunOutput, EvalSet, JudgeVerdict, KgApi, Llm, RecipeId, ToolRuntime } from '@kg/core';

/** What an eval run reads and writes: the log runtime, the search API, the store (reads only), the answerer, the judge and the results. */
export interface RunDeps {
  rt: ToolRuntime;
  api: KgApi;
  store: Pick<CorpusStore, 'getBuild' | 'staleCheck' | 'getItems'>;
  answerer: Llm;
  /** grades one answer; the runner's context is passed so the judge's model calls can be logged (see makeJudge) */
  judge: (q: EvalQuestion, answer: string, condition: string, ctx: Ctx) => Promise<JudgeVerdict>;
  repo: EvalRepo;
}

export interface EvalRunOptions {
  conditions: string[];
  ks: number[];
  /** pinned build; default the current build */
  buildId?: BuildId;
  allowStale?: boolean;
  /** search recipe per retrieved condition name; a condition not listed uses the build's default */
  searchRecipes?: Record<string, RecipeId>;
}

export type RunEval = (d: RunDeps, set: EvalSet, o: EvalRunOptions) => Promise<EvalRunOutput>;
