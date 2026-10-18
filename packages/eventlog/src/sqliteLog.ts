import {
  KgError,
  SCHEMA_VERSION,
  schemaSql,
  validateEventDraft,
  type BuildId,
  type Clock,
  type EventDraft,
  type EventEnvelope,
  type EventId,
  type EventLog,
  type IdGen,
  type Json,
  type LogReader,
  type SearchId,
  type SessionFilter,
  type SessionId,
  type SessionKind,
  type SessionNote,
  type SessionSummary,
} from '@kg/core';
import type Database from 'better-sqlite3';

/** How long a connection waits for another writer's lock before the call fails with an `upstream` error. */
const BUSY_TIMEOUT_MS = 5000;

interface EventRow {
  event_id: string;
  session_id: string;
  seq: number;
  ts: string;
  type: string;
  schema_version: number;
  build_id: string | null;
  search_id: string | null;
  parent_id: string | null;
  payload: string;
}

interface SessionRow {
  session_id: string;
  kind: string;
  label: string | null;
  started_at: string;
  event_count: number;
  last_event_at: string | null;
}

interface NoteRow {
  note_id: number;
  session_id: string;
  ts: string;
  text: string;
}

const EVENT_COLUMNS = 'event_id, session_id, seq, ts, type, schema_version, build_id, search_id, parent_id, payload';

const SESSION_SUMMARY_SQL = `SELECT s.session_id, s.kind, s.label, s.started_at,
  (SELECT COUNT(*) FROM events e WHERE e.session_id = s.session_id) AS event_count,
  (SELECT e.ts FROM events e WHERE e.session_id = s.session_id ORDER BY e.seq DESC LIMIT 1) AS last_event_at
  FROM sessions s`;

/** SQLite-backed EventLog and LogReader. Reads and writes the sessions, events and session_notes tables. */
export class SqliteEventLog implements EventLog, LogReader {
  private readonly insertSession: Database.Statement;
  private readonly insertEvent: Database.Statement;
  private readonly insertNote: Database.Statement;
  private readonly sessionExists: Database.Statement;
  private readonly maxSeq: Database.Statement;
  private readonly eventById: Database.Statement;
  private readonly notesOf: Database.Statement;
  private readonly appendTx: (d: EventDraft) => EventEnvelope;
  private readonly openTx: (kind: SessionKind, label: string | null, meta: { [k: string]: Json }) => SessionId;

  constructor(
    private readonly db: Database.Database,
    private readonly clock: Clock,
    private readonly ids: IdGen,
  ) {
    guardBusy(() => {
      db.pragma('journal_mode = WAL');
      db.pragma('foreign_keys = ON');
      db.pragma(`busy_timeout = ${BUSY_TIMEOUT_MS}`);
      if (!schemaCurrent(db)) db.exec(schemaSql());
    });
    this.insertSession = db.prepare('INSERT INTO sessions (session_id, kind, label, meta, started_at) VALUES (?, ?, ?, ?, ?)');
    this.insertEvent = db.prepare(
      `INSERT INTO events (event_id, session_id, seq, ts, type, schema_version, build_id, search_id, parent_id, payload)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    this.insertNote = db.prepare('INSERT INTO session_notes (session_id, ts, text) VALUES (?, ?, ?)');
    this.sessionExists = db.prepare('SELECT 1 AS found FROM sessions WHERE session_id = ?');
    this.maxSeq = db.prepare('SELECT COALESCE(MAX(seq), 0) AS seq FROM events WHERE session_id = ?');
    this.eventById = db.prepare(`SELECT ${EVENT_COLUMNS} FROM events WHERE event_id = ?`);
    this.notesOf = db.prepare('SELECT note_id, session_id, ts, text FROM session_notes WHERE session_id = ? ORDER BY note_id');

    this.appendTx = db.transaction((d: EventDraft): EventEnvelope => {
      if (!this.sessionExists.get(d.sessionId)) throw new KgError('not_found', `session ${d.sessionId}`);
      const { seq } = this.maxSeq.get(d.sessionId) as { seq: number };
      const id = this.ids.ulid('ev_');
      const ts = this.clock.now();
      this.insertEvent.run(id, d.sessionId, seq + 1, ts, d.type, 1, d.buildId, d.searchId, d.parentId, JSON.stringify(d.payload));
      return this.readEvent(id);
    }).immediate;

    this.openTx = db.transaction((kind: SessionKind, label: string | null, meta: { [k: string]: Json }): SessionId => {
      const sessionId = this.ids.ulid('se_') as SessionId;
      const startedAt = this.clock.now();
      this.insertSession.run(sessionId, kind, label, JSON.stringify(meta), startedAt);
      this.insertEvent.run(
        this.ids.ulid('ev_'),
        sessionId,
        1,
        startedAt,
        'session.started',
        1,
        null,
        null,
        null,
        JSON.stringify({ kind, label, meta }),
      );
      return sessionId;
    }).immediate;
  }

  openSession(s: { kind: SessionKind; label: string | null; meta: { [k: string]: Json } }): SessionId {
    return guardBusy(() => this.openTx(s.kind, s.label, s.meta));
  }

  append(e: EventDraft): EventEnvelope {
    const d = validateEventDraft(e);
    return guardBusy(() => this.appendTx(d));
  }

  sessions(f: SessionFilter = {}): SessionSummary[] {
    const where: string[] = [];
    const params: (string | number)[] = [];
    if (f.kind !== undefined) {
      where.push('s.kind = ?');
      params.push(f.kind);
    }
    if (f.since !== undefined) {
      where.push('s.started_at >= ?');
      params.push(f.since);
    }
    params.push(checkedCount(f.limit ?? 100, 'limit'));
    const whereSql = where.length > 0 ? ` WHERE ${where.join(' AND ')}` : '';
    const rows = this.db
      .prepare(`${SESSION_SUMMARY_SQL}${whereSql} ORDER BY s.started_at DESC, s.session_id DESC LIMIT ?`)
      .all(...params) as SessionRow[];
    return rows.map(toSession);
  }

  getSession(sessionId: SessionId): SessionSummary | null {
    const row = this.db.prepare(`${SESSION_SUMMARY_SQL} WHERE s.session_id = ?`).get(sessionId) as SessionRow | undefined;
    return row ? toSession(row) : null;
  }

  events(sessionId: SessionId, afterSeq = 0, limit = 1000): EventEnvelope[] {
    const rows = this.db
      .prepare(`SELECT ${EVENT_COLUMNS} FROM events WHERE session_id = ? AND seq > ? ORDER BY seq LIMIT ?`)
      .all(sessionId, checkedCount(afterSeq, 'afterSeq'), checkedCount(limit, 'limit')) as EventRow[];
    return rows.map(toEvent);
  }

  eventsBySearch(searchId: SearchId): EventEnvelope[] {
    const rows = this.db
      .prepare(`SELECT ${EVENT_COLUMNS} FROM events WHERE search_id = ? ORDER BY seq, session_id`)
      .all(searchId) as EventRow[];
    return rows.map(toEvent);
  }

  notes(sessionId: SessionId): SessionNote[] {
    return (this.notesOf.all(sessionId) as NoteRow[]).map(toNote);
  }

  addNote(sessionId: SessionId, text: string): SessionNote {
    if (!this.sessionExists.get(sessionId)) throw new KgError('not_found', `session ${sessionId}`);
    if (text.trim() === '') throw new KgError('invalid_input', 'empty note');
    const ts = this.clock.now();
    const info = guardBusy(() => this.insertNote.run(sessionId, ts, text));
    return { noteId: Number(info.lastInsertRowid), sessionId, ts, text };
  }

  private readEvent(id: string): EventEnvelope {
    const row = this.eventById.get(id) as EventRow | undefined;
    if (!row) throw new KgError('internal', `event ${id} vanished after insert`);
    return toEvent(row);
  }
}

/** True when db_meta exists and holds this build's schema version. Reads only, so opening needs no write lock. */
function schemaCurrent(db: Database.Database): boolean {
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'db_meta'").get()) return false;
  const row = db.prepare("SELECT value FROM db_meta WHERE key = 'schema_version'").get() as { value: string } | undefined;
  return row?.value === String(SCHEMA_VERSION);
}

/** Maps a lock timeout from another process to a KgError; everything else passes through. */
function guardBusy<T>(fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    const code = (e as { code?: unknown } | null)?.code;
    if (e instanceof Error && typeof code === 'string' && /^SQLITE_(BUSY|LOCKED)/.test(code)) {
      throw new KgError('upstream', `database is busy: ${e.message}`);
    }
    throw e;
  }
}

function toSession(r: SessionRow): SessionSummary {
  return {
    sessionId: r.session_id as SessionId,
    kind: r.kind as SessionKind,
    label: r.label,
    startedAt: r.started_at,
    lastEventAt: r.last_event_at ?? r.started_at,
    eventCount: r.event_count,
  };
}

function toEvent(r: EventRow): EventEnvelope {
  return {
    id: r.event_id as EventId,
    sessionId: r.session_id as SessionId,
    seq: r.seq,
    ts: r.ts,
    type: r.type,
    schemaVersion: 1,
    buildId: r.build_id as BuildId | null,
    searchId: r.search_id as SearchId | null,
    parentId: r.parent_id as EventId | null,
    payload: JSON.parse(r.payload) as Json,
  } as unknown as EventEnvelope;
}

function toNote(r: NoteRow): SessionNote {
  return { noteId: r.note_id, sessionId: r.session_id as SessionId, ts: r.ts, text: r.text };
}

function checkedCount(n: number, name: string): number {
  if (!Number.isInteger(n) || n < 0) throw new KgError('invalid_input', `${name} must be a non-negative integer`);
  return n;
}
