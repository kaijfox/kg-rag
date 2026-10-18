import { ingestScenarios, registerSuite } from '@kg/testkit/conformance';
import { fixtureChunker } from '@kg/testkit';
import { createIngest } from '../src/index';
registerSuite(ingestScenarios((d) => createIngest(d), fixtureChunker));
