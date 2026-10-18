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
  StaticPoolStep,
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
  machineLogConformance,
  machineMapConformance,
  machineMapFixture,
  machineRunFixture,
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
  it('CorpusStore: SilentDocVersionStore keeps the first chunk list (CP-01b)', () =>
    mustCatch(corpusStoreConformance(() => new broken.SilentDocVersionStore()), ['CP-01b: putDocVersion with an existing id']));
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
  it('SearchStep: PoolDroppingStep wipes pools it did not write', () =>
    mustCatch(searchStepConformance(() => ({ step: new broken.PoolDroppingStep(), state: stepState(), env: nullEnv })), ['P-1: pools the step did not write pass through']));
  it('SearchStep: PoolLeakingStep writes candidates and an unranked duplicated pool', () => {
    const s = stepState();
    return mustCatch(searchStepConformance(() => ({ step: new broken.PoolLeakingStep('sub', s.candidates.slice(0, 2)), state: s, env: nullEnv, into: ['sub'] })), ['P-1: into:']);
  });
  it('SearchStep: the good StaticPoolStep is not flagged (control)', async () => {
    const r = await runSuite(searchStepConformance(() => ({ step: new StaticPoolStep('sub', stepState().candidates), state: stepState(), env: nullEnv, into: ['sub'] })));
    expect(r.failed).toEqual([]);
  });
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
    mustCatch(evalRunnerConformance((d, set, o) => referenceRunEval()(d, set, { ...o, buildId: undefined })), ['Rule 6: every eval.* event']));
  it('evalRunner: eval.run.completed before the last scored fails the relative order', () =>
    mustCatch(evalRunnerConformance(referenceRunEval('completed-first')), ['event order']));
  it('evalRunner: pipeline.finished before eval.run.completed fails the relative order', () =>
    mustCatch(evalRunnerConformance(referenceRunEval('finished-early')), ['event order']));
});

describe('contract 0.6.0: pipeline bracket and machine suites catch their broken variants', () => {
  it('SearchService: PipelinelessSearchService omits pipeline.started / pipeline.finished', () =>
    mustCatch(
      searchServiceConformance(() => ({ service: new broken.PipelinelessSearchService(scriptedMiniApi().searches, () => BUILD_A), queries: Object.keys(scriptedMiniApi().searches), buildId: BUILD_A })),
      ['event sequence', 'pipeline.finished closes the search'],
    ));

  it('IngestService: an ingest that ignores chunkView fails the chunkView scenario; applying it passes (control)', async () => {
    await mustCatch(ingestScenarios((d) => new broken.EagerIngestService(d), fixtureChunker), ['embedded texts pass through chunkView']);
    const r = await runSuite(ingestScenarios((d) => new broken.EagerIngestService(d, true), fixtureChunker));
    expect(r.failed.map((f) => f.name)).not.toContain('embedded texts pass through chunkView: one render per embedded text, none for unchanged chunks');
  });
  it('IngestService: PipelinelessIngestService omits the pipeline bracket', () =>
    mustCatch(ingestScenarios((d) => new broken.PipelinelessIngestService(d), fixtureChunker), ['pipeline: each ingest call is bracketed']));

  it('IngestService: EagerIngestService (which brackets its run) passes the pipeline bracket case (control)', async () => {
    const r = await runSuite(ingestScenarios((d) => new broken.EagerIngestService(d), fixtureChunker));
    expect(r.failed.filter((f) => f.name.startsWith('pipeline:'))).toEqual([]);
    expect(r.passed.some((n) => n.startsWith('pipeline:'))).toBe(true);
  });

  it('MachineMap: no failed final state', () =>
    mustCatch(machineMapConformance(() => broken.mapWithoutFailedFinal(machineMapFixture())), ['exactly one final state']));
  it('MachineMap: a node no move leads to', () =>
    mustCatch(machineMapConformance(() => broken.mapWithUnreachableNode(machineMapFixture())), ['every non-final node is reachable']));
  it('MachineMap: a work node without a step', () =>
    mustCatch(machineMapConformance(() => broken.mapWithSteplessWork(machineMapFixture())), ['every work node has a non-null step']));

  it('MachineLog: a step in a state the map does not have', () =>
    mustCatch(machineLogConformance(() => machineMapFixture(), () => broken.logWithStrayStep(machineRunFixture())), ['every search.step trace.state']));
  it('MachineLog: the run never finishes its pipeline', () =>
    mustCatch(machineLogConformance(() => machineMapFixture(), () => broken.logWithoutFinish(machineRunFixture())), ['the first pipeline event']));

  it('MachineLog: an event type no work node declares', () =>
    mustCatch(machineLogConformance(() => machineMapFixture(), () => broken.logWithUndeclaredEvent(machineRunFixture())), ['every non-envelope event type']));
  it('MachineLog: a map whose work nodes declare nothing', () =>
    mustCatch(machineLogConformance(() => broken.mapWithoutDeclaredLogs(machineMapFixture()), () => machineRunFixture()), ['every non-envelope event type']));
  it('MachineMap: a work node that logs nothing', () =>
    mustCatch(machineMapConformance(() => broken.mapWithoutDeclaredLogs(machineMapFixture())), ['every work node has a non-null step and at least one log entry']));
  it('MachineLog with steps:false skips the step cases but keeps the declared-events case', async () => {
    const suite = machineLogConformance(() => machineMapFixture(), () => machineRunFixture(), { steps: false });
    expect(suite.cases.map((c) => c.name).some((n) => n.includes('search.step trace.state'))).toBe(false);
    expect((await runSuite(suite)).failed).toEqual([]);
    await mustCatch(machineLogConformance(() => machineMapFixture(), () => broken.logWithUndeclaredEvent(machineRunFixture()), { steps: false }), ['every non-envelope event type']);
  });
  it('machine suites: the good map and the good run are not flagged (control)', async () => {
    for (const suite of [machineMapConformance(() => machineMapFixture()), machineLogConformance(() => machineMapFixture(), () => machineRunFixture())]) {
      const r = await runSuite(suite);
      expect(r.failed, suite.name).toEqual([]);
    }
  });
});
