import { searchFixtureSuite, searchServiceConformance, searchStepConformance, machineMapConformance, registerSuite } from '@kg/testkit/conformance';
import { miniSearchHarness, miniStepHarness } from '@kg/testkit';
import { machineMapOf } from '@kg/pipeline';
import { createSearch, similarity, truncate, vectorKnn } from '../src/index';

registerSuite(searchFixtureSuite((mc) => createSearch({ store: mc.store, embedder: mc.embedder })));
registerSuite(searchServiceConformance(() => miniSearchHarness((mc) => createSearch({ store: mc.store, embedder: mc.embedder }))));
registerSuite(machineMapConformance(() => machineMapOf(similarity, { machine: 'similarity', version: '1' })));
registerSuite(searchStepConformance(() => miniStepHarness(vectorKnn({ pool: 100, kinds: ['chunk'] }), undefined, { retrieval: true })));
registerSuite(searchStepConformance(() => miniStepHarness(vectorKnn({ pool: 3, kinds: ['chunk'] }), undefined, { retrieval: true })));
registerSuite(searchStepConformance(() => miniStepHarness(vectorKnn({ pool: 100, kinds: ['chunk'], into: 'sub:{queryId}' }), undefined, { retrieval: true, into: ['sub:q0', 'sub:q1'] })));
registerSuite(searchStepConformance(() => miniStepHarness(truncate({}), vectorKnn({ pool: 100, kinds: ['chunk'] }))));
