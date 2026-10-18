/** Every fake passes its conformance suite. */
import {
  FixedClock,
  HashEmbedder,
  InMemoryCorpusStore,
  InMemoryEvalRepo,
  InMemoryEventLog,
  LLM_REQUEST,
  ReplayLlm,
  ScriptedLlm,
  ScriptedSearchService,
  SeqIds,
  StaticStep,
  StaticPoolStep,
  BUILD_A,
  chunkerConformance,
  corpusStoreConformance,
  embedderConformance,
  evalRepoConformance,
  eventLogConformance,
  fakeKgApiHarness,
  fixtureChunker,
  fixtureParserHarness,
  infraConformance,
  kgApiConformance,
  knnFixtureSuite,
  llmConformance,
  machineLogConformance,
  machineMapConformance,
  machineMapFixture,
  machineRunFixture,
  nullEnv,
  parserConformance,
  registerSuite,
  scriptedMiniApi,
  searchServiceConformance,
  searchStepConformance,
  stepState,
} from '../src/all';
import { requestSha256, ulidGen, systemClock } from '@kg/core';

registerSuite(infraConformance(() => ({ clock: new FixedClock(), ids: new SeqIds() })));
registerSuite(infraConformance(() => ({ clock: systemClock, ids: ulidGen() })));
registerSuite(parserConformance(() => fixtureParserHarness()));
registerSuite(chunkerConformance(fixtureChunker));
registerSuite(embedderConformance(() => new HashEmbedder(64)));
registerSuite(corpusStoreConformance(() => new InMemoryCorpusStore()));
registerSuite(knnFixtureSuite(() => new InMemoryCorpusStore()));
registerSuite(eventLogConformance(() => new InMemoryEventLog()));
registerSuite(llmConformance(() => ({ llm: new ScriptedLlm({ byPurpose: { 'eval-judge': '{"score":1}' } }), request: LLM_REQUEST, unknownRequest: { ...LLM_REQUEST, purpose: 'other' }, deterministic: true })));
registerSuite(
  llmConformance(() => ({
    llm: new ReplayLlm([{ requestSha256: requestSha256(LLM_REQUEST), response: { text: '{"score":1}', model: LLM_REQUEST.model, inputTokens: 20, outputTokens: 4 } }]),
    request: LLM_REQUEST,
    unknownRequest: { ...LLM_REQUEST, temperature: 0.7 },
    deterministic: true,
  })),
);
registerSuite(evalRepoConformance(() => new InMemoryEvalRepo()));
registerSuite(searchStepConformance(() => ({ step: new StaticStep(stepState().candidates), state: stepState(), env: nullEnv })));
// P-1: the reference into step, with a pre-existing pool entry that the merge must keep
registerSuite(
  searchStepConformance(() => {
    const s = stepState();
    return { step: new StaticPoolStep('sub', s.candidates), state: { ...s, pools: {} }, env: nullEnv, into: ['sub'] };
  }),
);
registerSuite(searchServiceConformance(() => ({ service: new ScriptedSearchService(scriptedMiniApi().searches, () => BUILD_A), queries: Object.keys(scriptedMiniApi().searches), buildId: BUILD_A })));
registerSuite(kgApiConformance(() => fakeKgApiHarness()));
registerSuite(machineMapConformance(() => machineMapFixture()));
registerSuite(machineLogConformance(() => machineMapFixture(), () => machineRunFixture()));

// controls for the pre-written suites of packages that do not exist yet
import { evalRunnerConformance } from '../src/conformance/evalRunner';
import { referenceRunEval } from './reference-eval-runner';
registerSuite(evalRunnerConformance(referenceRunEval()));
registerSuite({ ...evalRunnerConformance(referenceRunEval('bracketed')), name: 'evalRunnerConformance (bracketed shape)' });
