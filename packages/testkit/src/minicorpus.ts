/**
 * loadMiniCorpus: a store holding mini-corpus v1 and v2 with a build for each, built from the hand-derived
 * expected chunks (no chunker, no ingest). Embeddings use HashEmbedder(4096) through core's conditioning,
 * so search packages can be tested without any sibling.
 */
import {
  DEFAULT_SEARCH_RECIPE,
  asDocKey,
  composeBuild,
  docVersionId,
  recipeId,
  renderDocument,
  renderQuery,
  type BuildId,
  type ChunkDraft,
  type ChunkId,
  type CorpusStore,
  type IngestService,
  type KgHandlers,
  type SearchService,
  type SearchState,
  type SearchStep,
  DEFAULT_CHUNK_RECIPE,
  KgError,
  createKgApi,
} from '@kg/core';
import { FixedClock, SeqIds } from './fakes/infra';
import { ScriptedSearchService } from './fakes/search';
import { scriptedMiniApi } from './harnesses';
import { HashEmbedder } from './fakes/embedder';
import { InMemoryCorpusStore } from './fakes/store';
import { InMemoryEventLog } from './fakes/eventlog';
import { HASH_SPACE, MINI_DOCS, miniArtifact, miniExpected, miniLabels } from './fixtures';

/** HashEmbedder that records every text it embedded (lets suites check conditioning). */
export class RecordingHashEmbedder extends HashEmbedder {
  readonly texts: string[] = [];
  override async embed(texts: readonly string[]) {
    this.texts.push(...texts);
    return super.embed(texts);
  }
}

/** The v1 build uses this search recipe, v2 uses DEFAULT_SEARCH_RECIPE, so a runner that reads the recipe of the
 * current build instead of the searched one is caught (review M31). Same ranking on 17 chunks. */
export const V1_SEARCH_RECIPE = { ...DEFAULT_SEARCH_RECIPE, version: 'mini-v1', spec: { steps: [{ type: 'vector-knn', params: { pool: 50, kinds: ['chunk'] } }, { type: 'truncate', params: {} }] } } as const;

export interface MiniCorpus {
  store: CorpusStore;
  embedder: RecordingHashEmbedder;
  builds: { v1: BuildId; v2: BuildId };
  labels: Record<string, ChunkId>;
  labelOf: (id: string) => string;
}

export async function loadMiniCorpus(store: CorpusStore = new InMemoryCorpusStore()): Promise<MiniCorpus> {
  const embedder = new RecordingHashEmbedder(HASH_SPACE.dims);
  const labels = miniLabels();
  const space = store.putSpace(HASH_SPACE);
  const chunkRid = store.putRecipe(DEFAULT_CHUNK_RECIPE);
  const searchRids = { 1: store.putRecipe(V1_SEARCH_RECIPE as never), 2: store.putRecipe(DEFAULT_SEARCH_RECIPE) };
  const builds = {} as { v1: BuildId; v2: BuildId };
  let parent: BuildId | null = null;
  for (const v of [1, 2] as const) {
    const exp = miniExpected(v);
    for (const d of MINI_DOCS) {
      const docKey = asDocKey(d);
      const aid = store.putArtifact(miniArtifact(v, d));
      const drafts: ChunkDraft[] = exp[d].map((c) => ({ id: labels[c.label]!, text: c.text, sectionPath: c.sectionPath, occurrence: c.occurrence, pages: c.pages, blockRefs: c.blockRefs }));
      const dv = { id: docVersionId(docKey, aid, chunkRid), docKey, artifactId: aid, chunkRecipeId: chunkRid, chunkIds: drafts.map((c) => c.id) };
      store.putDocVersion(dv, drafts);
      const missing = store.missingEmbeddings(space, dv.chunkIds);
      const vecs = await embedder.embed(missing.map((id) => renderDocument(HASH_SPACE, drafts.find((x) => x.id === id)!)));
      store.putEmbeddings(space, missing.map((itemId, i) => ({ itemId, vector: vecs[i]! })));
      store.setCurrentDocVersion(docKey, dv.id);
    }
    const b = composeBuild({ docVersions: store.currentDocVersions(), parseRecipeOf: (a) => recipeId(store.getArtifact(a)!.recipe), spaceIds: [space], searchRecipeId: searchRids[v], parentId: parent });
    const id = store.putBuild({ parentId: b.parentId, manifest: b.manifest, itemIds: b.itemIds });
    store.setCurrentBuild(id);
    builds[v === 1 ? 'v1' : 'v2'] = id;
    parent = id;
  }
  const byId = new Map(Object.entries(labels).map(([l, id]) => [id as string, l]));
  return { store, embedder, builds, labels, labelOf: (id) => byId.get(id) ?? id };
}

/**
 * A searchStepConformance harness over the mini-corpus v1 build: a state with two query variants
 * (q0 "entropy", q1 "Carnot efficiency" derived from q0). Pass `seed` to run a retrieval step first, so that
 * a step that reorders or cuts candidates (truncate, rerank) has something to work on.
 */
export async function miniStepHarness(step: SearchStep, seed?: SearchStep, o: { retrieval?: boolean } = {}) {
  const mc = await loadMiniCorpus();
  const space = mc.store.getSpace(mc.store.getBuild(mc.builds.v1)!.manifest.embeddingSpaces[0]!)!;
  const env = { store: mc.store, embedder: mc.embedder, space };
  let state: SearchState = {
    query: 'entropy',
    k: 3,
    buildId: mc.builds.v1,
    queries: [
      { id: 'q0', text: 'entropy', origin: 'original', parentId: null },
      { id: 'q1', text: 'Carnot efficiency', origin: 'rewrite', parentId: 'q0' },
    ],
    candidates: [],
    seeds: [],
    done: false,
    notes: {},
  };
  if (seed) state = (await seed.run(state, env)).state;
  if (o.retrieval) {
    // an existing candidate from an earlier step, with a score no retrieval would give it
    const id = mc.labels['gas/pre']!;
    state = { ...state, candidates: [{ itemId: id, kind: 'chunk', score: -0.5, sourceChunkIds: [id], via: 'earlier-step', queryId: null }, ...state.candidates] };
  }
  return { step, state, env, retrieval: o.retrieval ?? false };
}

/**
 * A kgApiConformance harness for the `api` package: mini-corpus store with the v1 build current,
 * ScriptedSearchService (scriptedMiniApi), InMemoryEventLog, and an ingest that is not implemented.
 * advanceBuild() switches the current build to v2 (Rule 6 propagation test).
 */
export async function miniApiHarness(
  makeHandlers: (d: { store: CorpusStore; log: InMemoryEventLog; search: SearchService; ingest: IngestService }) => KgHandlers,
) {
  const mc = await loadMiniCorpus();
  mc.store.setCurrentBuild(mc.builds.v1);
  const clock = new FixedClock();
  const ids = new SeqIds();
  const log = new InMemoryEventLog(clock, ids);
  const script = scriptedMiniApi();
  const search = new ScriptedSearchService(script.searches, () => mc.store.currentBuild()!);
  const ingest = { ingest: async () => { throw new KgError('not_implemented', 'miniApiHarness has no ingest'); } };
  const api = createKgApi({ log, clock, ids, currentBuild: () => mc.store.currentBuild() }, makeHandlers({ store: mc.store, log, search, ingest }));
  return {
    api,
    reader: log,
    query: Object.keys(script.searches)[0]!,
    // gas/1-ab is a v1 chunk that v2 dropped
    nonMember: { itemId: mc.labels['gas/1-ab']!, buildId: mc.builds.v2 },
    advanceBuild: async () => {
      mc.store.setCurrentBuild(mc.builds.v2);
      return mc.builds.v2;
    },
  };
}

/**
 * A searchServiceConformance harness over the mini-corpus: default build v2, other build v1 (whose manifest names
 * V1_SEARCH_RECIPE), the recording embedder and HASH_SPACE's (non-identity) query template.
 */
export async function miniSearchHarness(makeService: (mc: MiniCorpus) => SearchService) {
  const mc = await loadMiniCorpus();
  return {
    service: makeService(mc),
    queries: ['entropy of an isolated system'],
    buildId: mc.builds.v2,
    otherBuildId: mc.builds.v1,
    recipeOf: (b: BuildId) => mc.store.getBuild(b)!.manifest.searchRecipeId,
    embeddedTexts: () => mc.embedder.texts,
    renderQuery: (q: string) => renderQuery(HASH_SPACE, q),
  };
}
