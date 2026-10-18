/**
 * DESIGN A (current): the step runner. Recipe = {steps:[{type,params}]} (data). Logging lives in the loop.
 * Includes the P-2a `done` skip + `final` marker that the contract does NOT have yet (needed for the unrolled critique loop).
 */
import { KgError, type SearchRecipeSpec, type StepFactory } from '@kg/core';
import type { Executor } from './service';

export const runnerExecutor = (steps: Record<string, StepFactory>): Executor => async (run) => {
  const spec = (run.recipe as unknown as SearchRecipeSpec).spec.steps;
  const plan = spec.map((s) => { const f = steps[s.type]; if (!f) throw new KgError('invalid_input', `unknown step type ${s.type}`); return f(s.params); });
  let state = run.state;
  for (const [i, step] of plan.entries()) {
    if (state.done && spec[i]!.params['final'] !== true) continue; // P-2a (not in core)
    const t0 = run.ctx.clock.monotonicMs();
    const out = await step.run(state, run.env);
    state = out.state;
    run.emitStep(out.trace, Math.max(0, run.ctx.clock.monotonicMs() - t0));
  }
  return state;
};
