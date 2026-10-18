/** Lighter candidate: robot3 1.4.0. The critique loop (and the knn-truncate search) as a robot3 machine; same steps, same logging point. */
import { createMachine, guard, immediate, interpret, invoke, reduce, state, transition } from 'robot3';
import type { SearchState, SearchStep } from '@kg/core';
import type { Executor, Run } from './service';
import { critique, truncate, vectorKnn } from './steps';

type C = { state: SearchState; round: number };
const call = (run: Run, step: SearchStep) => async (c: C) => {
  const t0 = run.ctx.clock.monotonicMs();
  const out = await step.run(c.state, run.env);
  run.emitStep(out.trace, Math.max(0, run.ctx.clock.monotonicMs() - t0));
  return out.state;
};
const adopt = (extra: (c: C) => Partial<C> = () => ({})) => reduce((c: C, ev: { data: SearchState }) => ({ ...c, state: ev.data, ...extra({ ...c, state: ev.data }) }));

export const robotCritiqueExecutor = (settings: { model: string; maxRounds: number; pool: number }): Executor => async (run) => {
  const machine = createMachine('retrieve', {
    retrieve: invoke(call(run, vectorKnn({ pool: settings.pool, kinds: ['chunk'] })), transition('done', 'review', adopt()), transition('error', 'failed', reduce((c: C, ev: { error: unknown }) => ({ ...c, error: ev.error } as never)))),
    review: state(immediate('critique', guard((c: C) => c.round < settings.maxRounds)), immediate('cut')),
    critique: invoke(call(run, critique({ model: settings.model, maxNewQueries: 2 }) as never) as never, transition('done', 'verdict', adopt((c) => ({ round: c.round + 1 }))), transition('error', 'failed', reduce((c: C, ev: { error: unknown }) => ({ ...c, error: ev.error } as never)))),
    verdict: state(immediate('cut', guard((c: C) => c.state.done)), immediate('retrieve')),
    cut: invoke(call(run, truncate({})), transition('done', 'done', adopt()), transition('error', 'failed', reduce((c: C, ev: { error: unknown }) => ({ ...c, error: ev.error } as never)))),
    done: state(),
    failed: state(),
  }, () => ({ state: run.state, round: 0 }));
  return new Promise<SearchState>((resolve, reject) => {
    interpret(machine, (svc) => {
      if (svc.machine.current === 'done') resolve(svc.context.state);
      if (svc.machine.current === 'failed') reject((svc.context as unknown as { error: unknown }).error);
    });
  });
};
