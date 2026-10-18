import { kgApiConformance, registerSuite } from '@kg/testkit/conformance';
import { miniApiHarness } from '@kg/testkit';
import { createApiHandlers } from '../src/index';
registerSuite(kgApiConformance(() => miniApiHarness((d) => createApiHandlers(d))));
