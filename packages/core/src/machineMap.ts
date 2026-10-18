/**
 * Structural check of a MachineMap beyond its zod shape: unique node ids, parents and edge ends that exist, the initial
 * state exists, finals have no outgoing moves, and every non-final node has at least one. Returns a list of problems
 * (empty = valid). Pure data; no state-machine library involved.
 */
import { machineMapSchema } from './schemas';
import type { MachineMap } from './model';

export function validateMachineMap(map: unknown): string[] {
  const r = machineMapSchema.safeParse(map);
  if (!r.success) return r.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
  const m: MachineMap = r.data;
  const problems: string[] = [];
  const ids = new Set<string>();
  for (const n of m.nodes) {
    if (ids.has(n.id)) problems.push(`duplicate node id ${n.id}`);
    ids.add(n.id);
  }
  for (const n of m.nodes) if (n.parent !== null && !ids.has(n.parent)) problems.push(`node ${n.id}: unknown parent ${n.parent}`);
  if (!ids.has(m.initial)) problems.push(`initial state ${m.initial} is not a node`);
  const out = new Map<string, number>();
  for (const e of m.edges) {
    if (!ids.has(e.from)) problems.push(`edge from unknown node ${e.from}`);
    if (!ids.has(e.to)) problems.push(`edge to unknown node ${e.to}`);
    out.set(e.from, (out.get(e.from) ?? 0) + 1);
  }
  for (const n of m.nodes) {
    const k = out.get(n.id) ?? 0;
    if (n.kind === 'final' && k > 0) problems.push(`final node ${n.id} has outgoing moves`);
    if (n.kind !== 'final' && k === 0) problems.push(`node ${n.id} has no outgoing move`);
  }
  if (!m.nodes.some((n) => n.kind === 'final')) problems.push('no final node');
  return problems;
}
