/**
 * The single logging path. Every KgApi method except openSession runs through runTool, which:
 *  1. appends tool.called {tool, input} (input as given, even if invalid);
 *  2. validates input with def.input; on failure appends tool.failed (invalid_input) and throws;
 *  3. builds a Ctx whose emit appends domain events tagged with the session, parentId = tool.called.id,
 *     and buildId (default: current build at the time of emitting);
 *  4. runs the handler;
 *  5. validates the output with def.output (a mismatch is an internal error);
 *  6. appends tool.returned {tool, summary, durationMs}, or tool.failed {tool, error, durationMs}; returns or rethrows.
 * Both the `api` package and testkit's FakeKgApi build their KgApi with createKgApi, so their logging cannot diverge.
 *
 * Nesting (P-3, R-27): a runTool call made while another runTool handler of the SAME session is running (e.g. an
 * eval run calling KgApi.search) records parentId = the enclosing tool.called. Tracked with AsyncLocalStorage, so
 * parallel calls in one session stay unlinked and correct.
 */
const enclosing = new AsyncLocalStorage<{ sessionId: SessionId; calledId: import('./ids').EventId }>();
import { AsyncLocalStorage } from 'node:async_hooks';
import { KgError, errorCodeOf } from './errors';
import type { BuildId, SessionId } from './ids';
import type { Json } from './model';
import type { Clock, Ctx, IdGen } from './ports/infra';
import type { EventLog } from './ports/log';
import type { EventEnvelope, EventPayloads, EventType } from './events';
import { TOOLS, openSessionSchema, type KgApi, type ToolDef, type ToolInput, type ToolName, type ToolOutput } from './api';

export interface ToolRuntime {
  log: EventLog;
  clock: Clock;
  ids: IdGen;
  /** the current build, read when each event is written */
  currentBuild(): BuildId | null;
}

function toJson(x: unknown): Json {
  try {
    const s = JSON.stringify(x);
    return s === undefined ? null : (JSON.parse(s) as Json);
  } catch {
    return '[unserializable input]';
  }
}

export async function runTool<I, O>(
  rt: ToolRuntime,
  def: ToolDef<I, O>,
  sessionId: SessionId,
  rawInput: unknown,
  handler: (ctx: Ctx, input: I) => Promise<O>,
): Promise<O> {
  const t0 = rt.clock.monotonicMs();
  const elapsed = () => Math.max(0, rt.clock.monotonicMs() - t0);
  const called = rt.log.append({
    sessionId,
    type: 'tool.called',
    buildId: rt.currentBuild(),
    searchId: null,
    parentId: enclosing.getStore()?.sessionId === sessionId ? enclosing.getStore()!.calledId : null,
    payload: { tool: def.name, input: toJson(rawInput) },
  });
  const finish = (type: 'tool.returned' | 'tool.failed', payload: EventPayloads['tool.returned'] | EventPayloads['tool.failed']) =>
    rt.log.append({ sessionId, type, buildId: rt.currentBuild(), searchId: null, parentId: called.id, payload } as never);

  try {
    const parsed = def.input.safeParse(rawInput);
    if (!parsed.success) {
      const msg = parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
      throw new KgError('invalid_input', `${def.name}: ${msg}`);
    }
    const ctx: Ctx = {
      sessionId,
      clock: rt.clock,
      ids: rt.ids,
      parentEventId: called.id,
      emit<T extends EventType>(type: T, payload: EventPayloads[T], o?: { searchId?: import('./ids').SearchId | null; buildId?: BuildId | null }) {
        return rt.log.append({
          sessionId,
          type,
          payload,
          buildId: o?.buildId !== undefined ? o.buildId : rt.currentBuild(),
          searchId: o?.searchId ?? null,
          parentId: called.id,
        } as never) as EventEnvelope<T>;
      },
    };
    const out = await enclosing.run({ sessionId, calledId: called.id }, () => handler(ctx, parsed.data));
    const checked = def.output.safeParse(out);
    if (!checked.success) {
      const msg = checked.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
      throw new KgError('internal', `${def.name}: handler output violates the contract: ${msg}`);
    }
    finish('tool.returned', { tool: def.name, summary: def.summarize(out), durationMs: elapsed() });
    return out;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    finish('tool.failed', { tool: def.name, error: { code: errorCodeOf(e), message }, durationMs: elapsed() });
    throw e;
  }
}

export type KgHandlers = { [K in ToolName]: (ctx: Ctx, input: ToolInput<K>) => Promise<ToolOutput<K>> };

/** Builds a KgApi whose every tool method goes through runTool. */
export function createKgApi(rt: ToolRuntime, handlers: KgHandlers): KgApi {
  const tool =
    <K extends ToolName>(k: K) =>
    (s: SessionId, input: ToolInput<K>) =>
      runTool(rt, TOOLS[k] as unknown as ToolDef<ToolInput<K>, ToolOutput<K>>, s, input, handlers[k] as (ctx: Ctx, i: ToolInput<K>) => Promise<ToolOutput<K>>);
  return {
    async openSession(r) {
      const p = openSessionSchema.safeParse(r);
      if (!p.success) throw new KgError('invalid_input', `openSession: ${p.error.issues.map((i) => i.message).join('; ')}`);
      return { sessionId: rt.log.openSession({ kind: p.data.kind, label: p.data.label ?? null, meta: p.data.meta ?? {} }) };
    },
    search: tool('search'),
    getItems: tool('getItems'),
    feedback: tool('feedback'),
    reportUsage: tool('reportUsage'),
    reportOutcome: tool('reportOutcome'),
    ingest: tool('ingest'),
    snapshotBuild: tool('snapshotBuild'),
    addNote: tool('addNote'),
  };
}

export type { ToolDef };
