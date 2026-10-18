/**
 * Meta-test: each conformance suite must FAIL its deliberately broken fake, and in the cases that are meant
 * to catch that defect. If a suite stops catching its broken fake, this test fails.
 */
import { describe, expect, it } from 'vitest';
import { requestSha256 } from '@kg/core';
import {
  BUILD_A,
  LLM_REQUEST,
  StaticStep,
  broken,
  chunkerConformance,
  corpusStoreConformance,
  embedderConformance,
  evalRepoConformance,
  eventLogConformance,
  fixtureChunker,
  fixtureParserHarness,
  infraConformance,
  ingestScenarios,
  kgApiConformance,
  llmConformance,
  nullEnv,
  parserConformance,
  runSuite,
  scriptedMiniApi,
  searchServiceConformance,
  searchStepConformance,
  stepState,
  FixedClock,
  type Suite,
} from '../src/all';

async function mustCatch(suite: Suite, expectedFailing: string[]) {
  const r = await runSuite(suite);
  const failed = r.failed.map((f) => f.name);
  expect(failed.length, `${suite.name} passed its broken fake`).toBeGreaterThan(0);
  for (const name of expectedFailing) expect(failed.some((f) => f.startsWith(name)), `${suite.name}: case "${name}" did not catch the defect; failed: ${failed.join(' | ')}`).toBe(true);
}

describe('every conformance suite catches its broken fake', () => {
  it('Parser: DriftingParser (recipe not echoed)', () =>
    mustCatch(parserConformance(() => fixtureParserHarness((e) => new broken.DriftingParser(e))), ['the requested recipe is echoed verbatim']));

  it('Chunker: index-based IDs', () =>
    mustCatch(chunkerConformance(broken.indexIdChunker(fixtureChunker)), ['chunk IDs equal core chunkId', 'v1 -> v2: exactly the expected chunk IDs']));

  it('Embedder: unnormalized vectors', () => mustCatch(embedderConformance(() => new broken.UnnormalizedEmbedder()), ['vectors are L2-normalized']));
  it('Embedder: batch order not preserved', () => mustCatch(embedderConformance(() => new broken.BatchOrderEmbedder(64)), ['batching does not matter']));

  it('CorpusStore: MutableStore overwrites items (Rule 2)', () =>
    mustCatch(corpusStoreConformance(() => new broken.MutableStore()), ['Rule 2: an item id written again']));
  it('CorpusStore: LeakyKnnStore ignores the build', () =>
    mustCatch(corpusStoreConformance(() => new broken.LeakyKnnStore()), ['knn is restricted to the build']));

  it('EventLog: GappySeqLog', () => mustCatch(eventLogConformance(() => new broken.GappySeqLog()), ['append assigns id, ts and contiguous per-session seq']));
  it('EventLog: NoValidateLog', () =>
    mustCatch(eventLogConformance(() => new broken.NoValidateLog()), ['payloads are validated against the catalog', 'Rule 6 and search linkage']));

  it('Llm: ImprovisingLlm answers unknown requests', () =>
    mustCatch(
      llmConformance(() => ({ llm: new broken.ImprovisingLlm({ bySha: { [requestSha256(LLM_REQUEST)]: 'ok' } }), request: LLM_REQUEST, unknownRequest: { ...LLM_REQUEST, purpose: 'x' }, deterministic: true })),
      ['an unknown request is refused'],
    ));

  it('EvalRepo: OverwritingEvalRepo', () => mustCatch(evalRepoConformance(() => new broken.OverwritingEvalRepo()), ['results are insert-only']));

  it('SearchStep: MutatingStep', () =>
    mustCatch(searchStepConformance(() => ({ step: new broken.MutatingStep(), state: stepState(), env: nullEnv })), ['does not mutate its input state']));
  it('SearchStep: UnrankedStep', () =>
    mustCatch(searchStepConformance(() => ({ step: new broken.UnrankedStep(), state: stepState(), env: nullEnv })), ['output candidates are ordered']));
  it('SearchStep: the good StaticStep is not flagged (control)', async () => {
    const r = await runSuite(searchStepConformance(() => ({ step: new StaticStep(stepState().candidates), state: stepState(), env: nullEnv })));
    expect(r.failed).toEqual([]);
  });

  it('SearchService: NoTraceSearchService omits search.step', () =>
    mustCatch(
      searchServiceConformance(() => ({ service: new broken.NoTraceSearchService(scriptedMiniApi().searches, () => BUILD_A), queries: Object.keys(scriptedMiniApi().searches), buildId: BUILD_A })),
      ['event sequence'],
    ));

  it('KgApi: SilentKgApi drops tool.returned', () =>
    mustCatch(
      kgApiConformance(() => {
        const s = broken.silentKgApi(scriptedMiniApi());
        return { api: s.api, reader: s.log, query: Object.keys(scriptedMiniApi().searches)[0]! };
      }),
      ['search: tool.called -> query', 'addNote stores a note'],
    ));

  it('IngestService: EagerIngestService (no cache, eager pointer moves, no artifact import)', () =>
    mustCatch(
      ingestScenarios((d) => new broken.EagerIngestService(d), fixtureChunker),
      ['parse artifacts are cached', 'an embedder failure mid-ingest', 'importing artifact files'],
    ));

  it('Clock/IdGen: RepeatingIds', () => mustCatch(infraConformance(() => ({ clock: new FixedClock(), ids: new broken.RepeatingIds() })), ['ids: well-formed per prefix, unique']));
});


import { evalRunnerConformance } from '../src/conformance/evalRunner';
import { referenceRunEval } from './reference-eval-runner';
describe('pre-written suites catch a broken implementation', () => {
  it('evalRunner: a runner that ignores the pinned build (uses the current one) fails Rule 6', () =>
    mustCatch(evalRunnerConformance((d, set, o) => referenceRunEval(d, set, { ...o, buildId: undefined })), ['Rule 6: every eval.* event']));
});
