import { fromPromise } from 'xstate';
import { KgError, isKgError, type EventType } from '@kg/core';

/** Any thrown value as a KgError: a KgError stays as it is, anything else becomes `internal`. */
export function toKgError(e: unknown): KgError {
  if (isKgError(e)) return e;
  return new KgError('internal', e instanceof Error ? e.message : String(e));
}

/**
 * The only way a machine file creates a work actor. It runs `fn`, and a thrown value reaches the machine as a
 * KgError. `logs` names the event types the work emits through the run context; the machine map shows them and the
 * log-versus-map check compares them with what a real run emitted.
 */
export function loggedActor<I, O>(logs: readonly EventType[], fn: (input: I) => Promise<O>) {
  const logic = fromPromise(async ({ input }: { input: I }): Promise<O> => {
    try {
      return await fn(input);
    } catch (e) {
      throw toKgError(e);
    }
  });
  declared.set(logic, logs);
  return logic;
}

const declared = new WeakMap<object, readonly EventType[]>();

/** Event types a work actor declared through loggedActor (empty for any other actor). */
export const declaredLogsOf = (actor: object): readonly EventType[] => declared.get(actor) ?? [];
