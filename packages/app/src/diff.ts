/**
 * An internal tool for investigating an upgrade: compares two indexes built from the same sources. Chunk IDs come from
 * content, so the chunks line up, and what differs is what the derived records say about each chunk.
 */
import type { IndexStore } from '@kg/kernel';

export interface IndexDiff {
  a: string;
  b: string;
  chunks: { onlyInA: number; onlyInB: number; shared: number };
  /** derived items per maker, in each index */
  makers: Record<string, { a: number; b: number }>;
  /** shared chunks whose derived items differ, with the items each side has */
  changed: { chunkId: string; a: string[]; b: string[] }[];
  unchanged: number;
}

export function diffIndexes(a: IndexStore, b: IndexStore, limit = 50): IndexDiff {
  const ca = new Set(a.currentChunks().map((c) => c.id));
  const cb = new Set(b.currentChunks().map((c) => c.id));
  const shared = [...ca].filter((c) => cb.has(c));
  const ia = a.itemsByChunk();
  const ib = b.itemsByChunk();
  const makers: IndexDiff['makers'] = {};
  for (const [side, m] of [['a', ia], ['b', ib]] as const) {
    const seen = new Set<string>();
    for (const items of m.values())
      for (const i of items) if (!seen.has(i.id)) (seen.add(i.id), (makers[i.madeBy] ??= { a: 0, b: 0 })[side]++);
  }
  const changed: IndexDiff['changed'] = [];
  let unchanged = 0;
  for (const id of shared) {
    const ta = (ia.get(id) ?? []).map((i) => i.text).sort();
    const tb = (ib.get(id) ?? []).map((i) => i.text).sort();
    if (JSON.stringify(ta) === JSON.stringify(tb)) unchanged++;
    else if (changed.length < limit) changed.push({ chunkId: id, a: ta, b: tb });
  }
  return { a: a.indexId, b: b.indexId, chunks: { onlyInA: [...ca].filter((c) => !cb.has(c)).length, onlyInB: [...cb].filter((c) => !ca.has(c)).length, shared: shared.length }, makers, changed, unchanged };
}
