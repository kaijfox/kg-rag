/**
 * An evaluation run: every question under every condition, answered and judged, with retrieval metrics. One question or
 * condition that fails is recorded and the run goes on. Searches and model calls go through the kernel, so a run writes the
 * same events as an agent session, and results record the index they ran against.
 */
import { KgError, canonicalJson, hashId, sha256hex, type Json, type Kg, type Llm } from '@kg/kernel';
import { answer, ANSWER_SETTINGS } from './answer';
import { judge, JUDGE_SETTINGS } from './judge';
import { judgeMeans, retrievalMetrics } from './metrics/summary';
import { promptDigest } from './prompts/loader';
import type { EvalQuestion, EvalSet, RankedSource } from './types';

export const evalSetId = (questions: unknown): string => hashId('qs_', 'evalset/1', [canonicalJson(questions as Json)]);

const STANDARD = new Set(['no-context', 'gold', 'retrieved', 'oracle-gold-first']);

export interface RunOptions {
  /** "no-context", "gold", "retrieved" (the default search machine), "oracle-gold-first", or the name of a search machine */
  conditions: string[];
  ks: number[];
  /** passages given to the answerer under a retrieving condition; default 5 */
  contextK?: number;
  /** the model that answers and the one that judges, default local Ollama via the kernel's services */
  answerer?: Llm;
  judgeLlm?: Llm;
  sessionId?: string;
}

interface Outcome {
  questionId: string;
  condition: string;
  ranked: RankedSource[] | null;
  judgeScore: number;
}

export async function runEval(kg: Kg, set: EvalSet, o: RunOptions): Promise<{ runId: string; summary: Json }> {
  for (const c of o.conditions) if (!STANDARD.has(c) && !kg.registry.machines.has(c)) throw new KgError('invalid_input', `unknown condition ${JSON.stringify(c)}: not a standard name and not a search machine`);
  const base = o.answerer ?? kg.services.llm;
  if (!base) throw new KgError('precondition', 'an evaluation needs a model client');
  const sessionId = o.sessionId ?? kg.openSession('eval', set.name);
  const answerer = kg.llmFor(sessionId, base)!;
  const judgeLlm = kg.llmFor(sessionId, o.judgeLlm ?? base)!;
  const indexId = kg.index.indexId;
  const runId = kg.history.newRunId();
  const k = Math.max(...o.ks);
  const contextK = o.contextK ?? 5;
  const config = { conditions: o.conditions, ks: o.ks, contextK, answerer: { model: ANSWER_SETTINGS.model, promptDigest: promptDigest(['answer.md']) }, judge: { model: JUDGE_SETTINGS.model, promptDigest: promptDigest(['judge.md']) } };
  kg.history.putEvalRun({ runId, evalSetId: set.id, evalSetSha256: sha256hex(canonicalJson(set as unknown as Json)), indexId, sessionId, config });
  kg.history.append(sessionId, 'eval.run.started', { runId, evalSetId: set.id, questions: set.questions.length, ...config }, { indexId });

  const current = new Set(kg.index.filterCurrent(set.questions.flatMap((q) => q.goldChunkIds)));
  const orphaned = set.questions.flatMap((q) => {
    const missing = q.goldChunkIds.filter((c) => !current.has(c));
    return missing.length ? [{ questionId: q.id, missing, allMissing: missing.length === q.goldChunkIds.length }] : [];
  });
  const outcomes: Outcome[] = [];
  const failures: { questionId: string; condition: string; error: string }[] = [];

  for (const q of set.questions) {
    for (const condition of o.conditions) {
      try {
        let passages: string[] = [];
        let ranked: RankedSource[] | null = null;
        let searchId: string | null = null;
        if (condition === 'gold') passages = [...q.goldText];
        else if (condition !== 'no-context') {
          const machine = STANDARD.has(condition) ? undefined : condition;
          const r = await kg.search({ query: q.question, k, ...(machine ? { machine } : {}), sessionId });
          searchId = r.searchId;
          let items = r.items;
          if (condition === 'oracle-gold-first') {
            const gold = kg.index.getChunks(q.goldChunkIds.filter((c) => current.has(c))).map((c) => ({ id: c.id, kind: 'chunk' as const, text: c.text, score: 1, sourceChunkIds: [c.id] }));
            const have = new Set(gold.map((g) => g.id));
            items = [...gold, ...items.filter((i) => !have.has(i.id))].slice(0, k);
          }
          ranked = items.map((i) => ({ id: i.id, kind: i.kind, sourceChunkIds: i.sourceChunkIds }));
          passages = items.slice(0, contextK).map((i) => i.text);
        }
        const text = await answer(answerer, q.question, passages);
        const verdict = await judge(judgeLlm, q.question, q.referenceAnswer, text);
        const recall = ranked && q.goldChunkIds.length ? Object.fromEntries(o.ks.map((kk) => [String(kk), recallAt(q, ranked!, kk)])) : null;
        kg.history.putEvalResult({ runId, questionId: q.id, condition, searchId, retrieved: ranked ? ranked.map((x) => x.id) : null, recall, answer: text, judgeScore: verdict.score, judgeRaw: verdict.raw });
        kg.history.append(sessionId, 'eval.question.scored', { runId, questionId: q.id, condition, recall, judgeScore: verdict.score }, { indexId, searchId });
        outcomes.push({ questionId: q.id, condition, ranked, judgeScore: verdict.score });
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        failures.push({ questionId: q.id, condition, error });
        kg.history.append(sessionId, 'eval.question.failed', { runId, questionId: q.id, condition, error }, { indexId });
      }
    }
  }

  const byCondition: Record<string, Json> = {};
  for (const c of o.conditions) {
    const rows = outcomes.filter((x) => x.condition === c);
    const ranked = new Map(rows.filter((x) => x.ranked).map((x) => [x.questionId, x.ranked!]));
    const entry: Record<string, Json> = { scored: rows.length, failed: failures.filter((f) => f.condition === c).length, judge: judgeMeans(rows.map((x) => ({ condition: c, score: x.judgeScore })))[c] ?? null };
    // a question that failed under this condition is reported as failed and left out of the means
    if (ranked.size > 0) entry.retrieval = retrievalMetrics(set.questions.filter((x) => ranked.has(x.id)), (id) => ranked.get(id)!, o.ks) as unknown as Json;
    byCondition[c] = entry;
  }
  const summary = { indexId, questions: set.questions.length, ks: o.ks, byCondition, failures, orphaned } as unknown as Json;
  kg.history.finishEvalRun(runId, summary);
  kg.history.append(sessionId, 'eval.run.completed', { runId, failures: failures.length }, { indexId });
  return { runId, summary };
}

function recallAt(q: EvalQuestion, ranked: RankedSource[], k: number): number {
  const covered = new Set<string>();
  for (const r of ranked.slice(0, k)) if (r.kind !== 'summary') r.sourceChunkIds.forEach((c) => covered.add(c));
  const gold = [...new Set(q.goldChunkIds)];
  return gold.filter((g) => covered.has(g)).length / gold.length;
}
