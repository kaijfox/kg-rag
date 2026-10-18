/**
 * Event log ports. Synchronous. The events table is append-only; EventLog.append is called only from
 * core's runTool (and EventLog.openSession writes session.started itself).
 */
import type { SearchId, SessionId } from '../ids';
import type { Json, SessionKind, SessionNote, SessionSummary } from '../model';
import type { EventDraft, EventEnvelope } from '../events';

export interface EventLog {
  /** Creates the session and appends its session.started event (seq 1, buildId null). */
  openSession(s: { kind: SessionKind; label: string | null; meta: { [k: string]: Json } }): SessionId;
  /**
   * Validates the draft with validateEventDraft (invalid_event on failure; session.started is rejected),
   * requires the session to exist (not_found), assigns id (IdGen 'ev_'), seq (previous + 1 in the session)
   * and ts (Clock), stores and returns the envelope.
   */
  append(e: EventDraft): EventEnvelope;
}

export interface SessionFilter {
  kind?: SessionKind;
  /** startedAt >= since */
  since?: string;
  /** default 100 */
  limit?: number;
}

export interface LogReader {
  /** most recently started first (startedAt descending, then sessionId descending) */
  sessions(f?: SessionFilter): SessionSummary[];
  getSession(sessionId: SessionId): SessionSummary | null;
  /** events with seq > afterSeq (default 0) in seq order, at most limit (default 1000) */
  events(sessionId: SessionId, afterSeq?: number, limit?: number): EventEnvelope[];
  /** every event whose envelope searchId equals searchId, in seq order */
  eventsBySearch(searchId: SearchId): EventEnvelope[];
  notes(sessionId: SessionId): SessionNote[];
  /** The viewer's only write; separate table, appends no event. not_found on unknown session. */
  addNote(sessionId: SessionId, text: string): SessionNote;
}
