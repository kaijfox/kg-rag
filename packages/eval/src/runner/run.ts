import { EVAL_RUN_TOOL, canonicalJson, runTool, sha256hex, type EvalRunOutput, type EvalSet, type Json } from '@kg/core';
import { runPipeline, topologyOf } from '@kg/pipeline';
import { evalRunMachine } from '../machines/evalRun';
import type { RunEval } from './types';

export { conditionKind } from './conditions';
export type { EvalRunOptions, RunDeps, RunEval } from './types';

const identity = () => ({
  pipeline: 'eval-run' as const,
  machine: 'eval-run',
  version: '1',
  topology: topologyOf(evalRunMachine),
  recipeId: null,
});

const sha = (set: EvalSet) => sha256hex(canonicalJson(set as unknown as Json));

/**
 * Runs an eval set against a pinned build. One eval session; one eval_run tool call; the whole run (checks, pin, questions,
 * summary, completion) is one eval-run pipeline inside it. Logged in this order: pipeline.started, eval.run.started,
 * the questions (llm.called and eval.question.scored each, a nested search under the retrieving conditions),
 * eval.run.completed, pipeline.finished.
 */
export const runEval: RunEval = (d, set, o) => {
  const { rt } = d;
  const session = rt.log.openSession({ kind: 'eval', label: set.name, meta: { evalSetId: set.id } });
  return runTool(
    rt,
    EVAL_RUN_TOOL,
    session,
    { evalSetId: set.id, evalSetSha256: sha(set), buildId: o.buildId, conditions: o.conditions, ks: o.ks, searchRecipes: o.searchRecipes },
    async (ctx, input): Promise<EvalRunOutput> => {
      const build = input.buildId ?? rt.currentBuild();
      const known = build !== null && d.store.getBuild(build) !== null;
      const out = await runPipeline(
        evalRunMachine,
        {
          ctx,
          deps: d,
          set,
          evalSetSha256: input.evalSetSha256,
          conditions: input.conditions,
          ks: input.ks,
          buildId: input.buildId,
          allowStale: o.allowStale ?? false,
          searchRecipes: input.searchRecipes,
        },
        { run: { ctx, tag: known ? { buildId: build } : {} }, identity: identity() },
      );
      return { runId: out.runId!, summary: out.summary! };
    },
  );
};
