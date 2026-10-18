import { createActor, type AnyStateMachine, type InputFrom, type OutputFrom } from 'xstate';
import { KgError, type BuildId, type Ctx, type RecipeId, type SearchId } from '@kg/core';
import { toKgError } from './actors';

/** The parts of a finished machine snapshot this runner reads. */
type EndSnapshot = { status: string; value: unknown; context?: { error?: unknown }; error?: unknown; output?: unknown };

export type PipelineKind = 'search' | 'ingest' | 'eval-run' | 'eval-generate';

export interface PipelineIdentity {
  pipeline: PipelineKind;
  machine: string;
  version: string;
  /** 16 hex characters, see topologyOf */
  topology: string;
  recipeId: RecipeId | null;
}

export interface PipelineRun {
  ctx: Ctx;
  /** envelope tags for the start and finish events */
  tag: { searchId?: SearchId; buildId?: BuildId };
}

/**
 * Runs a machine from its initial state to a final state inside the calling tool handler. Emits `pipeline.started`
 * first and `pipeline.finished` last. A machine ends in `done` (its output is returned) or in `failed` (the error it
 * kept in context under `error` is rethrown after `pipeline.finished`, whose `state` names the last work state entered
 * before `failed`). The actor is created and finished inside this
 * call, so the logging context of the surrounding tool call is inherited and never outlives it.
 */
export async function runPipeline<M extends AnyStateMachine>(
  machine: M,
  input: InputFrom<M>,
  o: { run: PipelineRun; identity: PipelineIdentity; inspect?: (event: unknown) => void },
): Promise<OutputFrom<M>> {
  const { ctx, tag } = o.run;
  const id = o.identity;
  ctx.emit('pipeline.started', { pipeline: id.pipeline, machine: id.machine, version: id.version, topology: id.topology, recipeId: id.recipeId }, tag);
  const actor = createActor(machine, { input, ...(o.inspect ? { inspect: o.inspect } : {}) } as never);
  const valueName = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v));
  // the last non-final state entered: where a failed run stopped
  let lastActive = valueName((actor.getSnapshot() as unknown as EndSnapshot).value);
  const finished = new Promise<EndSnapshot>((resolve) => {
    actor.subscribe({
      next: (s) => {
        const e = s as unknown as EndSnapshot;
        if (e.status === 'active') lastActive = valueName(e.value);
        else resolve(e);
      },
      error: () => resolve(actor.getSnapshot() as unknown as EndSnapshot),
    });
  });
  actor.start();
  const snap = await finished;
  const state = valueName(snap.value);
  if (snap.status === 'done' && state !== 'failed') {
    ctx.emit('pipeline.finished', { pipeline: id.pipeline, status: 'done', state }, tag);
    return snap.output as OutputFrom<M>;
  }
  const err =
    snap.status === 'done'
      ? toKgError(snap.context?.error ?? new KgError('internal', `machine ${id.machine} reached failed without an error`))
      : snap.status === 'error'
        ? toKgError(snap.error)
        : new KgError('internal', `machine ${id.machine} was stopped before it finished`);
  ctx.emit('pipeline.finished', { pipeline: id.pipeline, status: 'failed', state: snap.status === 'done' && state === 'failed' ? lastActive : state, error: { code: err.code, message: err.message } }, tag);
  throw err;
}
