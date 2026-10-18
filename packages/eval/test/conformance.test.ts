import { evalRunnerConformance, registerSuite } from '@kg/testkit/conformance';
import { runEval } from '../src/index';
registerSuite(evalRunnerConformance(runEval));
