/** InMemoryEventLog: EventLog + LogReader in memory (passes eventLogConformance). */
import {
  KgError,
  validateEventDraft,
  validateEventEnvelope,
  type Clock,
  type EventDraft,
  type EventEnvelope,
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
import { FixedClock, SeqIds } from './infra';

interface SessionRow {
  sessionId: SessionId;
  kind: SessionKind;
  label: string | null;
  meta: { [k: string]: Json };
  startedAt: string;
}

export class InMemoryEventLog implements EventLog, LogReader {
  protected sessionsById = new Map<SessionId, SessionRow>();
  protected eventsBySession = new Map<SessionId, EventEnvelope[]>();
  protected notesBySession = new Map<SessionId, SessionNote[]>();
  private noteSeq = 0;
  constructor(
    protected readonly clock: Clock = new FixedClock(),
    protected readonly ids: IdGen = new SeqIds(),
  ) {}

  openSession(s: { kind: SessionKind; label: string | null; meta: { [k: string]: Json } }): SessionId {
    const sessionId = this.ids.ulid('se_') as SessionId;
    const startedAt = this.clock.now();
    this.sessionsById.set(sessionId, { sessionId, kind: s.kind, label: s.label, meta: structuredClone(s.meta), startedAt });
    const ev = validateEventEnvelope({
      id: this.ids.ulid('ev_'),
      sessionId,
      seq: 1,
      ts: startedAt,
      type: 'session.started',
      schemaVersion: 1,
      buildId: null,
      searchId: null,
      parentId: null,
      payload: { kind: s.kind, label: s.label, meta: s.meta },
    });
    this.eventsBySession.set(sessionId, [ev]);
    this.notesBySession.set(sessionId, []);
    return sessionId;
  }

  append(e: EventDraft): EventEnvelope {
    const d = this.validate(e);
    const list = this.eventsBySession.get(d.sessionId);
    if (!list) throw new KgError('not_found', `session ${d.sessionId}`);
    const env = {
      ...structuredClone(d),
      id: this.ids.ulid('ev_'),
      seq: this.nextSeq(list),
      ts: this.clock.now(),
      schemaVersion: 1 as const,
    } as EventEnvelope;
    list.push(env);
    return structuredClone(env);
  }
  protected validate(e: EventDraft): EventDraft {
    return validateEventDraft(e);
  }
  protected nextSeq(list: EventEnvelope[]): number {
    return list.length + 1;
  }

  private summary(r: SessionRow): SessionSummary {
    const evs = this.eventsBySession.get(r.sessionId)!;
    return { sessionId: r.sessionId, kind: r.kind, label: r.label, startedAt: r.startedAt, lastEventAt: evs[evs.length - 1]!.ts, eventCount: evs.length };
  }
  sessions(f: SessionFilter = {}): SessionSummary[] {
    return [...this.sessionsById.values()]
      .filter((r) => (f.kind === undefined || r.kind === f.kind) && (f.since === undefined || r.startedAt >= f.since))
      .sort((a, b) => (a.startedAt !== b.startedAt ? (a.startedAt < b.startedAt ? 1 : -1) : a.sessionId < b.sessionId ? 1 : -1))
      .slice(0, f.limit ?? 100)
      .map((r) => this.summary(r));
  }
  getSession(sessionId: SessionId): SessionSummary | null {
    const r = this.sessionsById.get(sessionId);
    return r ? this.summary(r) : null;
  }
  events(sessionId: SessionId, afterSeq = 0, limit = 1000): EventEnvelope[] {
    return structuredClone((this.eventsBySession.get(sessionId) ?? []).filter((e) => e.seq > afterSeq).slice(0, limit));
  }
  eventsBySearch(searchId: SearchId): EventEnvelope[] {
    const out: EventEnvelope[] = [];
    for (const list of this.eventsBySession.values()) for (const e of list) if (e.searchId === searchId) out.push(e);
    return structuredClone(out.sort((a, b) => a.seq - b.seq));
  }
  notes(sessionId: SessionId): SessionNote[] {
    return structuredClone(this.notesBySession.get(sessionId) ?? []);
  }
  addNote(sessionId: SessionId, text: string): SessionNote {
    const list = this.notesBySession.get(sessionId);
    if (!list) throw new KgError('not_found', `session ${sessionId}`);
    if (text.trim() === '') throw new KgError('invalid_input', 'empty note');
    const n: SessionNote = { noteId: ++this.noteSeq, sessionId, ts: this.clock.now(), text };
    list.push(n);
    return structuredClone(n);
  }

  /** Test helper: load recorded envelopes (e.g. fixtures/log/*.jsonl) as if they had been appended. */
  static fromEnvelopes(envs: readonly EventEnvelope[], clock?: Clock, ids?: IdGen): InMemoryEventLog {
    const log = new InMemoryEventLog(clock, ids);
    for (const raw of envs) {
      const e = validateEventEnvelope(raw);
      let list = log.eventsBySession.get(e.sessionId);
      if (!list) {
        if (e.type !== 'session.started') throw new KgError('invalid_input', `recorded session ${e.sessionId} does not start with session.started`);
        const p = e.payload as { kind: SessionKind; label: string | null; meta: { [k: string]: Json } };
        log.sessionsById.set(e.sessionId, { sessionId: e.sessionId, kind: p.kind, label: p.label, meta: p.meta, startedAt: e.ts });
        log.eventsBySession.set(e.sessionId, (list = []));
        log.notesBySession.set(e.sessionId, []);
      }
      if (e.seq !== list.length + 1) throw new KgError('invalid_input', `recorded seq gap in ${e.sessionId} at ${e.seq}`);
      list.push(e);
    }
    return log;
  }
}
