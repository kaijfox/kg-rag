/**
 * kgApiConformance: the logging contract (core/runTool.ts) observed through a KgApi and a LogReader.
 * Runs against FakeKgApi here and against the real `api` package in Phase 2.
 */
import { expect } from 'vitest';
import { BUILD_REQUIRED, TOOLS, type BuildId, type EventEnvelope, type ItemId, type KgApi, type LogReader, type SearchId, type SessionId } from '@kg/core';
import { expectKgError, type Suite } from './harness';

export interface KgApiHarness {
  api: KgApi;
  reader: LogReader;
  /** a query that returns at least two results */
  query: string;
  /** optional: switch the current build to a different one (to test Rule 6 propagation) */
  advanceBuild?: () => Promise<BuildId>;
  /** optional: an item that exists but is not a member of buildId (getItems membership, R-26) */
  nonMember?: { itemId: ItemId; buildId: BuildId };
}

const after = (evs: EventEnvelope[], seq: number) => evs.filter((e) => e.seq > seq);

async function withSearch(h: KgApiHarness) {
  const { sessionId } = await h.api.openSession({ kind: 'test', label: 'conformance' });
  const resp = await h.api.search(sessionId, { query: h.query, k: 5 });
  return { sessionId, resp, mark: h.reader.events(sessionId).at(-1)!.seq };
}

function checkToolEnvelope(evs: EventEnvelope[], tool: string, outcome: 'tool.returned' | 'tool.failed') {
  expect(evs[0]!.type).toBe('tool.called');
  expect((evs[0]!.payload as { tool: string }).tool).toBe(tool);
  expect(evs.at(-1)!.type).toBe(outcome);
  for (const e of evs.slice(1)) expect(e.parentId, `${e.type} parent`).toBe(evs[0]!.id);
  evs.forEach((e, i) => i > 0 && expect(e.seq).toBe(evs[i - 1]!.seq + 1));
}

export function kgApiConformance(make: () => KgApiHarness | Promise<KgApiHarness>): Suite {
  return {
    name: 'kgApiConformance',
    cases: [
      {
        name: 'openSession writes session.started (seq 1)',
        async run() {
          const h = await make();
          const { sessionId } = await h.api.openSession({ kind: 'agent', label: 'x' });
          expect(h.reader.events(sessionId).map((e) => [e.seq, e.type])).toEqual([[1, 'session.started']]);
        },
      },
      {
        name: 'search: tool.called -> query -> pipeline.started -> search.step+ -> pipeline.finished -> search.result -> tool.returned, contiguous, parented',
        async run() {
          const h = await make();
          const { sessionId, resp } = await withSearch(h);
          const evs = h.reader.events(sessionId, 1);
          checkToolEnvelope(evs, 'search', 'tool.returned');
          expect(evs.slice(1, -1).map((e) => e.type)).toEqual(['query', 'pipeline.started', ...evs.slice(3, -3).map(() => 'search.step'), 'pipeline.finished', 'search.result']);
          for (const e of evs.slice(1, -1)) {
            expect(e.searchId).toBe(resp.searchId);
            expect(e.buildId).toBe(resp.buildId);
          }
          expect((evs.at(-1)!.payload as { summary: unknown }).summary).toEqual(TOOLS.search.summarize(resp));
          expect(h.reader.eventsBySearch(resp.searchId).length).toBe(evs.length - 2);
        },
      },
      {
        name: 'feedback: one event with the structured relevance, keyed to the search and its build (Rule 6)',
        async run() {
          const h = await make();
          const { sessionId, resp, mark } = await withSearch(h);
          const item = resp.items[0]!.itemId;
          const out = await h.api.feedback(sessionId, { searchId: resp.searchId, overall: 1, items: [{ itemId: item, relevance: 2 }], note: 'first hit was on point' });
          const evs = after(h.reader.events(sessionId), mark);
          checkToolEnvelope(evs, 'feedback', 'tool.returned');
          const fb = evs.find((e) => e.type === 'feedback')!;
          expect(fb.id).toBe(out.eventId);
          expect(fb.searchId).toBe(resp.searchId);
          expect(fb.buildId).toBe(resp.buildId);
          expect(fb.payload).toEqual({ overall: 1, items: [{ itemId: item, relevance: 2 }], note: 'first hit was on point' });
        },
      },
      {
        name: 'feedback after the current build changed still records the build of the search',
        async run() {
          const h = await make();
          if (!h.advanceBuild) return;
          const { sessionId, resp, mark } = await withSearch(h);
          const newBuild = await h.advanceBuild();
          expect(newBuild).not.toBe(resp.buildId);
          await h.api.feedback(sessionId, { searchId: resp.searchId, overall: 0 });
          const fb = after(h.reader.events(sessionId), mark).find((e) => e.type === 'feedback')!;
          expect(fb.buildId).toBe(resp.buildId);
        },
      },
      {
        name: 'after the build changed, usage, outcome and items.fetched keep the right builds (Rule 6)',
        async run() {
          const h = await make();
          if (!h.advanceBuild) return;
          const { sessionId, resp, mark } = await withSearch(h);
          const newBuild = await h.advanceBuild();
          await h.api.reportUsage(sessionId, { searchId: resp.searchId, itemIds: [resp.items[0]!.itemId], account: 'x' });
          await h.api.reportOutcome(sessionId, { searchId: resp.searchId, success: false, note: 'y' });
          await h.api.reportOutcome(sessionId, { success: null, note: 'no search' });
          await h.api.getItems(sessionId, { itemIds: [resp.items[1]!.itemId] });
          const evs = after(h.reader.events(sessionId), mark);
          expect(evs.find((e) => e.type === 'usage')!.buildId).toBe(resp.buildId);
          const outcomes = evs.filter((e) => e.type === 'outcome');
          expect(outcomes.map((e) => e.buildId)).toEqual([resp.buildId, newBuild]);
          expect(evs.find((e) => e.type === 'items.fetched')!.buildId).toBe(newBuild);
          for (const e of evs.filter((x) => x.type === 'tool.called' || x.type === 'tool.returned')) expect(e.buildId).toBe(newBuild);
        },
      },
      {
        name: 'search on an explicit, non-current build tags query, every step and the result with that build',
        async run() {
          const h = await make();
          if (!h.advanceBuild) return;
          const { sessionId } = await h.api.openSession({ kind: 'test' });
          const first = await h.api.search(sessionId, { query: h.query, k: 3 });
          await h.advanceBuild();
          const pinned = await h.api.search(sessionId, { query: h.query, k: 3, buildId: first.buildId });
          expect(pinned.buildId).toBe(first.buildId);
          const evs = h.reader.eventsBySearch(pinned.searchId);
          expect(evs.length).toBeGreaterThan(2);
          for (const e of evs) expect(e.buildId, e.type).toBe(first.buildId);
        },
      },
      {
        name: 'getItems returns members of the requested build only; an unknown build is not_found',
        async run() {
          const h = await make();
          const { sessionId, resp } = await withSearch(h);
          await expectKgError(() => h.api.getItems(sessionId, { itemIds: [resp.items[0]!.itemId], buildId: 'bd_zzzzzzzzzzzzzzzzzzzz' as BuildId }), 'not_found');
          if (!h.nonMember) return;
          const out = await h.api.getItems(sessionId, { itemIds: [h.nonMember.itemId], buildId: h.nonMember.buildId });
          expect(out.items).toEqual([]);
          const ev = h.reader.events(sessionId).filter((e) => e.type === 'items.fetched').at(-1)!;
          expect(ev.buildId).toBe(h.nonMember.buildId);
          expect(ev.payload).toEqual({ itemIds: [h.nonMember.itemId] });
        },
      },
      {
        name: 'feedback on an unknown search fails with not_found and is logged as tool.failed',
        async run() {
          const h = await make();
          const { sessionId } = await h.api.openSession({ kind: 'test' });
          await expectKgError(() => h.api.feedback(sessionId, { searchId: 'sr_0000000000000000000000ZZZZ' as SearchId, overall: 2 }), 'not_found');
          const evs = h.reader.events(sessionId, 1);
          checkToolEnvelope(evs, 'feedback', 'tool.failed');
          expect(evs.length).toBe(2);
          expect((evs[1]!.payload as { error: { code: string } }).error.code).toBe('not_found');
        },
      },
      {
        name: 'feedback naming an item the search did not return is rejected (invalid_input)',
        async run() {
          const h = await make();
          const { sessionId, resp } = await withSearch(h);
          const notReturned = resp.items[0]!.itemId.replace(/.$/, (c) => (c === 'a' ? 'b' : 'a'));
          await expectKgError(() => h.api.feedback(sessionId, { searchId: resp.searchId, items: [{ itemId: notReturned as never, relevance: 2 }] }), 'invalid_input');
          expect(h.reader.events(sessionId).at(-1)!.type).toBe('tool.failed');
        },
      },
      {
        name: 'invalid input is logged (tool.called with the raw input, then tool.failed invalid_input)',
        async run() {
          const h = await make();
          const { sessionId } = await h.api.openSession({ kind: 'test' });
          await expectKgError(() => h.api.search(sessionId, { query: 'x', k: 0 }), 'invalid_input');
          const evs = h.reader.events(sessionId, 1);
          expect(evs.map((e) => e.type)).toEqual(['tool.called', 'tool.failed']);
          expect((evs[0]!.payload as { input: unknown }).input).toEqual({ query: 'x', k: 0 });
        },
      },
      {
        name: 'getItems logs items.fetched with a build',
        async run() {
          const h = await make();
          const { sessionId, resp, mark } = await withSearch(h);
          const ids = resp.items.slice(0, 2).map((i) => i.itemId);
          const out = await h.api.getItems(sessionId, { itemIds: ids });
          expect(out.items.map((i) => i.id)).toEqual(ids);
          const ev = after(h.reader.events(sessionId), mark).find((e) => e.type === 'items.fetched')!;
          expect(ev.payload).toEqual({ itemIds: ids });
          expect(ev.buildId).not.toBeNull();
        },
      },
      {
        name: 'reportUsage and reportOutcome log usage and outcome keyed to the search and its build',
        async run() {
          const h = await make();
          const { sessionId, resp, mark } = await withSearch(h);
          await h.api.reportUsage(sessionId, { searchId: resp.searchId, itemIds: [resp.items[0]!.itemId], account: 'quoted the definition' });
          await h.api.reportOutcome(sessionId, { searchId: resp.searchId, success: true, note: 'tests pass' });
          const evs = after(h.reader.events(sessionId), mark);
          const u = evs.find((e) => e.type === 'usage')!;
          const o = evs.find((e) => e.type === 'outcome')!;
          expect([u.searchId, u.buildId, o.searchId, o.buildId]).toEqual([resp.searchId, resp.buildId, resp.searchId, resp.buildId]);
        },
      },
      {
        name: 'addNote stores a note without any domain event',
        async run() {
          const h = await make();
          const { sessionId } = await h.api.openSession({ kind: 'agent' });
          const { noteId } = await h.api.addNote(sessionId, { text: 'watch search 2' });
          expect(h.reader.notes(sessionId).map((n) => [n.noteId, n.text])).toEqual([[noteId, 'watch search 2']]);
          expect(h.reader.events(sessionId, 1).map((e) => e.type)).toEqual(['tool.called', 'tool.returned']);
        },
      },
      {
        name: 'snapshotBuild labels the current build (build.labeled) and is repeatable',
        async run() {
          const h = await make();
          const { sessionId } = await h.api.openSession({ kind: 'cli' });
          const a = await h.api.snapshotBuild(sessionId, { name: 'baseline' });
          const b = await h.api.snapshotBuild(sessionId, { name: 'baseline' });
          expect(b.buildId).toBe(a.buildId);
          const labeled = h.reader.events(sessionId).filter((e) => e.type === 'build.labeled');
          expect(labeled.length).toBe(2);
          expect(labeled[0]!.buildId).toBe(a.buildId);
          expect(a.stale.buildId).toBe(a.buildId);
          // Rule 5: a stale snapshot is announced, a fresh one is not
          const staleEvs = h.reader.events(sessionId).filter((e) => e.type === 'build.stale');
          if (a.stale.stale) {
            expect(staleEvs.length).toBe(2);
            expect(staleEvs[0]!.payload).toEqual({ buildId: a.buildId, missingChunkIds: a.stale.missingChunkIds });
          } else expect(staleEvs).toEqual([]);
        },
      },
      {
        name: 'Rule 6 over a whole session: every build-dependent event has a build, every domain event a tool.called parent',
        async run() {
          const h = await make();
          const { sessionId, resp } = await withSearch(h);
          await h.api.feedback(sessionId, { searchId: resp.searchId, overall: 2 });
          await h.api.getItems(sessionId, { itemIds: [resp.items[0]!.itemId] });
          const evs = h.reader.events(sessionId) as EventEnvelope[];
          for (const e of evs) {
            if (BUILD_REQUIRED.has(e.type)) expect(e.buildId, e.type).not.toBeNull();
            if (e.type !== 'session.started' && e.type !== 'tool.called') {
              const parent = evs.find((p) => p.id === e.parentId);
              expect(parent?.type, `${e.type} parent`).toBe('tool.called');
            }
          }
          expect(evs.map((e) => e.seq)).toEqual(evs.map((_, i) => i + 1));
        },
      },
    ],
  };
}

export type { SessionId };
