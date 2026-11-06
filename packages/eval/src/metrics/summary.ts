import type { EvalQuestion, QuestionType, RankedSource } from '../types';
import { allGoldAtK, mean, recallAtK } from './recall';

export interface PerQuestionMetrics {
  recall: Record<string, number>;
  allGold: Record<string, number>;
  withSummaries: Record<string, number>;
}
export interface RetrievalMetrics {
  ks: number[];
  perQuestion: Record<string, PerQuestionMetrics>;
  overall: { recall: Record<string, number>; withSummaries: Record<string, number> };
  byType: Record<string, { n: number; recall: Record<string, number>; allGold: Record<string, number> }>;
}

/** Metrics for one ranked list per question (a question missing from `rankedBy` is an error). Questions without gold are skipped. */
export function retrievalMetrics(questions: readonly EvalQuestion[], rankedBy: (questionId: string) => RankedSource[], ks: readonly number[]): RetrievalMetrics {
  const scored = questions.filter((q) => q.goldChunkIds.length > 0);
  const perQuestion: Record<string, PerQuestionMetrics> = {};
  for (const q of scored) {
    const ranked = rankedBy(q.id);
    const row: PerQuestionMetrics = { recall: {}, allGold: {}, withSummaries: {} };
    for (const k of ks) {
      row.recall[String(k)] = recallAtK(q, ranked, k);
      row.allGold[String(k)] = allGoldAtK(q, ranked, k);
      row.withSummaries[String(k)] = recallAtK(q, ranked, k, { withSummaries: true });
    }
    perQuestion[q.id] = row;
  }
  const avg = (pick: (r: PerQuestionMetrics) => Record<string, number>, qs: EvalQuestion[]) =>
    Object.fromEntries(ks.map((k) => [String(k), mean(qs.map((q) => pick(perQuestion[q.id]!)[String(k)]!))]));
  const types = [...new Set<QuestionType>(scored.map((q) => q.type))];
  const byType = Object.fromEntries(
    types.map((t) => {
      const qs = scored.filter((q) => q.type === t);
      return [t, { n: qs.length, recall: avg((r) => r.recall, qs), allGold: avg((r) => r.allGold, qs) }];
    }),
  );
  return {
    ks: [...ks],
    perQuestion,
    overall: { recall: avg((r) => r.recall, scored), withSummaries: avg((r) => r.withSummaries, scored) },
    byType,
  };
}

/** Mean judge score per condition, from (question, condition, score) rows. */
export function judgeMeans(rows: readonly { condition: string; score: number }[]): Record<string, number> {
  const by = new Map<string, number[]>();
  for (const r of rows) by.set(r.condition, [...(by.get(r.condition) ?? []), r.score]);
  return Object.fromEntries([...by.entries()].map(([c, xs]) => [c, mean(xs)]));
}
