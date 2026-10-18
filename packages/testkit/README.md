# @kg/testkit (frozen at fan-out)

- `@kg/testkit`: fakes for every core port (FixedClock, SeqIds, FixtureParser, HashEmbedder,
  InMemoryCorpusStore, InMemoryEventLog, ScriptedLlm, ReplayLlm, InMemoryEvalRepo, StaticStep,
  ScriptedSearchService, fakeKgApi), deliberately broken fakes (`broken.*`), fixture loaders, and harness
  helpers (`loadMiniCorpus`, `miniStepHarness`, `miniApiHarness`, `fixtureChunker`, `scriptedMiniApi`).
  No vitest dependency: safe to import at runtime.
- `@kg/testkit/conformance`: the suites (`registerSuite(xxxConformance(make))` inside a vitest file;
  `runSuite` to run one programmatically).
- `fixtures/` and `golden/`: every directory has a README saying what the fixture means and how its expected
  values were derived (by hand or by an independent Python oracle, never by the code under test).
IngestService has no standalone fake: its scenarios need a real implementation (the Phase 1 reference is
`packages/app/src/skeleton/ingest.ts`); `broken.EagerIngestService` shows what failing looks like.
Tests: `pnpm --filter @kg/testkit test` (fakes pass, broken fakes fail, golden vectors, fixture integrity).
