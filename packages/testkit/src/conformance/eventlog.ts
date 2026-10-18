/** eventLogConformance: EventLog + LogReader contract. `make` returns a fresh log each call. */
import { expect } from 'vitest';
import { ID_PATTERNS, recipeId, DEFAULT_SEARCH_RECIPE, type BuildId, type EventDraft, type EventLog, type LogReader, type SearchId, type SessionId } from '@kg/core';
import { expectKgError, type Suite } from './harness';

const B = 'bd_aaaaaaaaaaaaaaaaaaaa' as BuildId;
const SR = 'sr_00000000000000000000000001' as SearchId;
const called = (s: SessionId, tool = 'search'): EventDraft => ({ sessionId: s, type: 'tool.called', buildId: null, searchId: null, parentId: null, payload: { tool, input: { q: 1 } } });
const query = (s: SessionId, searchId: SearchId | null = SR, buildId: BuildId | null = B): EventDraft =>
  ({ sessionId: s, type: 'query', buildId, searchId, parentId: null, payload: { query: 'entropy', k: 5, searchRecipeId: recipeId(DEFAULT_SEARCH_RECIPE) } }) as EventDraft;

export function eventLogConformance(make: () => EventLog & LogReader): Suite {
  return {
    name: 'eventLogConformance',
    cases: [
      {
        name: 'openSession writes session.started as seq 1 with no build',
        run() {
          const l = make();
          const s = l.openSession({ kind: 'agent', label: 'claude', meta: { client: 'test' } });
          expect(s).toMatch(ID_PATTERNS.session);
          const evs = l.events(s);
          expect(evs.length).toBe(1);
          expect(evs[0]).toMatchObject({ seq: 1, type: 'session.started', buildId: null, sessionId: s, schemaVersion: 1, payload: { kind: 'agent', label: 'claude', meta: { client: 'test' } } });
          expect(l.getSession(s)).toMatchObject({ sessionId: s, kind: 'agent', label: 'claude', eventCount: 1 });
        },
      },
      {
        name: 'append assigns id, ts and contiguous per-session seq, and stores exactly what it returns',
        run() {
          const l = make();
          const a = l.openSession({ kind: 'agent', label: null, meta: {} });
          const b = l.openSession({ kind: 'eval', label: null, meta: {} });
          const e1 = l.append(called(a));
          l.append(called(b));
          const e2 = l.append(called(a));
          const e3 = l.append(called(a));
          expect([e1.seq, e2.seq, e3.seq]).toEqual([2, 3, 4]);
          expect(l.events(b).map((e) => e.seq)).toEqual([1, 2]);
          expect(e1.id).toMatch(ID_PATTERNS.event);
          expect(e1.ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/);
          expect(l.events(a)[1]).toEqual(e1);
          expect(new Set(l.events(a).map((e) => e.id)).size).toBe(4);
        },
      },
      {
        name: 'payloads are validated against the catalog (invalid_event)',
        async run() {
          const l = make();
          const s = l.openSession({ kind: 'test', label: null, meta: {} });
          await expectKgError(() => l.append({ ...called(s), payload: { tool: 'search' } } as unknown as EventDraft), 'invalid_event');
          await expectKgError(() => l.append({ ...called(s), payload: { tool: 'search', input: 1, extra: true } } as unknown as EventDraft), 'invalid_event');
          await expectKgError(() => l.append({ ...called(s), type: 'no.such.type' } as unknown as EventDraft), 'invalid_event');
          await expectKgError(() => l.append({ ...called(s), type: 'session.started', payload: { kind: 'test', label: null, meta: {} } } as unknown as EventDraft), 'invalid_event');
          expect(l.events(s).length).toBe(1);
        },
      },
      {
        name: 'Rule 6 and search linkage are enforced on the envelope',
        async run() {
          const l = make();
          const s = l.openSession({ kind: 'test', label: null, meta: {} });
          await expectKgError(() => l.append(query(s, SR, null)), 'invalid_event');
          await expectKgError(() => l.append(query(s, null, B)), 'invalid_event');
          await expectKgError(
            () => l.append({ sessionId: s, type: 'build.created', buildId: B, searchId: null, parentId: null, payload: { buildId: 'bd_bbbbbbbbbbbbbbbbbbbb' as BuildId, parentId: null, mixedRecipes: false, itemCount: 1 } }),
            'invalid_event',
          );
          expect(l.append(query(s)).buildId).toBe(B);
        },
      },
      {
        name: 'append to an unknown session is not_found',
        async run() {
          await expectKgError(() => make().append(called('se_00000000000000000000000099' as SessionId)), 'not_found');
        },
      },
      {
        name: 'events pages with afterSeq and limit',
        run() {
          const l = make();
          const s = l.openSession({ kind: 'test', label: null, meta: {} });
          for (let i = 0; i < 5; i++) l.append(called(s));
          expect(l.events(s, 2).map((e) => e.seq)).toEqual([3, 4, 5, 6]);
          expect(l.events(s, 2, 2).map((e) => e.seq)).toEqual([3, 4]);
          expect(l.events(s, 6)).toEqual([]);
        },
      },
      {
        name: 'eventsBySearch returns every event of a search in order',
        run() {
          const l = make();
          const s = l.openSession({ kind: 'test', label: null, meta: {} });
          l.append(called(s));
          l.append(query(s));
          l.append(query(s, 'sr_00000000000000000000000002' as SearchId));
          l.append({ sessionId: s, type: 'search.result', buildId: B, searchId: SR, parentId: null, payload: { items: [], stale: false } });
          expect(l.eventsBySearch(SR).map((e) => e.type)).toEqual(['query', 'search.result']);
        },
      },
      {
        name: 'notes live apart from events and need an existing session',
        async run() {
          const l = make();
          const s = l.openSession({ kind: 'agent', label: null, meta: {} });
          const n = l.addNote(s, 'query 2 looked off');
          expect(l.notes(s)).toEqual([n]);
          expect(n).toMatchObject({ sessionId: s, text: 'query 2 looked off' });
          expect(l.events(s).length).toBe(1);
          await expectKgError(() => l.addNote('se_00000000000000000000000099' as SessionId, 'x'), 'not_found');
        },
      },
      {
        name: 'sessions: newest first, filter by kind, limit',
        run() {
          const l = make();
          const a = l.openSession({ kind: 'agent', label: 'a', meta: {} });
          const b = l.openSession({ kind: 'eval', label: 'b', meta: {} });
          const c = l.openSession({ kind: 'agent', label: 'c', meta: {} });
          expect(l.sessions().map((x) => x.sessionId)).toEqual([c, b, a]);
          expect(l.sessions({ kind: 'agent' }).map((x) => x.sessionId)).toEqual([c, a]);
          expect(l.sessions({ limit: 1 }).map((x) => x.sessionId)).toEqual([c]);
        },
      },
      {
        name: 'returned envelopes are copies',
        run() {
          const l = make();
          const s = l.openSession({ kind: 'test', label: null, meta: {} });
          const e = l.append(called(s));
          (e.payload as { tool: string }).tool = 'mutated';
          expect((l.events(s)[1]!.payload as { tool: string }).tool).toBe('search');
        },
      },
    ],
  };
}
