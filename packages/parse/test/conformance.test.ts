import { parserConformance, registerSuite } from '@kg/testkit/conformance';
import { ArtifactDirParser } from '../src/index';
import { makeArtifactDirHarness } from './harness'; // you write this: copies the mini-corpus v1 artifacts
// (testkit miniArtifact) into a temp dir as <name>.kgparse.json.gz and fake source files whose sha256
// you set as the artifacts' sourceSha256 (rewrite sourceSha256 in the copied envelopes accordingly)
registerSuite(parserConformance(() => makeArtifactDirHarness()));
