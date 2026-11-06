/**
 * Modules and state machines.
 *
 * A module is one function with a name, a version and a declaration of which slots (intermediate results of one
 * request) it needs and which it adds. A machine is plain data: states, each naming a module, and the move to the next
 * state (a state name, null to finish, or a guarded choice). `checkMachine` verifies at load that every module
 * exists, every slot a state needs is available on every path that reaches it, and every state can be reached and can
 * finish. A loop is a move back to an earlier state.
 */
import { KgError } from './errors';
import type { Json, JsonObject } from './ids';
import type { Embedder } from './embedder';
import type { IndexReader } from './indexStore';
import type { Llm } from './llm';
import type { ChunkRow, DerivedItemDraft, DocumentRow, EmbeddingSpace, LinkDraft } from './types';
import type { KgConfig } from './defaults';

export type Slots = Record<string, unknown>;

/** What a machine run may use besides the index: model clients and the like. */
export interface Services {
  embedder?: Embedder;
  llm?: Llm;
  space?: EmbeddingSpace;
  [k: string]: unknown;
}

export interface ModuleContext {
  index: IndexReader;
  services: Services;
  config: KgConfig;
  now(): string;
  /** adds a line to this step's record in the log */
  note(text: string, data?: Json): void;
}

/** What a module asks the runner to store. Modules never write to the index themselves. */
export interface Writes {
  documents?: { doc: Omit<DocumentRow, 'ingestNo' | 'ingestedAt'>; chunks: ChunkRow[] }[];
  embeddings?: { spaceId: string; rows: { recordId: string; vector: Float32Array }[] }[];
  derived?: { items: DerivedItemDraft[]; links?: LinkDraft[] };
}

export interface ModuleResult {
  patch?: Slots;
  writes?: Writes;
}

export type ModuleScope = 'request' | 'per-chunk' | 'whole-collection';

export interface ModuleDef<S = JsonObject> {
  name: string;
  version: string;
  needs: readonly string[];
  adds: readonly string[];
  /** per-chunk modules run on new chunks only; whole-collection modules recompute when the collection changes */
  scope: ModuleScope;
  run(a: { state: Slots; settings: S; ctx: ModuleContext }): Promise<ModuleResult> | ModuleResult;
}

export type Guard = (state: Slots) => boolean;
export type Next = string | null | { guard: string; then: string; else: string | null };
export interface StateDef {
  module: string;
  settings?: JsonObject;
  next: Next;
}
export interface MachineDef {
  name: string;
  version: string;
  description?: string;
  /** slots present when the run starts */
  provides: readonly string[];
  start: string;
  states: Record<string, StateDef>;
}

export class Registry {
  readonly modules = new Map<string, ModuleDef<never>>();
  readonly machines = new Map<string, MachineDef>();
  readonly guards = new Map<string, Guard>();

  addModule<S>(m: ModuleDef<S>): this {
    if (this.modules.has(m.name)) throw new KgError('conflict', `module ${m.name} is already registered`);
    this.modules.set(m.name, m as unknown as ModuleDef<never>);
    return this;
  }
  addGuard(name: string, g: Guard): this {
    this.guards.set(name, g);
    return this;
  }
  /** Registers a machine after checking it. A machine that fails the check is refused, naming every problem. */
  addMachine(def: MachineDef): this {
    const problems = checkMachine(def, this);
    if (problems.length > 0) throw new KgError('invalid_input', `machine ${def.name}@${def.version} is not wired correctly:\n- ${problems.join('\n- ')}`);
    this.machines.set(def.name, def);
    return this;
  }
  module(name: string): ModuleDef<never> {
    const m = this.modules.get(name);
    if (!m) throw new KgError('not_found', `module ${name}`);
    return m;
  }
  machine(name: string): MachineDef {
    const m = this.machines.get(name);
    if (!m) throw new KgError('not_found', `machine ${name}`);
    return m;
  }
}

const targetsOf = (n: Next): string[] => (n === null ? [] : typeof n === 'string' ? [n] : [n.then, ...(n.else === null ? [] : [n.else])]);

/**
 * The load-time wiring check. Returns every problem found; an empty list means the machine is sound.
 * Slot availability is a forward data-flow analysis: a state's available slots are those provided at the start or
 * added by modules on every path to it (the intersection over its predecessors).
 */
export function checkMachine(def: MachineDef, reg: Pick<Registry, 'modules' | 'guards'>): string[] {
  const problems: string[] = [];
  const names = Object.keys(def.states);
  if (!def.states[def.start]) problems.push(`start state ${def.start} does not exist`);
  for (const [sname, s] of Object.entries(def.states)) {
    if (!reg.modules.has(s.module)) problems.push(`state ${sname} uses unknown module ${s.module}`);
    for (const t of targetsOf(s.next)) if (!def.states[t]) problems.push(`state ${sname} moves to unknown state ${t}`);
    if (typeof s.next === 'object' && s.next !== null && !reg.guards.has(s.next.guard)) problems.push(`state ${sname} uses unknown guard ${s.next.guard}`);
  }
  if (problems.length > 0) return problems;

  // reachability from start, and the ability to finish from every reachable state
  const reach = new Set<string>();
  const walk = (n: string) => {
    if (reach.has(n)) return;
    reach.add(n);
    for (const t of targetsOf(def.states[n]!.next)) walk(t);
  };
  walk(def.start);
  for (const n of names) if (!reach.has(n)) problems.push(`state ${n} cannot be reached from ${def.start}`);
  const canFinish = new Set<string>(names.filter((n) => def.states[n]!.next === null || (typeof def.states[n]!.next === 'object' && (def.states[n]!.next as { else: string | null }).else === null)));
  for (let changed = true; changed; ) {
    changed = false;
    for (const n of names) if (!canFinish.has(n) && targetsOf(def.states[n]!.next).some((t) => canFinish.has(t))) (canFinish.add(n), (changed = true));
  }
  for (const n of reach) if (!canFinish.has(n)) problems.push(`state ${n} cannot lead to a finish`);

  // slot availability
  const all = new Set<string>(def.provides);
  for (const n of names) for (const a of reg.modules.get(def.states[n]!.module)!.adds) all.add(a);
  const inSet = new Map<string, Set<string>>();
  for (const n of names) inSet.set(n, n === def.start ? new Set(def.provides) : new Set(all));
  const preds = new Map<string, string[]>(names.map((n) => [n, []]));
  for (const n of names) for (const t of targetsOf(def.states[n]!.next)) preds.get(t)!.push(n);
  for (let changed = true; changed; ) {
    changed = false;
    for (const n of names) {
      if (n === def.start) continue;
      const ps = preds.get(n)!.filter((p) => reach.has(p));
      if (ps.length === 0) continue;
      const next = new Set<string>();
      for (const slot of all) if (ps.every((p) => inSet.get(p)!.has(slot) || reg.modules.get(def.states[p]!.module)!.adds.includes(slot))) next.add(slot);
      const cur = inSet.get(n)!;
      if (next.size !== cur.size || [...next].some((x) => !cur.has(x))) (inSet.set(n, next), (changed = true));
    }
  }
  for (const n of reach) {
    const m = reg.modules.get(def.states[n]!.module)!;
    const have = inSet.get(n)!;
    for (const need of m.needs) if (!have.has(need)) problems.push(`state ${n} (module ${m.name}) needs "${need}", which is not available on every path to it`);
  }
  return problems;
}
