import { describe, expect, it } from 'vitest';
import { createKgApi, KgError, type ItemId, type KgApi } from '@kg/core';
import {
  FixedClock,
  InMemoryCorpusStore,
  InMemoryEventLog,
  ScriptedSearchService,
  SeqIds,
  loadMiniCorpus,
  scriptedMiniApi,
} from '@kg/testkit';
import { expectKgError } from '@kg/testkit/conformance';
import { createApiHandlers } from '../src/index';

async function setup(withBuild: boolean) {
  const mc = await loadMiniCorpus();
  const store = withBuild ? mc.store : new InMemoryCorpusStore();
  if (withBuild) store.setCurrentBuild(mc.builds.v1);
  const clock = new FixedClock();
  const ids = new SeqIds();
  const log = new InMemoryEventLog(clock, ids);
  const script = scriptedMiniApi();
  const search = new ScriptedSearchService(script.searches, () => mc.builds.v1);
  const ingest = { ingest: async () => { throw new KgError('not_implemented', 'no ingest'); } };
  const api: KgApi = createKgApi({ log, clock, ids, currentBuild: () => store.currentBuild() }, createApiHandlers({ store, log, search, ingest }));
  return { mc, store, log, api, query: Object.keys(script.searches)[0]! };
}

describe('without a current build', () => {
  it('getItems and snapshotBuild fail with precondition', async () => {
    const h = await setup(false);
    const { sessionId } = await h.api.openSession({ kind: 'test' });
    await expectKgError(() => h.api.getItems(sessionId, { itemIds: [h.mc.labels['gas/pre']! as ItemId] }), 'precondition');
    await expectKgError(() => h.api.snapshotBuild(sessionId, { name: 'x' }), 'precondition');
  });
});

describe('snapshotBuild', () => {
  it('stores the label on the current build', async () => {
    const h = await setup(true);
    const { sessionId } = await h.api.openSession({ kind: 'test' });
    expect(h.store.getLabel('baseline')).toBeNull();
    const out = await h.api.snapshotBuild(sessionId, { name: 'baseline' });
    expect(out.buildId).toBe(h.mc.builds.v1);
    expect(h.store.getLabel('baseline')).toMatchObject({ name: 'baseline', buildId: h.mc.builds.v1 });
  });
});

describe('usage and feedback name only items the search returned', () => {
  it('reportUsage and feedback reject an item outside the result, accept one inside', async () => {
    const h = await setup(true);
    const { sessionId } = await h.api.openSession({ kind: 'test' });
    const resp = await h.api.search(sessionId, { query: h.query, k: 5 });
    const outside = h.mc.labels['gas/1-ab']! as ItemId;
    expect(resp.items.map((i) => i.itemId)).not.toContain(outside);
    await expectKgError(() => h.api.reportUsage(sessionId, { searchId: resp.searchId, itemIds: [resp.items[0]!.itemId, outside], account: 'x' }), 'invalid_input');
    await expectKgError(() => h.api.feedback(sessionId, { searchId: resp.searchId, items: [{ itemId: outside, relevance: 1 }] }), 'invalid_input');
    expect(h.log.events(sessionId).filter((e) => e.type === 'usage' || e.type === 'feedback')).toEqual([]);
    await h.api.reportUsage(sessionId, { searchId: resp.searchId, itemIds: [resp.items[0]!.itemId], account: 'x' });
    expect(h.log.events(sessionId).filter((e) => e.type === 'usage').length).toBe(1);
  });
});
