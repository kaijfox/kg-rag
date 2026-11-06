/**
 * The history: what a rebuild must not touch. The event log, sessions and notes, evaluation runs and results, and
 * corrections that a person confirmed (aliases and replacements). One SQLite file, keyed to chunk IDs and names,
 * never to derived-item IDs, so it survives a rebuild. Events record the index they ran against.
 */
import { KgError } from './errors';
import { canonicalJson, ulidGen, type Json, type JsonObject } from './ids';
import { Sql, openDb } from './sqlite';

const SCHEMA = `
CREATE TABLE sessions (session_id TEXT PRIMARY KEY, kind TEXT NOT NULL, label TEXT, started_at TEXT NOT NULL, meta TEXT NOT NULL DEFAULT '{}');
CREATE TABLE events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT NOT NULL UNIQUE, session_id TEXT NOT NULL REFERENCES sessions(session_id),
  ts TEXT NOT NULL, type TEXT NOT NULL, index_id TEXT, search_id TEXT, payload TEXT NOT NULL);
CREATE INDEX events_by_session ON events(session_id, seq);
CREATE INDEX events_by_search ON events(search_id);
CREATE INDEX events_by_type ON events(type, seq);
CREATE TABLE session_notes (note_id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL REFERENCES sessions(session_id), ts TEXT NOT NULL, text TEXT NOT NULL);
CREATE TABLE eval_runs (
  run_id TEXT PRIMARY KEY, eval_set_id TEXT NOT NULL, eval_set_sha256 TEXT NOT NULL, index_id TEXT NOT NULL,
  session_id TEXT NOT NULL REFERENCES sessions(session_id), config TEXT NOT NULL, summary TEXT, created_at TEXT NOT NULL);
CREATE TABLE eval_results (
  run_id TEXT NOT NULL REFERENCES eval_runs(run_id), question_id TEXT NOT NULL, condition TEXT NOT NULL, search_id TEXT,
  retrieved TEXT, recall TEXT, answer TEXT, judge_score REAL, judge_raw TEXT, PRIMARY KEY (run_id, question_id, condition));
CREATE TABLE corrections (
  correction_id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL CHECK (kind IN ('alias-of', 'replaces')),
  subject TEXT NOT NULL CHECK (subject IN ('name', 'chunk')), from_key TEXT NOT NULL, to_key TEXT NOT NULL,
  note TEXT, created_at TEXT NOT NULL, UNIQUE (kind, subject, from_key, to_key));
CREATE TRIGGER events_insert_only BEFORE UPDATE ON events BEGIN SELECT RAISE(ABORT, 'events are insert-only'); END;
CREATE TRIGGER events_never_deleted BEFORE DELETE ON events BEGIN SELECT RAISE(ABORT, 'events are insert-only'); END;
`;

export interface EventRow {
  seq: number;
  eventId: string;
  sessionId: string;
  ts: string;
  type: string;
  indexId: string | null;
  searchId: string | null;
  payload: Json;
}
export interface SessionRow {
  sessionId: string;
  kind: string;
  label: string | null;
  startedAt: string;
  meta: JsonObject;
  events: number;
  lastTs: string | null;
}
export interface Correction {
  id: number;
  kind: 'alias-of' | 'replaces';
  subject: 'name' | 'chunk';
  fromKey: string;
  toKey: string;
  note: string | null;
  createdAt: string;
}
export interface EvalResultRow {
  runId: string;
  questionId: string;
  condition: string;
  searchId: string | null;
  retrieved: string[] | null;
  recall: Record<string, number> | null;
  answer: string | null;
  judgeScore: number | null;
  judgeRaw: string | null;
}

export class HistoryStore {
  private readonly ids = ulidGen();
  private constructor(
    private readonly sql: Sql,
    private readonly now: () => string,
  ) {}

  static open(path: string, now: () => string = () => new Date().toISOString()): HistoryStore {
    return new HistoryStore(new Sql(openDb(path, [SCHEMA])), now);
  }
  close(): void {
    this.sql.close();
  }

  openSession(o: { kind: string; label?: string | null; meta?: JsonObject }): string {
    const id = this.ids.ulid('se_');
    this.sql.run(`INSERT INTO sessions (session_id, kind, label, started_at, meta) VALUES (?, ?, ?, ?, ?)`, id, o.kind, o.label ?? null, this.now(), canonicalJson(o.meta ?? {}));
    this.append(id, 'session.opened', { kind: o.kind, label: o.label ?? null });
    return id;
  }

  /** Appends one event and returns its sequence number. Events are never changed or deleted. */
  append(sessionId: string, type: string, payload: Json, o: { indexId?: string | null; searchId?: string | null } = {}): number {
    const id = this.ids.ulid('ev_');
    this.sql.run(
      `INSERT INTO events (event_id, session_id, ts, type, index_id, search_id, payload) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      id, sessionId, this.now(), type, o.indexId ?? null, o.searchId ?? null, JSON.stringify(payload),
    );
    return this.sql.get<{ seq: number }>(`SELECT seq FROM events WHERE event_id = ?`, id)!.seq;
  }

  newSearchId(): string {
    return this.ids.ulid('sr_');
  }
  newRunId(): string {
    return this.ids.ulid('er_');
  }

  sessions(limit = 100): SessionRow[] {
    return this.sql
      .all<{ session_id: string; kind: string; label: string | null; started_at: string; meta: string; n: number; last_ts: string | null }>(
        `SELECT s.*, (SELECT COUNT(*) FROM events e WHERE e.session_id = s.session_id) AS n,
                (SELECT MAX(ts) FROM events e WHERE e.session_id = s.session_id) AS last_ts
         FROM sessions s ORDER BY s.session_id DESC LIMIT ?`,
        limit,
      )
      .map((r) => ({ sessionId: r.session_id, kind: r.kind, label: r.label, startedAt: r.started_at, meta: JSON.parse(r.meta) as JsonObject, events: r.n, lastTs: r.last_ts }));
  }

  events(sessionId: string, afterSeq = 0): EventRow[] {
    return this.sql
      .all<{ seq: number; event_id: string; session_id: string; ts: string; type: string; index_id: string | null; search_id: string | null; payload: string }>(
        `SELECT * FROM events WHERE session_id = ? AND seq > ? ORDER BY seq`, sessionId, afterSeq,
      )
      .map(toEvent);
  }

  eventsOfType(type: string, limit = 1000): EventRow[] {
    return this.sql
      .all<{ seq: number; event_id: string; session_id: string; ts: string; type: string; index_id: string | null; search_id: string | null; payload: string }>(
        `SELECT * FROM events WHERE type = ? ORDER BY seq DESC LIMIT ?`, type, limit,
      )
      .map(toEvent);
  }

  eventsOfSearch(searchId: string): EventRow[] {
    return this.sql
      .all<{ seq: number; event_id: string; session_id: string; ts: string; type: string; index_id: string | null; search_id: string | null; payload: string }>(
        `SELECT * FROM events WHERE search_id = ? ORDER BY seq`, searchId,
      )
      .map(toEvent);
  }

  addNote(sessionId: string, text: string): void {
    this.sql.run(`INSERT INTO session_notes (session_id, ts, text) VALUES (?, ?, ?)`, sessionId, this.now(), text);
  }
  notes(sessionId: string): { ts: string; text: string }[] {
    return this.sql.all<{ ts: string; text: string }>(`SELECT ts, text FROM session_notes WHERE session_id = ? ORDER BY note_id`, sessionId);
  }

  // ---------------------------------------------------------------- evaluation

  putEvalRun(r: { runId: string; evalSetId: string; evalSetSha256: string; indexId: string; sessionId: string; config: JsonObject }): void {
    this.sql.run(
      `INSERT INTO eval_runs (run_id, eval_set_id, eval_set_sha256, index_id, session_id, config, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      r.runId, r.evalSetId, r.evalSetSha256, r.indexId, r.sessionId, canonicalJson(r.config), this.now(),
    );
  }
  finishEvalRun(runId: string, summary: Json): void {
    this.sql.run(`UPDATE eval_runs SET summary = ? WHERE run_id = ?`, JSON.stringify(summary), runId);
  }
  putEvalResult(r: EvalResultRow): void {
    this.sql.run(
      `INSERT OR REPLACE INTO eval_results (run_id, question_id, condition, search_id, retrieved, recall, answer, judge_score, judge_raw) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      r.runId, r.questionId, r.condition, r.searchId, r.retrieved ? JSON.stringify(r.retrieved) : null, r.recall ? JSON.stringify(r.recall) : null, r.answer, r.judgeScore, r.judgeRaw,
    );
  }
  evalRuns(): { runId: string; evalSetId: string; indexId: string; createdAt: string; config: JsonObject; summary: Json | null }[] {
    return this.sql
      .all<{ run_id: string; eval_set_id: string; index_id: string; created_at: string; config: string; summary: string | null }>(`SELECT * FROM eval_runs ORDER BY run_id DESC`)
      .map((r) => ({ runId: r.run_id, evalSetId: r.eval_set_id, indexId: r.index_id, createdAt: r.created_at, config: JSON.parse(r.config) as JsonObject, summary: r.summary ? (JSON.parse(r.summary) as Json) : null }));
  }
  evalResults(runId: string): EvalResultRow[] {
    return this.sql
      .all<{ run_id: string; question_id: string; condition: string; search_id: string | null; retrieved: string | null; recall: string | null; answer: string | null; judge_score: number | null; judge_raw: string | null }>(
        `SELECT * FROM eval_results WHERE run_id = ? ORDER BY question_id, condition`, runId,
      )
      .map((r) => ({
        runId: r.run_id, questionId: r.question_id, condition: r.condition, searchId: r.search_id,
        retrieved: r.retrieved ? (JSON.parse(r.retrieved) as string[]) : null, recall: r.recall ? (JSON.parse(r.recall) as Record<string, number>) : null,
        answer: r.answer, judgeScore: r.judge_score, judgeRaw: r.judge_raw,
      }));
  }

  // ---------------------------------------------------------------- confirmed corrections

  addCorrection(c: Omit<Correction, 'id' | 'createdAt'>): void {
    if (c.fromKey === c.toKey) throw new KgError('invalid_input', 'a correction must join two different keys');
    this.sql.run(`INSERT OR IGNORE INTO corrections (kind, subject, from_key, to_key, note, created_at) VALUES (?, ?, ?, ?, ?, ?)`, c.kind, c.subject, c.fromKey, c.toKey, c.note, this.now());
  }
  corrections(): Correction[] {
    return this.sql
      .all<{ correction_id: number; kind: string; subject: string; from_key: string; to_key: string; note: string | null; created_at: string }>(`SELECT * FROM corrections ORDER BY correction_id`)
      .map((r) => ({ id: r.correction_id, kind: r.kind as Correction['kind'], subject: r.subject as Correction['subject'], fromKey: r.from_key, toKey: r.to_key, note: r.note, createdAt: r.created_at }));
  }
  removeCorrection(id: number): void {
    this.sql.run(`DELETE FROM corrections WHERE correction_id = ?`, id);
  }
}

function toEvent(r: { seq: number; event_id: string; session_id: string; ts: string; type: string; index_id: string | null; search_id: string | null; payload: string }): EventRow {
  return { seq: r.seq, eventId: r.event_id, sessionId: r.session_id, ts: r.ts, type: r.type, indexId: r.index_id, searchId: r.search_id, payload: JSON.parse(r.payload) as Json };
}
