import {
  DEFAULT_CHUNK_RECIPE,
  DEFAULT_SEARCH_RECIPE,
  KgError,
  asDocKey,
  composeBuild,
  docVersionId,
  recipeId,
  type BuildId,
  type ChunkId,
  type CorpusStore,
  type EmbeddingSpaceSpec,
  type ItemId,
  type SpaceId,
} from '@kg/core';
import { artifactFor, draftsFor } from '@kg/testkit/conformance';

/** Deterministic PRNG (mulberry32): same seed, same sequence, on every run. */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomVector(dims: number, rnd: () => number): Float32Array {
  const v = new Float32Array(dims);
  for (let i = 0; i < dims; i++) v[i] = rnd() * 2 - 1;
  return v;
}

export const spaceSpec = (dims: number): EmbeddingSpaceSpec => ({
  model: `test-${dims}d`,
  digest: `fake-test-${dims}d`,
  dims,
  documentTemplate: '{text}',
  queryTemplate: '{query}',
  formulaView: 'placeholder',
});

/**
 * One document with n chunks, embedded in one space, and a current build over it. The first vector is all zeros
 * when zeroFirst is set. Returns the ids the test needs.
 */
export function populate(s: CorpusStore, n: number, dims: number, seed: number, opts: { zeroFirst?: boolean; doc?: string; tag?: string } = {}) {
  const rnd = prng(seed);
  const docKey = asDocKey(opts.doc ?? 'rand');
  const aid = s.putArtifact(artifactFor(opts.tag ?? 'rand'));
  const crid = s.putRecipe(DEFAULT_CHUNK_RECIPE);
  const drafts = draftsFor(docKey, Array.from({ length: n }, (_, i) => ({ text: `${opts.tag ?? 'rand'} chunk number ${i}` })));
  const v = { id: docVersionId(docKey, aid, crid), docKey, artifactId: aid, chunkRecipeId: crid, chunkIds: drafts.map((d) => d.id) };
  s.putDocVersion(v, drafts);
  s.setCurrentDocVersion(docKey, v.id);
  const sp = s.putSpace(spaceSpec(dims));
  const vecs = drafts.map((_, i) => (i === 0 && opts.zeroFirst ? new Float32Array(dims) : randomVector(dims, rnd)));
  s.putEmbeddings(sp, drafts.map((d, i) => ({ itemId: d.id, vector: vecs[i]! })));
  const srid = s.putRecipe(DEFAULT_SEARCH_RECIPE);
  const b = composeBuild({
    docVersions: s.currentDocVersions(),
    parseRecipeOf: (a) => recipeId(s.getArtifact(a)!.recipe),
    spaceIds: [sp],
    searchRecipeId: srid,
    parentId: s.currentBuild(),
  });
  const id = s.putBuild({ parentId: b.parentId, manifest: b.manifest, itemIds: b.itemIds });
  s.setCurrentBuild(id);
  return { id, space: sp, chunkIds: v.chunkIds as ChunkId[], vecs, b, docKey, artifactId: aid, chunkRecipeId: crid };
}

/** Error code of a thrown KgError, 'none' if nothing was thrown, 'other' for non-KgError errors. */
export function codeOf(fn: () => unknown): string {
  try {
    fn();
    return 'none';
  } catch (e) {
    return e instanceof KgError ? e.code : `other: ${e instanceof Error ? e.message : String(e)}`;
  }
}

export type { BuildId, ItemId, SpaceId };
