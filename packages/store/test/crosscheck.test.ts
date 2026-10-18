/**
 * Cross-check: the SQLite store and the in-memory fake from testkit, given the same operations, must agree on every
 * returned value and every error code. Scores may differ in the low digits (SQLite stores float32, the fake computes
 * float64), so scores are compared within 1e-5 and ids may differ only inside a group of near-equal scores.
 * Timestamps are not compared: the shared clock advances per call and the two stores call it at different points.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_CHUNK_RECIPE, asDocKey, docVersionId, recipeId, renderQuery, type ChunkId, type CorpusStore, type DerivationRun, type ItemId, type KnnQuery, type Mapping, type RunId, type SpaceId } from '@kg/core';
import { FixedClock, HASH_SPACE, InMemoryCorpusStore, loadMiniCorpus, searchQueries } from '@kg/testkit';
import { artifactFor, draftsFor } from '@kg/testkit/conformance';
import { openDatabase, SqliteCorpusStore } from '../src/index';
import { codeOf, populate } from './helpers';

const sqliteStore = () => new SqliteCorpusStore(openDatabase(':memory:'), new FixedClock());
const stripTime = <T extends { createdAt?: string }>(x: T | null): Omit<T, 'createdAt'> | null => {
  if (x === null) return null;
  const { createdAt: _drop, ...rest } = x;
  return rest;
};

type Hit = { itemId: ItemId; score: number };
function sameRanking(a: Hit[], b: Hit[]): void {
  expect(a.length).toBe(b.length);
  const near = (xs: Hit[], i: number) =>
    (i > 0 && xs[i - 1]!.score - xs[i]!.score < 1e-5) || (i + 1 < xs.length && xs[i]!.score - xs[i + 1]!.score < 1e-5);
  for (let i = 0; i < a.length; i++) {
    expect(Math.abs(a[i]!.score - b[i]!.score)).toBeLessThan(1e-5);
    if (a[i]!.itemId !== b[i]!.itemId) {
      expect(near(a, i) || near(b, i), `ids differ at ${i} outside a near-tie group`).toBe(true);
    }
  }
}

describe('mini-corpus on SQLite and on the fake', () => {
  it('builds, items, documents, staleness and spaces agree', async () => {
    const sq = await loadMiniCorpus(sqliteStore());
    const fk = await loadMiniCorpus(new InMemoryCorpusStore(new FixedClock()));
    expect(sq.builds).toEqual(fk.builds);
    for (const b of [sq.builds.v1, sq.builds.v2]) {
      expect(stripTime(sq.store.getBuild(b))).toEqual(stripTime(fk.store.getBuild(b)));
      expect(sq.store.staleCheck(b)).toEqual(fk.store.staleCheck(b));
    }
    expect(sq.store.currentBuild()).toBe(fk.store.currentBuild());
    expect(sq.store.currentDocVersions().map((v) => v.id)).toEqual(fk.store.currentDocVersions().map((v) => v.id));
    const ids = Object.values(sq.labels);
    expect(sq.store.getItems(ids)).toEqual(fk.store.getItems(ids));
    expect(sq.store.itemsBySourceChunk(ids)).toEqual(fk.store.itemsBySourceChunk(ids));
    const space = sq.store.getBuild(sq.builds.v2)!.manifest.embeddingSpaces[0]!;
    expect(sq.store.getSpace(space)).toEqual(fk.store.getSpace(space));
    expect(sq.store.missingEmbeddings(space, ids)).toEqual(fk.store.missingEmbeddings(space, ids));
  });

  it('knn on each fixture query gives the fake ranking', async () => {
    const sq = await loadMiniCorpus(sqliteStore());
    const fk = await loadMiniCorpus(new InMemoryCorpusStore(new FixedClock()));
    for (const q of searchQueries()) {
      const buildId = sq.builds[q.build];
      const space = sq.store.getBuild(buildId)!.manifest.embeddingSpaces[0]!;
      const [vector] = await fk.embedder.embed([renderQuery(HASH_SPACE, q.query)]);
      const query: KnnQuery = { space, vector: vector!, buildId, kinds: ['chunk'], limit: q.k };
      sameRanking(sq.store.knn(query), fk.store.knn(query));
    }
  });
});

describe('random embeddings on SQLite and on the fake', () => {
  it('knn agrees on random queries, kind filters and a zero-norm item and query', () => {
    const sq = sqliteStore();
    const fk = new InMemoryCorpusStore(new FixedClock());
    const a = populate(sq, 300, 8, 11, { zeroFirst: true });
    const b = populate(fk, 300, 8, 11, { zeroFirst: true });
    expect(a.chunkIds).toEqual(b.chunkIds);
    for (let i = 0; i < 40; i++) {
      const vector = a.vecs[(i * 7) % a.vecs.length]!.map((x, j) => x + (j === i % 8 ? 0.25 : 0)) as Float32Array;
      const q = { space: a.space, vector, buildId: a.id, kinds: ['chunk' as const], limit: 10 };
      sameRanking(sq.knn(q), fk.knn(q));
    }
    const zero = new Float32Array(8);
    const zq = { space: a.space, vector: zero, buildId: a.id, kinds: ['chunk' as const], limit: 5 };
    expect(sq.knn(zq)).toEqual(fk.knn(zq));
    expect(sq.knn(zq).every((h) => h.score === 0)).toBe(true);
  });
});

/** Each case runs the same operation on both stores and returns the code it raised. */
const errorCases: { name: string; run: (s: CorpusStore) => string }[] = [
  { name: 'putItems with a chunk', run: (s) => { const p = populate(s, 2, 4, 1); return codeOf(() => s.putItems([s.getItems([p.chunkIds[0]!])[0]!])); } },
  { name: 'setCurrentBuild unknown', run: (s) => codeOf(() => s.setCurrentBuild('bd_zzzzzzzzzzzzzzzzzzzz' as never)) },
  { name: 'labelBuild unknown build', run: (s) => codeOf(() => s.labelBuild('x', 'bd_zzzzzzzzzzzzzzzzzzzz' as never)) },
  {
    name: 'labelBuild same name, other build',
    run: (s) => {
      const p = populate(s, 2, 4, 1);
      const other = s.putBuild({ parentId: null, manifest: { ...p.b.manifest, mixedRecipes: true }, itemIds: p.b.itemIds });
      s.labelBuild('base', p.id);
      return codeOf(() => s.labelBuild('base', other));
    },
  },
  { name: 'labelBuild empty name', run: (s) => { const p = populate(s, 2, 4, 1); return codeOf(() => s.labelBuild('', p.id)); } },
  { name: 'putEmbeddings wrong dims', run: (s) => { const p = populate(s, 2, 4, 1); return codeOf(() => s.putEmbeddings(p.space, [{ itemId: p.chunkIds[0]!, vector: new Float32Array(3) }])); } },
  { name: 'putEmbeddings unknown space', run: (s) => { const p = populate(s, 2, 4, 1); return codeOf(() => s.putEmbeddings('es_zzzzzzzzzzzzzzzzzzzz' as SpaceId, [{ itemId: p.chunkIds[0]!, vector: new Float32Array(4) }])); } },
  { name: 'putEmbeddings unknown item', run: (s) => { const p = populate(s, 2, 4, 1); return codeOf(() => s.putEmbeddings(p.space, [{ itemId: 'ch_zzzzzzzzzzzzzzzzzzzz' as ChunkId, vector: new Float32Array(4) }])); } },
  { name: 'knn unknown build', run: (s) => { const p = populate(s, 2, 4, 1); return codeOf(() => s.knn({ space: p.space, vector: new Float32Array(4), buildId: 'bd_zzzzzzzzzzzzzzzzzzzz' as never, kinds: ['chunk'], limit: 1 })); } },
  { name: 'knn wrong dims', run: (s) => { const p = populate(s, 2, 4, 1); return codeOf(() => s.knn({ space: p.space, vector: new Float32Array(2), buildId: p.id, kinds: ['chunk'], limit: 1 })); } },
  { name: 'knn limit 0', run: (s) => { const p = populate(s, 2, 4, 1); return codeOf(() => s.knn({ space: p.space, vector: new Float32Array(4), buildId: p.id, kinds: ['chunk'], limit: 0 })); } },
  {
    name: 'putBuild unsorted items',
    run: (s) => { const p = populate(s, 3, 4, 1); return codeOf(() => s.putBuild({ parentId: null, manifest: p.b.manifest, itemIds: [...p.b.itemIds.slice(0, 2)].reverse() })); },
  },
  {
    name: 'putBuild with an item lacking an embedding',
    run: (s) => {
      const p = populate(s, 2, 4, 1);
      const extra = draftsFor(asDocKey('late'), [{ text: 'no vector for this one' }]);
      const aid = s.putArtifact(artifactFor('late'));
      const crid = s.putRecipe(DEFAULT_CHUNK_RECIPE);
      s.putDocVersion({ id: docVersionId(asDocKey('late'), aid, crid), docKey: asDocKey('late'), artifactId: aid, chunkRecipeId: crid, chunkIds: extra.map((d) => d.id) }, extra);
      const items = [...p.b.itemIds, extra[0]!.id].sort();
      return codeOf(() => s.putBuild({ parentId: null, manifest: p.b.manifest, itemIds: items }));
    },
  },
  { name: 'putBuild unknown parent', run: (s) => { const p = populate(s, 2, 4, 1); return codeOf(() => s.putBuild({ parentId: 'bd_zzzzzzzzzzzzzzzzzzzz' as never, manifest: { ...p.b.manifest, mixedRecipes: true }, itemIds: p.b.itemIds })); } },
  {
    name: 'putDocVersion with a changed chunk list',
    run: (s) => {
      const p = populate(s, 2, 4, 1, { doc: 'doc', tag: 'doc' });
      const changed = draftsFor(asDocKey('doc'), [{ text: 'changed text' }, { text: 'rand chunk number 1' }]);
      return codeOf(() => s.putDocVersion({ id: p.b.manifest.docVersions['doc'] as never, docKey: asDocKey('doc'), artifactId: p.artifactId, chunkRecipeId: p.chunkRecipeId, chunkIds: changed.map((d) => d.id) }, changed));
    },
  },
  {
    name: 'putDocVersion with a missing artifact',
    run: (s) => {
      const drafts = draftsFor(asDocKey('nope'), [{ text: 'x' }]);
      const aid = 'pa_zzzzzzzzzzzzzzzzzzzz' as never;
      return codeOf(() => s.putDocVersion({ id: docVersionId(asDocKey('nope'), aid, recipeId(DEFAULT_CHUNK_RECIPE)), docKey: asDocKey('nope'), artifactId: aid, chunkRecipeId: recipeId(DEFAULT_CHUNK_RECIPE), chunkIds: drafts.map((d) => d.id) }, drafts));
    },
  },
  {
    name: 'setCurrentDocVersion with the wrong doc key',
    run: (s) => {
      const p = populate(s, 2, 4, 1, { doc: 'one', tag: 'one' });
      return codeOf(() => s.setCurrentDocVersion(asDocKey('two'), docVersionId(asDocKey('one'), p.artifactId, p.chunkRecipeId)));
    },
  },
  {
    name: 'putMappings with a mapping naming another run',
    run: (s) => {
      const rid = s.putRecipe({ kind: 'equivalence', version: 'test', spec: {} });
      const run: DerivationRun = { id: 'dr_00000000000000000000000001' as RunId, recipeId: rid, inputStateHash: 'h', baseBuildId: null, createdAt: '2026-10-17T12:00:00.000Z' };
      const m: Mapping = { id: 'mp_aaaaaaaaaaaaaaaaaaaa' as never, kind: 'same-as', subject: 'item', fromId: 'ch_a' as never, toId: 'ch_b' as never, runId: 'dr_00000000000000000000000002' as RunId, confidence: null, note: null };
      return codeOf(() => s.putMappings(run, [m]));
    },
  },
];

describe('error codes agree between SQLite and the fake', () => {
  for (const c of errorCases) {
    it(c.name, () => {
      const sq = c.run(sqliteStore());
      expect(sq, 'the operation must raise an error, not succeed').not.toMatch(/^(none|other)/);
      expect(sq).toBe(c.run(new InMemoryCorpusStore(new FixedClock())));
    });
  }
});

