/** The skeleton implementations pass the same suites the Phase 2 packages will have to pass. */
import { describe, expect, it } from 'vitest';
import { DEFAULT_SPACE } from '@kg/core';
import { FixedClock, FixtureParser, HashEmbedder, SeqIds, loadMiniCorpus, miniSearchHarness, miniStepHarness, miniApiHarness, miniConfig, miniParserEntries, miniArtifactPath, MINI_DOCS, broken } from '@kg/testkit';
import {
  embedderConformance,
  ingestScenarios,
  kgApiConformance,
  registerSuite,
  runSuite,
  searchFixtureSuite,
  searchServiceConformance,
  searchStepConformance,
} from '@kg/testkit/conformance';
import { createApiHandlers, createIngest, createSearch, createSkeleton, ollamaAvailable, ollamaEmbedder, sectionPack, truncate, vectorKnn } from '../src/index';

// The skeleton predates formula views and never calls chunkView, so that one scenario does not apply to it.
const skeletonIngest = () => {
  const s = ingestScenarios((d) => createIngest(d), sectionPack);
  return { ...s, cases: s.cases.filter((c) => !c.name.startsWith('embedded texts pass through chunkView')) };
};
registerSuite(skeletonIngest());

registerSuite(searchFixtureSuite((mc) => createSearch({ store: mc.store, embedder: mc.embedder })));

registerSuite(
  searchServiceConformance(() => miniSearchHarness((mc) => createSearch({ store: mc.store, embedder: mc.embedder }))),
);

registerSuite(searchStepConformance(() => miniStepHarness(vectorKnn({ pool: 100, kinds: ['chunk'] }), undefined, { retrieval: true })));
// two variants, small pool: the fused list exceeds the pool, so considered must not be cut to it (review N4)
registerSuite(searchStepConformance(() => miniStepHarness(vectorKnn({ pool: 3, kinds: ['chunk'] }), undefined, { retrieval: true })));
registerSuite(searchStepConformance(() => miniStepHarness(truncate({}), vectorKnn({ pool: 100, kinds: ['chunk'] }))));

registerSuite(
  kgApiConformance(async () => {
    const sk = createSkeleton({ parser: new FixtureParser(miniParserEntries()), embedder: new HashEmbedder(4096), config: miniConfig(), clock: new FixedClock(), ids: new SeqIds() });
    const { sessionId } = await sk.api.openSession({ kind: 'cli', label: 'setup' });
    await sk.api.ingest(sessionId, { artifacts: MINI_DOCS.map((d) => ({ path: miniArtifactPath(1, d) })) });
    return {
      api: sk.api,
      reader: sk.log,
      query: 'entropy of an isolated system',
      advanceBuild: async () => (await sk.api.ingest(sessionId, { artifacts: MINI_DOCS.map((d) => ({ path: miniArtifactPath(2, d) })) })).buildId,
    };
  }),
);

registerSuite(kgApiConformance(() => miniApiHarness((d) => createApiHandlers(d))));

describe('vector-knn loops over every query variant (query refinement needs no step change)', () => {
  it('a second variant contributes candidates the first would not rank first', async () => {
    const h = await miniStepHarness(vectorKnn({ pool: 100, kinds: ['chunk'] }));
    const out = await h.step.run(h.state, h.env);
    const viaQ1 = out.state.candidates.filter((c) => c.queryId === 'q1');
    expect(viaQ1.length).toBeGreaterThan(0);
    expect(out.trace.queries?.map((q) => q.id)).toEqual(['q0', 'q1']);
  });
});

describe('ingest scenarios have teeth against the skeleton too', () => {
  it('EagerIngestService fails, the skeleton passes', async () => {
    const bad = await runSuite(ingestScenarios((d) => new broken.EagerIngestService(d), sectionPack));
    const good = await runSuite(skeletonIngest());
    expect(bad.failed.length).toBeGreaterThan(0);
    expect(good.failed).toEqual([]);
  });
});

const live = await ollamaAvailable(DEFAULT_SPACE.model);
describe.skipIf(!live)('live Ollama embedder (embeddinggemma)', () => {
  registerSuite(embedderConformance(() => ollamaEmbedder(DEFAULT_SPACE.model, DEFAULT_SPACE.dims), { tol: 1e-4 }));
});

// MCP adapter shape: the mcp package passes an SDK in-memory transport client; here the transport-free mcpCall
import { TOOLS as ALL_TOOLS, TOOL_NAMES } from '@kg/core';
import { fakeKgApiHarness } from '@kg/testkit';
import { mcpConformance } from '@kg/testkit/conformance';
import { mcpCall } from '../src/index';
registerSuite(
  mcpConformance(() => {
    const h = fakeKgApiHarness();
    return {
      api: h.api,
      reader: h.reader,
      query: h.query,
      async connect(api) {
        const { sessionId } = await api.openSession({ kind: 'agent', label: 'mcp-test' });
        return {
          listTools: async () => TOOL_NAMES.map((k) => ({ name: ALL_TOOLS[k].name })),
          callTool: (name, args) => mcpCall(api, sessionId, name, args) as never,
        };
      },
    };
  }),
);
