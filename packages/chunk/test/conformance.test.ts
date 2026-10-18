import { chunkerConformance, registerSuite } from '@kg/testkit/conformance';
import { sectionPack } from '../src/index';
registerSuite(chunkerConformance(sectionPack, { full: true }));
