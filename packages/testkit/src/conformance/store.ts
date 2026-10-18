/**
 * corpusStoreConformance: the CorpusStore contract (core/ports/store.ts), including Rules 1, 2, 4, 5 and
 * build scoping of KNN. `make` must return a fresh, empty store each call.
 */
import { expect } from 'vitest';
import {
  DEFAULT_CHUNK_RECIPE,
  DEFAULT_PARSE_RECIPE,
  DEFAULT_SEARCH_RECIPE,
  artifactId,
  asDocKey,
  assignChunkIds,
  buildId,
  composeBuild,
  docVersionId,
  nodeId,
  recipeId,
  sha256hex,
  spaceId,
  type AnyItem,
  type ChunkDraft,
  type ChunkId,
  type CorpusStore,
  type DerivedItemId,
  type DocKey,
  type DocVersion,
  type EmbeddingSpaceSpec,
  type ParseArtifact,
  type Relation,
  type RunId,
  type BuildId,
} from '@kg/core';
import { expectKgError, type Suite } from './harness';

const SPACE: EmbeddingSpaceSpec = { model: 'test-3d', dims: 3, documentTemplate: '{headings}: {text}', queryTemplate: '{query}' };
const v3 = (x: number, y: number, z: number) => {
  const n = Math.hypot(x, y, z);
  return Float32Array.from([x / n, y / n, z / n]);
};

export function artifactFor(tag: string): ParseArtifact {
  return {
    format: 'kg-parse-artifact/1',
    sourceSha256: sha256hex(tag),
    sourceName: `${tag}.pdf`,
    recipe: DEFAULT_PARSE_RECIPE,
    parser: { name: 'docling', version: '2.140.0' },
    producedAt: '2026-10-17T12:00:00Z',
    producedOn: 'conformance',
    stats: { pages: 1, chars: 0, charsPerPage: [], undecodedFormulas: 0, elapsedMs: 0 },
    document: { schema_name: 'DoclingDocument', body: { children: [] }, texts: [], groups: [], tables: [], pictures: [] },
  };
}
export function draftsFor(docKey: DocKey, specs: readonly { path?: string[]; text: string; page?: number }[]): ChunkDraft[] {
  return assignChunkIds(
    docKey,
    specs.map((s, i) => ({ text: s.text, sectionPath: s.path ?? ['1 Intro'], pages: [s.page ?? 1], blockRefs: [`#/texts/${i}`] })),
  ).map((d) => ({ id: d.id, text: d.text, sectionPath: d.sectionPath, occurrence: d.occurrence, pages: d.pages, blockRefs: d.blockRefs }));
}

/** Writes artifact + doc version (not current). */
function seed(s: CorpusStore, doc: string, tag: string, texts: readonly (string | { path?: string[]; text: string; page?: number })[]) {
  const docKey = asDocKey(doc);
  const aid = s.putArtifact(artifactFor(tag));
  const crid = s.putRecipe(DEFAULT_CHUNK_RECIPE);
  const drafts = draftsFor(docKey, texts.map((t) => (typeof t === 'string' ? { text: t } : t)));
  const v: Omit<DocVersion, 'createdAt'> = { id: docVersionId(docKey, aid, crid), docKey, artifactId: aid, chunkRecipeId: crid, chunkIds: drafts.map((d) => d.id) };
  const r = s.putDocVersion(v, drafts);
  return { docKey, aid, crid, drafts, v, r };
}
/** Composes and writes a build over the current doc versions, sets it current. */
function build(s: CorpusStore, parentId: BuildId | null = null, extraItems: AnyItem[] = []) {
  const sp = s.putSpace(SPACE);
  const srid = s.putRecipe(DEFAULT_SEARCH_RECIPE);
  const b = composeBuild({
    docVersions: s.currentDocVersions(),
    parseRecipeOf: (a) => recipeId(s.getArtifact(a)!.recipe),
    spaceIds: [sp],
    searchRecipeId: srid,
    parentId,
    derivedItemIds: extraItems.map((i) => i.id),
  });
  fillEmbeddings(s, sp, b.itemIds);
  const id = s.putBuild({ parentId: b.parentId, manifest: b.manifest, itemIds: b.itemIds });
  s.setCurrentBuild(id);
  return { id, sp, b };
}
/** S2: every build item needs a vector in each manifest space; items a case did not embed get a filler vector. */
function fillEmbeddings(s: CorpusStore, sp: import('@kg/core').SpaceId, itemIds: readonly import('@kg/core').ItemId[]) {
  const missing = s.missingEmbeddings(sp, itemIds);
  if (missing.length) s.putEmbeddings(sp, missing.map((itemId) => ({ itemId, vector: v3(0.1, 0.2, 0.97) })));
}
function relation(src: ChunkId[], text = 'rats show habit after extended training', id = 'rl_aaaaaaaaaaaaaaaaaaaa'): Relation {
  return {
    id: id as DerivedItemId,
    kind: 'relation',
    text,
    sourceChunkIds: [...src].sort(),
    recipeId: recipeId({ kind: 'extract', version: 'test', spec: {} }),
    meta: {},
    nodes: [{ nodeId: nodeId('rat'), surface: 'rats', role: null }],
  };
}
const withExtract = (s: CorpusStore) => s.putRecipe({ kind: 'extract', version: 'test', spec: {} });

export function corpusStoreConformance(make: () => CorpusStore): Suite {
  return {
    name: 'corpusStoreConformance',
    cases: [
      {
        name: 'putRecipe is idempotent, returns recipeId(spec), getRecipe round-trips',
        run() {
          const s = make();
          const id = s.putRecipe(DEFAULT_CHUNK_RECIPE);
          expect(id).toBe(recipeId(DEFAULT_CHUNK_RECIPE));
          expect(s.putRecipe(structuredClone(DEFAULT_CHUNK_RECIPE))).toBe(id);
          expect(s.getRecipe(id)).toEqual({ ...DEFAULT_CHUNK_RECIPE, id });
          expect(s.getRecipe(recipeId(DEFAULT_SEARCH_RECIPE))).toBeNull();
        },
      },
      {
        name: 'putArtifact is idempotent, keyed by (sha256, parse recipe); findArtifact and getArtifact round-trip',
        async run() {
          const s = make();
          const a = artifactFor('doc-a');
          const id = s.putArtifact(a);
          expect(id).toBe(artifactId(a.sourceSha256, recipeId(a.recipe)));
          expect(s.putArtifact(structuredClone(a))).toBe(id);
          expect(s.findArtifact(a.sourceSha256, recipeId(a.recipe))).toBe(id);
          expect(s.findArtifact(a.sourceSha256, recipeId(DEFAULT_CHUNK_RECIPE))).toBeNull();
          expect(s.getArtifact(id)).toEqual(a);
          expect(s.getRecipe(recipeId(a.recipe))).not.toBeNull();
          await expectKgError(() => s.putArtifact({ ...a, format: 'nope' } as unknown as ParseArtifact), 'invalid_input');
        },
      },
      {
        name: 'putDocVersion validates ids against core derivations (invalid_input) and references (not_found)',
        async run() {
          const s = make();
          const docKey = asDocKey('d');
          const aid = s.putArtifact(artifactFor('d'));
          const crid = s.putRecipe(DEFAULT_CHUNK_RECIPE);
          const drafts = draftsFor(docKey, [{ text: 'alpha beta' }, { text: 'gamma delta' }]);
          const good = { id: docVersionId(docKey, aid, crid), docKey, artifactId: aid, chunkRecipeId: crid, chunkIds: drafts.map((d) => d.id) };
          await expectKgError(() => s.putDocVersion({ ...good, id: docVersionId(asDocKey('other'), aid, crid) }, drafts), 'invalid_input');
          await expectKgError(() => s.putDocVersion({ ...good, chunkIds: [...good.chunkIds].reverse() }, drafts), 'invalid_input');
          await expectKgError(() => s.putDocVersion(good, [{ ...drafts[0]!, text: 'tampered' }, drafts[1]!]), 'invalid_input');
          const missing = artifactId(sha256hex('nowhere'), recipeId(DEFAULT_PARSE_RECIPE));
          await expectKgError(() => s.putDocVersion({ ...good, artifactId: missing, id: docVersionId(docKey, missing, crid) }, drafts), 'not_found');
          expect(s.putDocVersion(good, drafts)).toEqual({ inserted: good.chunkIds, reused: [] });
        },
      },
      {
        name: 'putDocVersion reports inserted vs reused chunks and is idempotent',
        run() {
          const s = make();
          const a = seed(s, 'doc', 'doc-v1', ['one', 'two', 'three']);
          expect(a.r).toEqual({ inserted: a.v.chunkIds, reused: [] });
          expect(s.putDocVersion(a.v, a.drafts)).toEqual({ inserted: [], reused: a.v.chunkIds });
          const b = seed(s, 'doc', 'doc-v2', ['one', 'two and a half', 'three']);
          expect(b.r.reused.sort()).toEqual([a.v.chunkIds[0]!, a.v.chunkIds[2]!].sort());
          expect(b.r.inserted).toEqual([b.v.chunkIds[1]]);
          expect(s.getDocVersion(b.v.id)?.chunkIds).toEqual(b.v.chunkIds);
        },
      },
      {
        name: 'a reused chunk keeps its first-seen text: identity is the normalized text, never rewritten',
        run() {
          const s = make();
          const a = seed(s, 'doc', 'doc-v1', ['the  ideal\ngas law']);
          const b = seed(s, 'doc', 'doc-v2', ['the ideal gas law']);
          expect(b.v.chunkIds).toEqual(a.v.chunkIds);
          expect(b.r.reused).toEqual(a.v.chunkIds);
          expect(s.getItems(a.v.chunkIds)[0]!.text).toBe('the  ideal\ngas law');
        },
      },
      {
        name: 'getItems returns chunks with their fields, in the order asked, omitting unknown ids',
        run() {
          const s = make();
          const a = seed(s, 'doc', 'doc', [{ text: 'first', path: ['A'], page: 2 }, { text: 'second', path: ['A', 'B'], page: 3 }]);
          const [c0, c1] = a.v.chunkIds as [ChunkId, ChunkId];
          const got = s.getItems([c1, 'ch_zzzzzzzzzzzzzzzzzzzz' as ChunkId, c0]);
          expect(got.map((i) => i.id)).toEqual([c1, c0]);
          expect(got[0]).toEqual({
            id: c1,
            kind: 'chunk',
            text: 'second',
            sourceChunkIds: [c1],
            recipeId: null,
            meta: {},
            docKey: 'doc',
            sectionPath: ['A', 'B'],
            occurrence: 0,
            pages: [3],
            blockRefs: ['#/texts/1'],
          });
        },
      },
      {
        name: 'returned values are copies: mutating them does not change the store',
        run() {
          const s = make();
          const a = seed(s, 'doc', 'doc', ['immutable text']);
          const it = s.getItems(a.v.chunkIds)[0]!;
          it.text = 'mutated';
          it.sourceChunkIds.push('ch_zzzzzzzzzzzzzzzzzzzz' as ChunkId);
          expect(s.getItems(a.v.chunkIds)[0]!.text).toBe('immutable text');
          expect(s.getItems(a.v.chunkIds)[0]!.sourceChunkIds).toEqual(a.v.chunkIds);
        },
      },
      {
        name: 'current doc versions: sorted by docKey; setCurrentDocVersion checks existence and docKey',
        async run() {
          const s = make();
          const b = seed(s, 'b-doc', 'b', ['bbb']);
          const a = seed(s, 'a-doc', 'a', ['aaa']);
          expect(s.currentDocVersions()).toEqual([]);
          s.setCurrentDocVersion(b.docKey, b.v.id);
          s.setCurrentDocVersion(a.docKey, a.v.id);
          expect(s.currentDocVersions().map((v) => v.docKey)).toEqual(['a-doc', 'b-doc']);
          await expectKgError(() => s.setCurrentDocVersion(a.docKey, b.v.id), 'invalid_input');
          await expectKgError(() => s.setCurrentDocVersion(a.docKey, docVersionId(a.docKey, b.aid, a.crid)), 'not_found');
        },
      },
      {
        name: 'putItems: chunks rejected; Rule 1 sources must exist; identical repeat is a no-op',
        async run() {
          const s = make();
          const a = seed(s, 'doc', 'doc', ['src one', 'src two']);
          withExtract(s);
          s.putItems([], [{ id: nodeId('rat'), name: 'rat' }]);
          const chunk = s.getItems([a.v.chunkIds[0]!])[0]!;
          await expectKgError(() => s.putItems([chunk]), 'invalid_input');
          await expectKgError(() => s.putItems([relation(['ch_zzzzzzzzzzzzzzzzzzzz' as ChunkId])]), 'not_found');
          const rel = relation([...a.v.chunkIds]);
          s.putItems([rel]);
          s.putItems([structuredClone(rel)]);
          expect(s.getItems([rel.id])).toEqual([rel]);
        },
      },
      {
        name: 'Rule 2: an item id written again with different content throws immutable_violation',
        async run() {
          const s = make();
          const a = seed(s, 'doc', 'doc', ['src one']);
          withExtract(s);
          s.putItems([], [{ id: nodeId('rat'), name: 'rat' }]);
          s.putItems([relation([...a.v.chunkIds])]);
          await expectKgError(() => s.putItems([relation([...a.v.chunkIds], 'a different description')]), 'immutable_violation');
          expect(s.getItems(['rl_aaaaaaaaaaaaaaaaaaaa' as DerivedItemId])[0]!.text).toBe('rats show habit after extended training');
        },
      },
      {
        name: 'itemsBySourceChunk works in both directions (a chunk cites itself; a relation cites its chunks)',
        run() {
          const s = make();
          const a = seed(s, 'doc', 'doc', ['src one', 'src two', 'unrelated']);
          withExtract(s);
          s.putItems([], [{ id: nodeId('rat'), name: 'rat' }]);
          const rel = relation([a.v.chunkIds[0]!, a.v.chunkIds[1]!]);
          s.putItems([rel]);
          const ids = s.itemsBySourceChunk([a.v.chunkIds[1]!]).map((i) => i.id);
          expect(ids).toEqual([a.v.chunkIds[1]!, rel.id].sort());
          expect(s.itemsBySourceChunk([a.v.chunkIds[2]!]).map((i) => i.id)).toEqual([a.v.chunkIds[2]]);
          expect(rel.sourceChunkIds.every((c) => s.getItems([c]).length === 1)).toBe(true);
        },
      },
      {
        name: 'putSpace validates templates, is idempotent and returns spaceId(spec)',
        async run() {
          const s = make();
          expect(s.putSpace(SPACE)).toBe(spaceId(SPACE));
          expect(s.putSpace({ ...SPACE })).toBe(spaceId(SPACE));
          expect(s.getSpace(spaceId(SPACE))).toEqual({ ...SPACE, id: spaceId(SPACE) });
          await expectKgError(() => s.putSpace({ ...SPACE, documentTemplate: '{title} {text}' }), 'invalid_input');
        },
      },
      {
        name: 'embeddings: missingEmbeddings, first writer wins, dims and references checked',
        async run() {
          const s = make();
          const a = seed(s, 'doc', 'doc', ['x', 'y']);
          const sp = s.putSpace(SPACE);
          const [c0, c1] = a.v.chunkIds as [ChunkId, ChunkId];
          expect(s.missingEmbeddings(sp, [c1, c0])).toEqual([c1, c0]);
          s.putEmbeddings(sp, [{ itemId: c0, vector: v3(1, 0, 0) }]);
          expect(s.missingEmbeddings(sp, [c1, c0])).toEqual([c1]);
          s.putEmbeddings(sp, [{ itemId: c0, vector: v3(0, 1, 0) }]);
          s.putEmbeddings(sp, [{ itemId: c1, vector: v3(0, 1, 0) }]);
          s.setCurrentDocVersion(a.docKey, a.v.id);
          const { id } = build(s);
          expect(s.knn({ space: sp, vector: v3(1, 0, 0), buildId: id, kinds: ['chunk'], limit: 1 })[0]!.itemId).toBe(c0);
          await expectKgError(() => s.putEmbeddings(sp, [{ itemId: c1, vector: Float32Array.from([1, 0]) }]), 'invalid_input');
          await expectKgError(() => s.putEmbeddings(sp, [{ itemId: 'ch_zzzzzzzzzzzzzzzzzzzz' as ChunkId, vector: v3(1, 0, 0) }]), 'not_found');
        },
      },
      {
        name: 'knn: score = cosine similarity, ordered by score then itemId, limit respected',
        run() {
          const s = make();
          const a = seed(s, 'doc', 'doc', ['a', 'b', 'c', 'd']);
          const sp = s.putSpace(SPACE);
          const [ca, cb, cc, cd] = a.v.chunkIds as [ChunkId, ChunkId, ChunkId, ChunkId];
          s.putEmbeddings(sp, [
            { itemId: ca, vector: v3(1, 0, 0) },
            { itemId: cb, vector: v3(3, 4, 0) },
            { itemId: cc, vector: v3(3, 4, 0) },
            { itemId: cd, vector: v3(0, 0, 1) },
          ]);
          s.setCurrentDocVersion(a.docKey, a.v.id);
          const { id } = build(s);
          const got = s.knn({ space: sp, vector: v3(1, 0, 0), buildId: id, kinds: ['chunk'], limit: 3 });
          expect(got.length).toBe(3);
          expect(got[0]!.itemId).toBe(ca);
          expect(got[0]!.score).toBeCloseTo(1, 6);
          expect(got[1]!.score).toBeCloseTo(0.6, 6);
          expect(got.slice(1).map((x) => x.itemId)).toEqual([cb, cc].sort());
        },
      },
      {
        name: 'knn is restricted to the build: superseded chunks never come back',
        run() {
          const s = make();
          const a = seed(s, 'doc', 'doc-v1', ['old paragraph', 'kept paragraph']);
          const sp = s.putSpace(SPACE);
          s.putEmbeddings(sp, a.v.chunkIds.map((c, i) => ({ itemId: c, vector: i === 0 ? v3(1, 0, 0) : v3(0, 1, 0) })));
          s.setCurrentDocVersion(a.docKey, a.v.id);
          const b1 = build(s);
          const b = seed(s, 'doc', 'doc-v2', ['new paragraph', 'kept paragraph']);
          s.putEmbeddings(sp, [{ itemId: b.v.chunkIds[0]!, vector: v3(0, 0, 1) }]);
          s.setCurrentDocVersion(b.docKey, b.v.id);
          const b2 = build(s, b1.id);
          const hits = s.knn({ space: sp, vector: v3(1, 0, 0), buildId: b2.id, kinds: ['chunk'], limit: 10 }).map((h) => h.itemId);
          expect(hits).not.toContain(a.v.chunkIds[0]);
          expect(hits.sort()).toEqual([...b.v.chunkIds].sort());
          expect(s.knn({ space: sp, vector: v3(1, 0, 0), buildId: b1.id, kinds: ['chunk'], limit: 10 })[0]!.itemId).toBe(a.v.chunkIds[0]);
        },
      },
      {
        name: 'knn is restricted to the requested kinds',
        run() {
          const s = make();
          const a = seed(s, 'doc', 'doc', ['src']);
          withExtract(s);
          s.putItems([], [{ id: nodeId('rat'), name: 'rat' }]);
          const rel = relation([...a.v.chunkIds]);
          s.putItems([rel]);
          const sp = s.putSpace(SPACE);
          s.putEmbeddings(sp, [
            { itemId: a.v.chunkIds[0]!, vector: v3(0, 1, 0) },
            { itemId: rel.id, vector: v3(1, 0, 0) },
          ]);
          s.setCurrentDocVersion(a.docKey, a.v.id);
          const { id } = build(s, null, [rel]);
          expect(s.knn({ space: sp, vector: v3(1, 0, 0), buildId: id, kinds: ['chunk'], limit: 5 }).map((h) => h.itemId)).toEqual([a.v.chunkIds[0]]);
          expect(s.knn({ space: sp, vector: v3(1, 0, 0), buildId: id, kinds: ['chunk', 'relation'], limit: 5 })[0]!.itemId).toBe(rel.id);
        },
      },
      {
        name: 'knn on an unknown build or space is not_found; wrong dims is invalid_input',
        async run() {
          const s = make();
          const a = seed(s, 'doc', 'doc', ['x']);
          s.setCurrentDocVersion(a.docKey, a.v.id);
          const { id, sp } = build(s);
          await expectKgError(() => s.knn({ space: sp, vector: v3(1, 0, 0), buildId: 'bd_zzzzzzzzzzzzzzzzzzzz' as BuildId, kinds: ['chunk'], limit: 1 }), 'not_found');
          await expectKgError(() => s.knn({ space: spaceId({ ...SPACE, model: 'other' }), vector: v3(1, 0, 0), buildId: id, kinds: ['chunk'], limit: 1 }), 'not_found');
          await expectKgError(() => s.knn({ space: sp, vector: Float32Array.from([1, 0]), buildId: id, kinds: ['chunk'], limit: 1 }), 'invalid_input');
        },
      },
      {
        name: 'putBuild is content-addressed and idempotent; validates sortedness and references',
        async run() {
          const s = make();
          const a = seed(s, 'doc', 'doc', ['x', 'y']);
          s.setCurrentDocVersion(a.docKey, a.v.id);
          const { id, b } = build(s);
          expect(id).toBe(buildId(b.manifest, b.itemIds));
          const first = s.getBuild(id)!;
          expect(s.putBuild({ parentId: null, manifest: structuredClone(b.manifest), itemIds: [...b.itemIds] })).toBe(id);
          expect(s.getBuild(id)).toEqual(first);
          expect(first.itemIds).toEqual([...a.v.chunkIds].sort());
          const other = { ...b.manifest, mixedRecipes: true };
          await expectKgError(() => s.putBuild({ parentId: null, manifest: other, itemIds: [...b.itemIds].reverse() }), 'invalid_input');
          await expectKgError(() => s.putBuild({ parentId: null, manifest: other, itemIds: ['ch_zzzzzzzzzzzzzzzzzzzz' as ChunkId] }), 'not_found');
        },
      },
      {
        name: 'S1: the build ID covers the items (same manifest, different items -> different build)',
        run() {
          const s = make();
          const a = seed(s, 'doc', 'doc', ['src one', 'src two']);
          s.setCurrentDocVersion(a.docKey, a.v.id);
          withExtract(s);
          s.putItems([], [{ id: nodeId('rat'), name: 'rat' }]);
          const rel = relation([a.v.chunkIds[0]!]);
          s.putItems([rel]);
          const plain = build(s);
          const withRel = build(s, plain.id, [rel]);
          expect(withRel.b.manifest).toEqual(plain.b.manifest);
          expect(withRel.id).not.toBe(plain.id);
          expect(s.getBuild(withRel.id)!.itemIds).toContain(rel.id);
        },
      },
      {
        name: 'S2: putBuild refuses (precondition) a build with an item lacking a vector in a manifest space',
        async run() {
          const s = make();
          const a = seed(s, 'doc', 'doc', ['embedded', 'not embedded']);
          s.setCurrentDocVersion(a.docKey, a.v.id);
          const sp = s.putSpace(SPACE);
          s.putEmbeddings(sp, [{ itemId: a.v.chunkIds[0]!, vector: v3(1, 0, 0) }]);
          const b = composeBuild({ docVersions: s.currentDocVersions(), parseRecipeOf: (x) => recipeId(s.getArtifact(x)!.recipe), spaceIds: [sp], searchRecipeId: s.putRecipe(DEFAULT_SEARCH_RECIPE), parentId: null });
          await expectKgError(() => s.putBuild({ parentId: null, manifest: b.manifest, itemIds: b.itemIds }), 'precondition');
          expect(s.getBuild(b.id)).toBeNull();
        },
      },
      {
        name: 'current build pointer: null at first; setCurrentBuild needs an existing build',
        async run() {
          const s = make();
          expect(s.currentBuild()).toBeNull();
          await expectKgError(() => s.setCurrentBuild('bd_zzzzzzzzzzzzzzzzzzzz' as BuildId), 'not_found');
          const a = seed(s, 'doc', 'doc', ['x']);
          s.setCurrentDocVersion(a.docKey, a.v.id);
          const { id } = build(s);
          expect(s.currentBuild()).toBe(id);
        },
      },
      {
        name: 'labels are insert-only: same name and build is a no-op, same name for another build is a conflict',
        async run() {
          const s = make();
          const a = seed(s, 'doc', 'doc-v1', ['x']);
          s.setCurrentDocVersion(a.docKey, a.v.id);
          const b1 = build(s);
          const l = s.labelBuild('baseline', b1.id);
          expect(s.labelBuild('baseline', b1.id)).toEqual(l);
          const b = seed(s, 'doc', 'doc-v2', ['y']);
          s.setCurrentDocVersion(b.docKey, b.v.id);
          const b2 = build(s, b1.id);
          await expectKgError(() => s.labelBuild('baseline', b2.id), 'conflict');
          expect(s.getLabel('baseline')!.buildId).toBe(b1.id);
        },
      },
      {
        name: 'Rule 5: staleCheck flags a build citing chunks outside the current ingest',
        run() {
          const s = make();
          const a = seed(s, 'doc', 'doc-v1', ['keep', 'drop me']);
          s.setCurrentDocVersion(a.docKey, a.v.id);
          const b1 = build(s);
          expect(s.staleCheck(b1.id)).toEqual({ buildId: b1.id, missingChunkIds: [], stale: false });
          const b = seed(s, 'doc', 'doc-v2', ['keep']);
          s.setCurrentDocVersion(b.docKey, b.v.id);
          expect(s.staleCheck(b1.id)).toEqual({ buildId: b1.id, missingChunkIds: [a.v.chunkIds[1]], stale: true });
          const b2 = build(s, b1.id);
          expect(s.staleCheck(b2.id).stale).toBe(false);
          expect(s.getItems([a.v.chunkIds[1]!]).length).toBe(1); // superseded chunks are never deleted
        },
      },
      {
        name: 'transaction: a throw undoes every write inside it; nested calls join the outer one',
        run() {
          const s = make();
          expect(() =>
            s.transaction(() => {
              s.putRecipe(DEFAULT_CHUNK_RECIPE);
              s.transaction(() => s.putArtifact(artifactFor('tx')));
              throw new Error('boom');
            }),
          ).toThrow('boom');
          expect(s.getRecipe(recipeId(DEFAULT_CHUNK_RECIPE))).toBeNull();
          expect(s.findArtifact(sha256hex('tx'), recipeId(DEFAULT_PARSE_RECIPE))).toBeNull();
          expect(s.transaction(() => s.putRecipe(DEFAULT_CHUNK_RECIPE))).toBe(recipeId(DEFAULT_CHUNK_RECIPE));
        },
      },
      {
        name: 'Rule 3: mappings are insert-only records naming their run',
        async run() {
          const s = make();
          const rid = s.putRecipe({ kind: 'equivalence', version: 'test', spec: {} });
          const run = { id: 'dr_00000000000000000000000001' as RunId, recipeId: rid, inputStateHash: 'x', baseBuildId: null, createdAt: '2026-10-17T12:00:00.000Z' };
          const m = { id: 'mp_aaaaaaaaaaaaaaaaaaaa' as never, kind: 'same-as' as const, subject: 'node' as const, fromId: nodeId('DLS'), toId: nodeId('dorsolateral striatum'), runId: run.id, confidence: 0.9, note: null };
          s.putMappings(run, [m]);
          s.putMappings(run, [m]);
          await expectKgError(() => s.putMappings(run, [{ ...m, confidence: 0.1 }]), 'immutable_violation');
        },
      },
    ],
  };
}
