# testkit: pipeline machines (contract 0.6.0)

## Done
- Search conformance: the sequence is tool.called, query, pipeline.started, search.step x n, pipeline.finished,
  search.result, tool.returned. New cases: pipeline.started (pipeline, machine, version, topology, buildId, searchId),
  pipeline.finished (pipeline, status done, non-empty state, buildId, searchId), every step state non-empty and
  between the bracket. The search fake (ScriptedSearchService) emits the bracket. kgapi conformance's sequence
  expectation is updated to match. NoTraceSearchService still fails the sequence case; PipelinelessSearchService is new.
- Ingest conformance: a new case checks every ingest call is bracketed (started before the first ingest.*, finished
  after the last, status done or failed when tool.failed is logged), and that both events validate with null
  buildId and searchId. EagerIngestService (the only ingest fake) emits the bracket; PipelinelessIngestService is new.
- Machine suites in src/conformance/machine.ts: machineMapConformance and machineLogConformance, exported through
  src/conformance.ts. Fixtures: fixtures/machine/search-map.json (similarity map), search-run.jsonl (one search),
  loaders machineMapFixture and machineRunFixture in src/fixtures.ts. Broken variants are transforms in src/broken/index.ts.
- Log fixtures: pipeline.started/finished around each whole search (agent 3, eval 2, live-partial 1). fixtures/log/README.md updated.
- Meta tests: each new broken variant fails its named case; good map, good run and the EagerIngestService bracket are not flagged.

## Assumptions
- "in src/fixtures": data files go in packages/testkit/fixtures/machine/ and the loaders in src/fixtures.ts
  (a src/fixtures/ directory would clash with the existing src/fixtures.ts import).
- "last event is not pipeline.finished" is checked as: the last pipeline.* event of the run is not pipeline.finished.
  A run's events include search.result and tool.returned after the bracket, so a literal last-event check would reject valid runs.
- A log step is valid when its state is the initial state or reachable from it; each next state is reached through
  routing nodes only; a repeated state needs a cycle through routing nodes (the loop case).
- The fake search machine is named as DEFAULT_SEARCH_RECIPE names it (similarity, version 1, topology 69bc55d30db24c90).
  The fake's single step is state retrieve; its pipeline.finished state is done.
- Log seq numbers were renumbered (fromEnvelopes requires contiguous seq). New event ids are ev_0...1001 onward.
  Every other field of every existing line is unchanged.

## Would flag
- session-agent's ingest run is not bracketed (the task said searches only). An ingest bracket in the fixture
  would need the same treatment.
- The query lines in the log fixtures still carry rc_dsttj7ftrqu6ebxcedps, the search recipe id before the 0.5.0
  change (DEFAULT_SEARCH_RECIPE is now rc_qabaozbopsfdecarndip, per golden/README.md). The new pipeline.started
  copies that id so it matches its own query line. Updating the fixtures would change other lines.
- packages/app (not read, per the instructions) may count events in these fixtures or depend on the old seq
  numbers (agent 51 to 57 lines, live-partial 10 to 12, eval 21 to 25). Its tests should be run.
- Some existing comments in the edited files already carry sprint marker codes (P-1, S-11). They predate this task and were left alone.
- The map fixture is hand-written and not checked against a real machine definition: no pipeline package exists yet.
