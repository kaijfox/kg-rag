/**
 * The machine runner. It executes a machine's states in order, applies each module's writes (the only code that writes
 * the index on behalf of a module), stamps results with the module's name and version, and logs every step with what the
 * step received and returned, so a failed query can be diagnosed from the log alone.
 */
import { KgError } from './errors';
import type { Json } from './ids';
import type { IndexStore } from './indexStore';
import type { KgConfig } from './defaults';
import { Registry, type MachineDef, type ModuleContext, type ModuleResult, type Next, type Services, type Slots, type StateDef, type Writes } from './machine';

export interface RunEnv {
  index: IndexStore;
  services: Services;
  config: KgConfig;
  registry: Registry;
  now: () => string;
  /** receives `pipeline.started`, one `step` per state, `pipeline.finished` or `pipeline.failed` */
  log?: (type: string, payload: Json) => void;
  /** false: a module that returns writes is an error (search runs must not change the index) */
  mayWrite?: boolean;
  /** a guard against a loop that never leaves; default 200 */
  maxSteps?: number;
}

export interface StepTrace {
  state: string;
  module: string;
  ms: number;
  slots: Record<string, Json>;
  notes: { text: string; data?: Json }[];
  wrote: Json | null;
}

const RANKED = new Set(['candidates', 'results']);
const TOP = 100;

type Scored = { id: string; score: number };
const isScored = (x: unknown): x is Scored[] => Array.isArray(x) && x.every((e) => typeof e === 'object' && e !== null && 'id' in e && 'score' in e);

/** A short, loggable description of one slot value. Ranked lists keep their top entries so ranks can be audited. */
export function describeSlot(name: string, v: unknown): Json {
  if (RANKED.has(name) && isScored(v)) return { n: v.length, top: v.slice(0, TOP).map((e) => ({ id: e.id, score: Math.round(e.score * 1e6) / 1e6 })) };
  if (Array.isArray(v)) return { n: v.length };
  if (typeof v === 'string') return v.length > 200 ? `${v.slice(0, 200)}… (${v.length} chars)` : v;
  if (typeof v === 'number' || typeof v === 'boolean' || v === null) return v;
  if (v instanceof Float32Array) return { vector: v.length };
  if (typeof v === 'object' && v !== null) return { keys: Object.keys(v).length };
  return String(v);
}

/** Applies one module's writes to the index: documents, then derived items and links, then embeddings. */
export function applyWrites(index: IndexStore, w: Writes, madeBy: string, now: string): Json {
  const out: Record<string, Json> = {};
  if (w.documents?.length) {
    out.documents = w.documents.map((d) => ({ docKey: d.doc.docKey, ...index.commitDocument(d.doc, d.chunks, now) }));
  }
  if (w.derived) {
    const r = index.commitDerived(madeBy, w.derived.items, w.derived.links ?? [], now);
    out.derived = { items: r.itemIds.length, newItems: r.newItems, links: r.linkIds.length };
  }
  if (w.embeddings?.length) {
    out.embeddings = w.embeddings.map((e) => {
      index.putEmbeddings(e.spaceId, e.rows);
      return { space: e.spaceId, rows: e.rows.length };
    });
  }
  return out;
}

export async function runMachine(def: MachineDef, input: Slots, env: RunEnv): Promise<{ state: Slots; steps: StepTrace[] }> {
  for (const p of def.provides) if (!(p in input)) throw new KgError('invalid_input', `machine ${def.name} needs input "${p}"`);
  const log = env.log ?? (() => undefined);
  const steps: StepTrace[] = [];
  let state: Slots = { ...input };
  let at: string | null = def.start;
  log('pipeline.started', { machine: def.name, version: def.version, input: Object.fromEntries(Object.entries(input).map(([k, v]) => [k, describeSlot(k, v)])) });
  const limit = env.maxSteps ?? 200;
  let count = 0;
  try {
    while (at !== null) {
      if (++count > limit) throw new KgError('internal', `machine ${def.name} did not finish within ${limit} steps`);
      const s: StateDef = def.states[at]!;
      const mod = env.registry.module(s.module);
      const madeBy = `${mod.name}@${mod.version}`;
      const notes: StepTrace['notes'] = [];
      const ctx: ModuleContext = {
        index: env.index,
        services: env.services,
        config: env.config,
        now: env.now,
        note: (text, data) => notes.push({ text, ...(data === undefined ? {} : { data }) }),
      };
      const t0 = performance.now();
      const before = state;
      const result: ModuleResult = await mod.run({ state, settings: (s.settings ?? {}) as never, ctx });
      const patch = result.patch ?? {};
      for (const key of Object.keys(patch)) if (!mod.adds.includes(key)) throw new KgError('internal', `module ${madeBy} set slot "${key}", which it does not declare in adds`);
      state = { ...state, ...patch };
      let wrote: Json | null = null;
      if (result.writes) {
        if (env.mayWrite === false) throw new KgError('internal', `module ${madeBy} tried to write during a read-only run`);
        wrote = applyWrites(env.index, result.writes, madeBy, env.now());
      }
      const slots: Record<string, Json> = {};
      for (const [k, v] of Object.entries(patch)) slots[k] = describeSlot(k, v);
      for (const k of RANKED) if (k in before && !(k in patch)) slots[`${k}:in`] = describeSlot(k, before[k]);
      const trace: StepTrace = { state: at, module: madeBy, ms: Math.round(performance.now() - t0), slots, notes, wrote };
      // what this step received (ranked lists before it) next to what it returned, so ranks can be audited
      const received: Record<string, Json> = {};
      for (const k of RANKED) if (k in before) received[k] = describeSlot(k, before[k]);
      steps.push(trace);
      log('step', { machine: def.name, state: at, module: madeBy, ms: trace.ms, received, returned: slots, notes: notes as unknown as Json, wrote });
      const next: Next = s.next;
      at = next === null ? null : typeof next === 'string' ? next : env.registry.guards.get(next.guard)!(state) ? next.then : next.else;
    }
  } catch (e) {
    log('pipeline.failed', { machine: def.name, state: at, error: e instanceof Error ? e.message : String(e), code: e instanceof KgError ? e.code : 'internal' });
    throw e;
  }
  log('pipeline.finished', { machine: def.name, version: def.version, steps: steps.length });
  return { state, steps };
}
