/** SqliteEvalRepo: the EvalRepo port over the eval tables of the shared schema (insert-only, enforced by triggers). */
import { canonicalJson, KgError, type EvalRepo, type EvalResultRecord, type EvalRunId, type EvalRunRecord, type ItemId, type Json, type SearchId, type SessionId, type BuildId, type EvalSetId } from '@kg/core';
import { type Db, Sql, guard, notFound, prepareSchema } from './db';

const json = (v: unknown): string => canonicalJson(v as Json);

export class SqliteEvalRepo implements EvalRepo {
  private readonly sql: Sql;

  /** Applies the shared schema (idempotent) and loads sqlite-vec. */
  constructor(db: Db) {
    prepareSchema(db);
    this.sql = new Sql(db);
  }

  putRun(r: EvalRunRecord): void {
    guard(() => {
      const cur = this.getRun(r.runId);
      if (cur) {
        if (json(cur) !== json(r)) throw new KgError('conflict', `eval run ${r.runId} exists with different content`);
        return;
      }
      this.sql.run(
        'INSERT INTO eval_runs (run_id, eval_set_id, eval_set_sha256, build_id, session_id, config, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        r.runId, r.evalSetId, r.evalSetSha256, r.buildId, r.sessionId, json(r.config), r.createdAt,
      );
    });
  }

  putResult(r: EvalResultRecord): void {
    guard(() => this.sql.transaction(() => {
      if (!this.sql.get('SELECT 1 FROM eval_runs WHERE run_id = ?', r.runId)) throw notFound(`eval run ${r.runId}`);
      const cur = this.resultOf(r.runId, r.questionId, r.condition);
      if (cur) {
        if (json(cur) !== json(r)) throw new KgError('conflict', `result ${r.questionId}/${r.condition} exists with different content`);
        return;
      }
      this.sql.run(
        'INSERT INTO eval_results (run_id, question_id, condition, search_id, retrieved, recall, answer, judge_score, judge_raw) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        r.runId,
        r.questionId,
        r.condition,
        r.searchId,
        r.retrieved === null ? null : json(r.retrieved),
        r.recall === null ? null : json(r.recall),
        r.answer,
        r.judgeScore,
        r.judgeRaw,
      );
    }));
  }

  getRun(runId: EvalRunId): EvalRunRecord | null {
    return guard(() => {
      const row = this.sql.get('SELECT eval_set_id, eval_set_sha256, build_id, session_id, config, created_at FROM eval_runs WHERE run_id = ?', runId);
      if (!row) return null;
      return {
        runId,
        evalSetId: row.eval_set_id as EvalSetId,
        evalSetSha256: row.eval_set_sha256 as string,
        buildId: row.build_id as BuildId,
        sessionId: row.session_id as SessionId,
        config: JSON.parse(row.config as string) as EvalRunRecord['config'],
        createdAt: row.created_at as string,
      };
    });
  }

  results(runId: EvalRunId): EvalResultRecord[] {
    return guard(() => {
      const rows = this.sql.all('SELECT question_id, condition FROM eval_results WHERE run_id = ?', runId);
      return rows
        .map((r) => ({ questionId: r.question_id as string, condition: r.condition as string }))
        .sort((a, b) => (a.questionId !== b.questionId ? (a.questionId < b.questionId ? -1 : 1) : a.condition < b.condition ? -1 : a.condition > b.condition ? 1 : 0))
        .map((k) => this.resultOf(runId, k.questionId, k.condition)!);
    });
  }

  private resultOf(runId: EvalRunId, questionId: string, condition: string): EvalResultRecord | null {
    const row = this.sql.get(
      'SELECT search_id, retrieved, recall, answer, judge_score, judge_raw FROM eval_results WHERE run_id = ? AND question_id = ? AND condition = ?',
      runId, questionId, condition,
    );
    if (!row) return null;
    return {
      runId,
      questionId,
      condition,
      searchId: (row.search_id as SearchId | null) ?? null,
      retrieved: row.retrieved === null ? null : (JSON.parse(row.retrieved as string) as ItemId[]),
      recall: row.recall === null ? null : (JSON.parse(row.recall as string) as Record<string, number>),
      answer: (row.answer as string | null) ?? null,
      judgeScore: (row.judge_score as number | null) ?? null,
      judgeRaw: (row.judge_raw as string | null) ?? null,
    };
  }
}
