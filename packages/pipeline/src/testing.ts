/** Helpers for testing one machine in isolation. Imported from tests only. */
import { createActor, fromPromise, type AnyStateMachine, type InputFrom, type OutputFrom } from 'xstate';

/** The machine with some of its actors replaced (for example by `scripted`). */
export function withActors<M extends AnyStateMachine>(machine: M, actors: Record<string, unknown>): M {
  return (machine as unknown as { provide(o: { actors: Record<string, unknown> }): M }).provide({ actors });
}

/** An actor that returns the given outputs in order; a value that is an Error is thrown instead. */
export function scripted<I = unknown, O = unknown>(outputs: readonly (O | Error)[]) {
  let i = 0;
  return fromPromise(async (_: { input: I }): Promise<O> => {
    if (i >= outputs.length) throw new Error(`scripted actor called ${i + 1} times, only ${outputs.length} outputs given`);
    const next = outputs[i++]!;
    if (next instanceof Error) throw next;
    return next;
  });
}

const flatten = (v: unknown, prefix = ''): string => {
  if (typeof v === 'string') return prefix ? `${prefix}.${v}` : v;
  const [k, sub] = Object.entries(v as Record<string, unknown>)[0] ?? ['', ''];
  return flatten(sub, prefix ? `${prefix}.${k}` : k);
};

/**
 * Runs a machine to a final state and reports every state it passed through, in order, including routing states that
 * are left in the same step they are entered (they never appear in a snapshot), and the output.
 */
export async function drive<M extends AnyStateMachine>(machine: M, input: InputFrom<M>): Promise<{ output: OutputFrom<M> | undefined; visited: string[]; final: string }> {
  const visited: string[] = [];
  const actor = createActor(machine, {
    input,
    inspect: (e: { type: string; snapshot?: { value?: unknown } }) => {
      // microsteps carry the states passed through, including routing states left in the same step
      if (e.type === '@xstate.microstep' && e.snapshot?.value !== undefined) visited.push(flatten(e.snapshot.value));
    },
  } as never);
  visited.push(flatten((actor.getSnapshot() as { value: unknown }).value));
  const done = new Promise<void>((resolve) => {
    actor.subscribe({ next: (s) => { if ((s as { status: string }).status !== 'active') resolve(); }, error: () => resolve() });
  });
  actor.start();
  await done;
  const snap = actor.getSnapshot() as { output?: OutputFrom<M>; value: unknown };
  return { output: snap.output, visited, final: flatten(snap.value) };
}
