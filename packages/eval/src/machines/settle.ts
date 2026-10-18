import { createActor, type AnyStateMachine } from '@kg/pipeline';

/** Runs a machine to its final state and resolves with its output. Used by the eval pipelines that take no context and log nothing. */
export function settle<O>(machine: AnyStateMachine, input: object): Promise<O> {
  return new Promise((resolve, reject) => {
    const actor = createActor(machine, { input } as never);
    actor.subscribe({
      next: (s) => {
        if (s.status !== 'active') resolve((s as unknown as { output: O }).output);
      },
      error: (e) => reject(e),
    });
    actor.start();
  });
}
