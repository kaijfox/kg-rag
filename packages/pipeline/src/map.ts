import type { AnyStateMachine } from 'xstate';
import { canonicalJson, sha256hex, type Json, type MachineEdge, type MachineMap, type MachineNode } from '@kg/core';

type Cfg = {
  id?: string;
  type?: string;
  initial?: string;
  meta?: { logs?: string; step?: string; label?: string; routing?: boolean };
  invoke?: Inv | Inv[];
  always?: Trans | Trans[];
  states?: Record<string, Cfg>;
};
type Inv = { onDone?: Trans | Trans[]; onError?: Trans | Trans[] };
type Trans = string | { target?: string; guard?: string | { type: string } };

/** Topology fingerprint: sha256 over the machine's config with every function replaced by a marker, first 16 hex. */
export function topologyOf(machine: AnyStateMachine): string {
  const plain = JSON.parse(JSON.stringify(machine.config, (_k, v) => (typeof v === 'function' ? 'fn' : v))) as Json;
  return sha256hex(canonicalJson(plain)).slice(0, 16);
}

const arr = <T>(x: T | T[] | undefined): T[] => (x === undefined ? [] : Array.isArray(x) ? x : [x]);

/**
 * Plain-data drawing of a machine, read from its config. A state is `work` when it invokes an actor, `routing`
 * when it only has `always` moves (or says so in meta), `final` when its type is final. Moves come from invoke
 * onDone / onError and from `always`; a move to a state that was reached earlier in the walk is marked as a loop.
 */
export function machineMapOf(machine: AnyStateMachine, id: { machine: string; version: string }): MachineMap {
  const root = machine.config as Cfg;
  const nodes: MachineNode[] = [];
  const edges: MachineEdge[] = [];
  const byId = new Map<string, string>();
  const order = new Map<string, number>();

  const walk = (states: Record<string, Cfg>, parent: string | null) => {
    for (const [key, cfg] of Object.entries(states)) {
      const path = parent === null ? key : `${parent}.${key}`;
      if (cfg.id) byId.set(cfg.id, path);
      order.set(path, order.size);
      if (cfg.states) walk(cfg.states, path);
    }
  };
  walk(root.states ?? {}, null);

  const resolve = (target: string, parent: string | null): string => {
    if (target.startsWith('#')) return byId.get(target.slice(1)) ?? target.slice(1);
    return parent === null ? target : `${parent}.${target}`;
  };
  const guardName = (g: string | { type: string } | undefined): string | null => (g === undefined ? null : typeof g === 'string' ? g : g.type);

  const emit = (states: Record<string, Cfg>, parent: string | null) => {
    for (const [key, cfg] of Object.entries(states)) {
      const path = parent === null ? key : `${parent}.${key}`;
      const invokes = arr(cfg.invoke);
      const kind = cfg.type === 'final' ? 'final' : cfg.meta?.routing || (invokes.length === 0 && cfg.always !== undefined) ? 'routing' : 'work';
      nodes.push({
        id: path,
        parent,
        kind,
        label: cfg.meta?.label ?? key,
        logs: cfg.meta?.logs ? cfg.meta.logs.split(/\s+/).filter(Boolean) : [],
        step: kind === 'work' ? (cfg.meta?.step ?? null) : null,
        loop: false,
      });
      const add = (event: MachineEdge['event'], t: Trans) => {
        const target = typeof t === 'string' ? t : t.target;
        if (!target) return;
        edges.push({ from: path, to: resolve(target, parent), event, guard: typeof t === 'string' ? null : guardName(t.guard) });
      };
      for (const inv of invokes) {
        for (const t of arr(inv.onDone)) add('done', t);
        for (const t of arr(inv.onError)) add('error', t);
      }
      for (const t of arr(cfg.always)) add('always', t);
      if (cfg.states) emit(cfg.states, path);
    }
  };
  emit(root.states ?? {}, null);

  const loopTargets = new Set(edges.filter((e) => (order.get(e.to) ?? 0) <= (order.get(e.from) ?? 0)).map((e) => e.to));
  for (const n of nodes) n.loop = loopTargets.has(n.id);
  const initial = root.initial ?? nodes[0]?.id ?? '';
  return { machine: id.machine, version: id.version, topology: topologyOf(machine), initial, nodes, edges };
}

/** Mermaid `stateDiagram-v2` text for a map. Stable output: nodes and edges in map order. */
export function toMermaid(map: MachineMap): string {
  const name = (id: string) => id.replace(/[^A-Za-z0-9_]/g, '_');
  const lines = ['stateDiagram-v2', `  [*] --> ${name(map.initial)}`];
  for (const n of map.nodes) {
    const detail = [n.step ? `step ${n.step}` : '', n.logs.length ? `logs ${n.logs.join(' ')}` : ''].filter(Boolean).join('; ');
    lines.push(`  ${name(n.id)} : ${n.label}${detail ? ` (${detail})` : ''}`);
  }
  for (const e of map.edges) lines.push(`  ${name(e.from)} --> ${name(e.to)} : ${e.event}${e.guard ? ` [${e.guard}]` : ''}`);
  for (const n of map.nodes) if (n.kind === 'final') lines.push(`  ${name(n.id)} --> [*]`);
  return lines.join('\n') + '\n';
}
