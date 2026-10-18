import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { recipeId, DEFAULT_SEARCH_RECIPE, type BuildId, type EventDraft, type SearchId, type SessionId } from '@kg/core';
import { FixedClock, SeqIds } from '@kg/testkit';
import { expectKgError } from '@kg/testkit/conformance';
import { SqliteEventLog } from '../src/index';

const B = 'bd_aaaaaaaaaaaaaaaaaaaa' as BuildId;
const called = (s: SessionId, parentId: EventDraft['parentId'] = null): EventDraft =>
  ({ sessionId: s, type: 'tool.called', buildId: null, searchId: null, parentId, payload: { tool: 'search', input: { q: 1 } } }) as EventDraft;
const query = (s: SessionId, searchId: SearchId): EventDraft =>
  ({ sessionId: s, type: 'query', buildId: B, searchId, parentId: null, payload: { query: 'entropy', k: 5, searchRecipeId: recipeId(DEFAULT_SEARCH_RECIPE) } }) as EventDraft;
const make = (stepMs = 1000) => new SqliteEventLog(new Database(':memory:'), new FixedClock(undefined, stepMs), new SeqIds());

describe('sessions', () => {
  it('sessions that start at the same instant list newest id first', () => {
    const l = make(0);
    const a = l.openSession({ kind: 'test', label: null, meta: {} });
    const b = l.openSession({ kind: 'test', label: null, meta: {} });
    const c = l.openSession({ kind: 'test', label: null, meta: {} });
    expect(l.sessions().map((x) => x.sessionId)).toEqual([c, b, a]);
  });

  it('since includes a session that started exactly then', () => {
    const l = make();
    const a = l.openSession({ kind: 'test', label: null, meta: {} });
    const b = l.openSession({ kind: 'test', label: null, meta: {} });
    const c = l.openSession({ kind: 'test', label: null, meta: {} });
    const startB = l.getSession(b)!.startedAt;
    expect(l.sessions({ since: startB }).map((x) => x.sessionId)).toEqual([c, b]);
    expect(l.sessions({ since: l.getSession(a)!.startedAt }).length).toBe(3);
  });

  it('lastEventAt is the timestamp of the newest event; eventCount counts them', () => {
    const l = make();
    const s = l.openSession({ kind: 'test', label: null, meta: {} });
    expect(l.getSession(s)!.lastEventAt).toBe(l.getSession(s)!.startedAt);
    l.append(called(s));
    const last = l.append(called(s));
    expect(l.getSession(s)).toMatchObject({ lastEventAt: last.ts, eventCount: 3 });
    expect(l.getSession(s)!.lastEventAt).not.toBe(l.getSession(s)!.startedAt);
    expect(l.sessions()[0]!.lastEventAt).toBe(last.ts);
  });

  it('a negative or fractional limit is invalid_input', async () => {
    const l = make();
    await expectKgError(() => l.sessions({ limit: -1 }), 'invalid_input');
    await expectKgError(() => l.sessions({ limit: 1.5 }), 'invalid_input');
  });
});

describe('events', () => {
  it('negative afterSeq or limit is invalid_input; a zero limit returns nothing', async () => {
    const l = make();
    const s = l.openSession({ kind: 'test', label: null, meta: {} });
    await expectKgError(() => l.events(s, -1), 'invalid_input');
    await expectKgError(() => l.events(s, 0, -1), 'invalid_input');
    expect(l.events(s, 0, 0)).toEqual([]);
  });

  it('parentId round-trips', () => {
    const l = make();
    const s = l.openSession({ kind: 'test', label: null, meta: {} });
    const parent = l.append(called(s));
    const child = l.append(called(s, parent.id));
    expect(child.parentId).toBe(parent.id);
    expect(l.events(s)[2]!.parentId).toBe(parent.id);
    expect(l.events(s)[1]!.parentId).toBeNull();
  });

  it('eventsBySearch orders by seq, then by session id', () => {
    const l = make();
    const a = l.openSession({ kind: 'test', label: null, meta: {} });
    const b = l.openSession({ kind: 'test', label: null, meta: {} });
    const sr = 'sr_00000000000000000000000001' as SearchId;
    l.append(called(a));
    const bq = l.append(query(b, sr));
    const aq = l.append(query(a, sr));
    const aq2 = l.append(query(a, sr));
    const bq2 = l.append(query(b, sr));
    // seq: b=2 (bq), a=3 (aq), a=4 (aq2), b=3 (bq2)
    expect(l.eventsBySearch(sr).map((e) => e.id)).toEqual([bq.id, aq.id, bq2.id, aq2.id]);
  });
});

describe('notes', () => {
  it('a blank note is invalid_input and is not stored', async () => {
    const l = make();
    const s = l.openSession({ kind: 'test', label: null, meta: {} });
    await expectKgError(() => l.addNote(s, '   \n'), 'invalid_input');
    await expectKgError(() => l.addNote(s, ''), 'invalid_input');
    expect(l.notes(s)).toEqual([]);
  });

  it('notes come back in the order they were added, per session', () => {
    const l = make();
    const s = l.openSession({ kind: 'test', label: null, meta: {} });
    const t = l.openSession({ kind: 'test', label: null, meta: {} });
    const n1 = l.addNote(s, 'zebra');
    const m1 = l.addNote(t, 'other');
    const n2 = l.addNote(s, 'apple');
    const n3 = l.addNote(s, 'mango');
    expect(l.notes(s)).toEqual([n1, n2, n3]);
    expect(l.notes(t)).toEqual([m1]);
  });
});
