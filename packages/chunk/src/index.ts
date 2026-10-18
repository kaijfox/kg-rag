/**
 * @kg/chunk: the section-pack/1 chunker and the chunk view renderer. The only code that reads docling's JSON layout.
 * Depends on @kg/core only. See README.md for the algorithm notes and known gaps.
 */
export { sectionPack } from './chunker';
export { renderChunkView } from './render';
