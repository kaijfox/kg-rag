import { orphanedGold, type BuildId, type EvalSet, type Json } from '@kg/core';
import { judgeMeans, retrievalMetrics } from '../metrics/summary';
import type { Outcome } from '../machines/evalQuestion';
import type { RunDeps } from './types';

/** The run summary: per condition the judge mean and the retrieval metrics (when the condition ranked), and the orphaned gold. */
export function summarize(set: EvalSet, ks: number[], conditions: string[], outcomes: Outcome[], build: BuildId, d: Pick<RunDeps, 'store'>): Json {
  const byCondition: Record<string, Json> = {};
  for (const c of conditions) {
    const rows = outcomes.filter((o) => o.condition === c);
    const ranked = new Map(rows.filter((o) => o.ranked !== null).map((o) => [o.questionId, o.ranked!]));
    const entry: Record<string, Json> = { judge: judgeMeans(rows.map((o) => ({ condition: c, score: o.judgeScore })))[c]! };
    if (ranked.size > 0) {
      const m = retrievalMetrics(set.questions, (id) => ranked.get(id) ?? [], ks);
      entry.retrieval = m as unknown as Json;
    }
    byCondition[c] = entry;
  }
  const orphaned = orphanedGold(set, d.store, build);
  return { buildId: build, questions: set.questions.length, ks, byCondition, orphaned: orphaned as unknown as Json } as Json;
}
