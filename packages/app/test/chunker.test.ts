import { chunkerConformance, registerSuite } from '@kg/testkit/conformance';
import { sectionPack } from '../src/skeleton/chunker';

registerSuite(chunkerConformance(sectionPack, { full: true }));
