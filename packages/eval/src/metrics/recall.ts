import { KgError } from '@kg/kernel';
import type { EvalQuestion, RankedSource } from '../types';

export interface RecallOptions {
  /** count the sources of summary items too (reported separately; summaries inflate recall) */
  withSummaries?: boolean;
}

/** Gold chunks covered by the top k: the union of sourceChunkIds of the items at ranks 1..k (summaries excluded unless asked). */
export function coveredAtK(ranked: readonly RankedSource[], k: number, o: RecallOptions = {}): Set<string> {
  const covered = new Set<string>();
  for (const item of ranked.slice(0, k)) {
    if (item.kind === 'summary' && !o.withSummaries) continue;
    for (const c of item.sourceChunkIds) covered.add(c);
  }
  return covered;
}

function goldOf(q: Pick<EvalQuestion, 'goldChunkIds'>): string[] {
  if (q.goldChunkIds.length === 0) throw new KgError('invalid_input', 'recall is undefined for a question without gold chunk IDs');
  return [...new Set<string>(q.goldChunkIds)];
}

/** recall@k = |gold chunks covered in the top k| / |gold chunks|. Counted per unique gold chunk, never per item. */
export function recallAtK(q: Pick<EvalQuestion, 'goldChunkIds'>, ranked: readonly RankedSource[], k: number, o: RecallOptions = {}): number {
  const gold = goldOf(q);
  const covered = coveredAtK(ranked, k, o);
  return gold.filter((g) => covered.has(g)).length / gold.length;
}

/** 1 if every gold chunk is covered in the top k, else 0. */
export function allGoldAtK(q: Pick<EvalQuestion, 'goldChunkIds'>, ranked: readonly RankedSource[], k: number, o: RecallOptions = {}): 0 | 1 {
  return recallAtK(q, ranked, k, o) === 1 ? 1 : 0;
}

export const mean = (xs: readonly number[]): number => {
  if (xs.length === 0) throw new KgError('invalid_input', 'mean of no values');
  return xs.reduce((a, b) => a + b, 0) / xs.length;
};
