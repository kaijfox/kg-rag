/** searchFixture: runs fixtures/search/queries.json against a SearchService built over loadMiniCorpus(). */
import { expect } from 'vitest';
import { TOOLS, renderQuery, runTool, type SearchService } from '@kg/core';
import { InMemoryEventLog } from '../fakes/eventlog';
import { FixedClock, SeqIds } from '../fakes/infra';
import { HASH_SPACE, searchQueries } from '../fixtures';
import { loadMiniCorpus, type MiniCorpus } from '../minicorpus';
import type { Suite } from './harness';

export function searchFixtureSuite(makeService: (mc: MiniCorpus) => SearchService): Suite {
  return {
    name: 'searchFixture (fixtures/search/queries.json)',
    cases: searchQueries().map((q) => ({
      name: `${q.id}: "${q.query}" k=${q.k} on ${q.build}`,
      async run() {
        const mc = await loadMiniCorpus();
        const service = makeService(mc);
        const clock = new FixedClock();
        const ids = new SeqIds();
        const log = new InMemoryEventLog(clock, ids);
        const s = log.openSession({ kind: 'test', label: q.id, meta: {} });
        const rt = { log, clock, ids, currentBuild: () => mc.store.currentBuild() };
        const buildId = mc.builds[q.build];
        const resp = await runTool(rt, TOOLS.search, s, { query: q.query, k: q.k, buildId }, (ctx, i) => service.search(ctx, i));
        const got = resp.items.map((i) => mc.labelOf(i.itemId));
        expect(resp.items.length, 'result count').toBe(q.expectedCount);
        expect(got.slice(0, q.expectedTop.length), q.why).toEqual(q.expectedTop);
        for (const bad of q.mustNotAppear ?? []) expect(got).not.toContain(bad);
        expect(resp.buildId).toBe(buildId);
        // the query went through the space's query template (HASH_SPACE is not the identity)
        expect(mc.embedder.texts).toContain(renderQuery(HASH_SPACE, q.query));
        // the v1 build is stale once v2 is current; the v2 build is not
        expect(resp.stale).toBe(q.build === 'v1');
      },
    })),
  };
}

/**
 * knnFixture: the same queries.json expectations checked directly against CorpusStore.knn (no search runner), so
 * the `store` package can run the mini-corpus fixture on SQLite. `makeStore` returns a fresh, empty store.
 */
export function knnFixtureSuite(makeStore: () => import('@kg/core').CorpusStore): Suite {
  return {
    name: 'knnFixture (fixtures/search/queries.json against CorpusStore.knn)',
    cases: searchQueries().map((q) => ({
      name: `${q.id}: "${q.query}" k=${q.k} on ${q.build}`,
      async run() {
        const mc = await loadMiniCorpus(makeStore());
        const buildId = mc.builds[q.build];
        const space = mc.store.getBuild(buildId)!.manifest.embeddingSpaces[0]!;
        const [vector] = await mc.embedder.embed([renderQuery(HASH_SPACE, q.query)]);
        const hits = mc.store.knn({ space, vector: vector!, buildId, kinds: ['chunk'], limit: q.k });
        const got = hits.map((h) => mc.labelOf(h.itemId));
        expect(hits.length).toBe(q.expectedCount);
        expect(got.slice(0, q.expectedTop.length), q.why).toEqual(q.expectedTop);
        for (const bad of q.mustNotAppear ?? []) expect(got).not.toContain(bad);
      },
    })),
  };
}
