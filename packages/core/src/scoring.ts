/**
 * Score and order rules shared by every step, store and fake.
 * - score = 1 - cosine distance = cosine similarity; higher is better.
 * - ties broken by itemId ascending (JS string comparison, i.e. UTF-16 code units).
 * - ranks are 1-based and contiguous.
 * - a zero-norm vector scores 0 against anything.
 */
import type { ItemId } from './ids';

/** 1 - cosine distance, accumulated in float64. */
export function cosineScore(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (a.length !== b.length) throw new Error(`dimension mismatch ${a.length} vs ${b.length}`);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export function compareCandidates(a: { itemId: ItemId; score: number }, b: { itemId: ItemId; score: number }): number {
  if (a.score !== b.score) return b.score - a.score;
  return a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0;
}

/** Returns a new array: score descending, then itemId ascending. Does not dedupe. */
export function sortCandidates<T extends { itemId: ItemId; score: number }>(xs: readonly T[]): T[] {
  return [...xs].sort(compareCandidates);
}

/** Keeps one entry per itemId (the highest score; on equal scores the first seen), then sorts. */
export function fuseMax<T extends { itemId: ItemId; score: number }>(xs: readonly T[]): T[] {
  const best = new Map<ItemId, T>();
  for (const x of xs) {
    const cur = best.get(x.itemId);
    if (cur === undefined || x.score > cur.score) best.set(x.itemId, x);
  }
  return sortCandidates([...best.values()]);
}

export interface RankedRef {
  itemId: ItemId;
  score: number;
  rank: number;
  /** QueryVariant.id the candidate was retrieved (or last rescored) for; null when not query-specific */
  queryId: string | null;
}

/** Ranks an already sorted list 1..n (queryId copied when present, else null). */
export function toRankedRefs(sorted: readonly { itemId: ItemId; score: number; queryId?: string | null }[]): RankedRef[] {
  return sorted.map((c, i) => ({ itemId: c.itemId, score: c.score, rank: i + 1, queryId: c.queryId ?? null }));
}

/** True if refs are sorted by the rule, unique, and ranked 1..n. */
export function isProperlyRanked(refs: readonly RankedRef[]): boolean {
  const seen = new Set<ItemId>();
  for (let i = 0; i < refs.length; i++) {
    const r = refs[i]!;
    if (r.rank !== i + 1 || seen.has(r.itemId)) return false;
    seen.add(r.itemId);
    if (i > 0 && compareCandidates(refs[i - 1]!, r) > 0) return false;
  }
  return true;
}
