/**
 * DESIGN A+ (modified current design): the same runner plus ONE data construct, `repeat`, for bounded loops:
 *   {type:'repeat', params:{max:N, steps:[...]}}  runs its body up to N times; `done` set by a step ends the loop
 *   (the rest of that iteration is skipped). `done` has no other meaning, so no top-level skip rule and no `final` marker.
 */
import { KgError, type SearchRecipeSpec, type SearchState, type SearchStepSpec, type StepFactory } from '@kg/core';
import type { Executor, Run } from './service';

export const runnerLoopExecutor = (steps: Record<string, StepFactory>): Executor => async (run: Run) => {
  const exec = async (specs: SearchStepSpec[], state: SearchState, inLoop: boolean): Promise<SearchState> => {
    for (const s of specs) {
      if (s.type === 'repeat') {
        const { max, steps: body } = s.params as { max: number; steps: SearchStepSpec[] };
        for (let i = 0; i < max && !state.done; i++) state = await exec(body, state, true);
        continue;
      }
      const f = steps[s.type];
      if (!f) throw new KgError('invalid_input', `unknown step type ${s.type}`);
      const t0 = run.ctx.clock.monotonicMs();
      const out = await f(s.params).run(state, run.env);
      state = out.state;
      run.emitStep(out.trace, Math.max(0, run.ctx.clock.monotonicMs() - t0));
      if (inLoop && state.done) break;
    }
    return state;
  };
  return exec((run.recipe as unknown as SearchRecipeSpec).spec.steps, run.state, false);
};
