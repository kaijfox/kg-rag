/**
 * Module layer. A module is a typed function with a name, a version, declared reads and writes of the shared state, and a
 * scope. A machine wires modules together; `checkWiring` verifies that wiring when the machine loads.
 * `defineSearchModule` builds a `SearchStep` from a light step function: the factory copies the state, refuses a write the
 * module did not declare, and fills in the trace (`output`, and `considered` unless the step says otherwise), so a step
 * states only what it changed.
 */
import { KgError } from './errors';
import type { Json, JsonObject, MachineMap } from './model';
import type { SearchState, SearchStep, StepEnv, StepTrace } from './ports/search';
import { fuseMax, sortCandidates, toRankedRefs, type RankedRef } from './scoring';

export const SEARCH_SLOTS = ['queries', 'candidates', 'seeds', 'pools', 'notes'] as const;
export type SearchSlot = (typeof SEARCH_SLOTS)[number];

/** `local`: depends on one chunk or a few, runs only on new input. `set`: depends on a whole collection, recomputed and records the state it saw. */
export type ModuleScope = 'local' | 'set';

export interface ModuleDescriptor {
  name: string;
  version: string;
  kind: 'search-step';
  reads: readonly SearchSlot[];
  writes: readonly SearchSlot[];
  scope: ModuleScope;
}

export type SearchPatch = Partial<Pick<SearchState, SearchSlot>>;

export interface SearchModuleResult {
  /** only the slots this step changed; each must be declared in `writes` */
  patch: SearchPatch;
  trace?: { params?: JsonObject; considered?: RankedRef[]; output?: RankedRef[]; details?: Json };
}

export interface SearchModule<P> {
  descriptor: ModuleDescriptor;
  make(params: P): SearchStep;
}

export function defineSearchModule<P>(
  d: { name: string; version: string; reads: readonly SearchSlot[]; writes: readonly SearchSlot[]; scope?: ModuleScope },
  run: (state: Readonly<SearchState>, env: StepEnv, params: P) => Promise<SearchModuleResult>,
): SearchModule<P> {
  const descriptor: ModuleDescriptor = { ...d, kind: 'search-step', scope: d.scope ?? 'local' };
  const touches = (slot: SearchSlot) => descriptor.reads.includes(slot) || descriptor.writes.includes(slot);
  return {
    descriptor,
    make: (params) => ({
      type: d.name,
      async run(state, env) {
        const res = await run(state, env, params);
        for (const k of Object.keys(res.patch)) {
          if (!(descriptor.writes as readonly string[]).includes(k)) {
            throw new KgError('internal', `module ${d.name}@${d.version} changed slot ${k}, which it does not declare in writes`);
          }
        }
        const next: SearchState = {
          ...state,
          queries: [...state.queries],
          candidates: [...state.candidates],
          seeds: [...state.seeds],
          pools: { ...state.pools },
          notes: { ...state.notes },
          ...res.patch,
        };
        const trace: Omit<StepTrace, 'stepIndex' | 'state' | 'durationMs'> = {
          stepType: d.name,
          params: res.trace?.params ?? {},
          considered: res.trace?.considered ?? toRankedRefs(fuseMax([...state.candidates, ...next.candidates])),
          output: res.trace?.output ?? toRankedRefs(sortCandidates(next.candidates)),
          ...(touches('queries') ? { queries: [...next.queries] } : {}),
          ...(touches('seeds') ? { seeds: [...next.seeds] } : {}),
          ...(touches('pools') && Object.keys(next.pools).length > 0
            ? { pools: Object.fromEntries(Object.entries(next.pools).map(([k, v]) => [k, toRankedRefs(v)])) }
            : {}),
          ...(res.trace?.details !== undefined ? { details: res.trace.details } : {}),
        };
        return { state: next, trace };
      },
    }),
  };
}

/**
 * Problems with a machine's wiring, empty when sound. Every work state must name a registered module, and every slot a
 * module reads must be provided at the start or written by a module in a state that can reach it.
 */
export function checkWiring(
  map: MachineMap,
  modules: Readonly<Record<string, ModuleDescriptor>>,
  provided: readonly SearchSlot[] = ['queries'],
): string[] {
  const out = new Map<string, string[]>();
  for (const e of map.edges) out.set(e.from, [...(out.get(e.from) ?? []), e.to]);
  const reach = (from: string): Set<string> => {
    const seen = new Set<string>();
    const stack = [...(out.get(from) ?? [])];
    while (stack.length > 0) {
      const n = stack.pop()!;
      if (seen.has(n)) continue;
      seen.add(n);
      stack.push(...(out.get(n) ?? []));
    }
    return seen;
  };
  const moduleOf = (step: string | null): ModuleDescriptor | undefined => (step !== null && Object.hasOwn(modules, step) ? modules[step] : undefined);
  const problems: string[] = [];
  for (const n of map.nodes) {
    if (n.kind !== 'work') continue;
    const m = moduleOf(n.step);
    if (!m) {
      problems.push(n.step === null ? `state ${n.id} names no step` : `state ${n.id} names step ${n.step}, which has no registered module`);
      continue;
    }
    for (const slot of m.reads) {
      if (provided.includes(slot)) continue;
      const written = map.nodes.some((w) => w.id !== n.id && w.kind === 'work' && moduleOf(w.step)?.writes.includes(slot) && reach(w.id).has(n.id));
      if (!written) problems.push(`state ${n.id} (${m.name}) reads ${slot}, which nothing before it writes`);
    }
  }
  return problems;
}

export function assertWiring(map: MachineMap, modules: Readonly<Record<string, ModuleDescriptor>>, provided?: readonly SearchSlot[]): void {
  const problems = checkWiring(map, modules, provided);
  if (problems.length > 0) throw new KgError('invalid_input', `machine ${map.machine}@${map.version} is mis-wired: ${problems.join('; ')}`);
}

/** The recipe's record of which module version ran in each named step; a changed module version changes the recipe id. */
export function modulesOf(map: MachineMap, modules: Readonly<Record<string, ModuleDescriptor>>): Record<string, string> {
  const r: Record<string, string> = {};
  for (const n of map.nodes) {
    const m = n.kind === 'work' && n.step !== null && Object.hasOwn(modules, n.step) ? modules[n.step] : undefined;
    if (m) r[n.step as string] = `${m.name}@${m.version}`;
  }
  return Object.fromEntries(Object.entries(r).sort(([a], [b]) => (a < b ? -1 : 1)));
}
