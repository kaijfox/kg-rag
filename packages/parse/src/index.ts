/**
 * @kg/parse: the two Parser implementations. SubprocessParser runs the kg-parse sidecar CLI; ArtifactDirParser
 * reads artifacts that were produced elsewhere. Depends on @kg/core only.
 */
export { SubprocessParser, type SubprocessParserOptions } from './subprocess';
export { ArtifactDirParser } from './artifactDir';
export { readArtifactFile, validateArtifact } from './artifactFile';
