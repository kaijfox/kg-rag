import { loggedActor } from '@kg/pipeline';
import type { BuildId, Ctx, SearchId, SearchState, SearchStep, StepEnv } from '@kg/core';

/** What a search run hands to its machine: the step environment, the logging context and the envelope tags. */
export interface SearchRun {
  env: StepEnv;
  ctx: Ctx;
  tag: { searchId: SearchId; buildId: BuildId };
  /** execution counter for step traces, contiguous from 0 */
  nextIndex: number;
}

export interface StepInput<P> {
  run: SearchRun;
  /** the machine state that runs this step */
  at: string;
  state: SearchState;
  params: P;
}

/**
 * The single place that emits `search.step`. A machine state invokes the actor built here with the step constructor
 * and its parameters; the step runs, its trace is logged with the state name and the next step index, and the new
 * search state is returned to the machine.
 */
export function stepActor<P>(make: (p: P) => SearchStep) {
  return loggedActor<StepInput<P>, SearchState>(['search.step'], async (input) => {
    const step = make(input.params);
    const clock = input.run.ctx.clock;
    const t0 = clock.monotonicMs();
    const out = await step.run(input.state, input.run.env);
    input.run.ctx.emit(
      'search.step',
      { trace: { ...out.trace, state: input.at, stepIndex: input.run.nextIndex++, durationMs: Math.max(0, clock.monotonicMs() - t0) } },
      input.run.tag,
    );
    return out.state;
  });
}
