/**
 * @kg/modules: what a use case swaps. Source adapters, the chunker, the ingest, extraction and search modules, the
 * machines that wire them, and ingest and rebuild. Depends on @kg/kernel only.
 */
export { sectionPack, renderChunkView } from './chunk';
export { readArtifactFile, validateArtifact, type ParseArtifact } from './parse/artifact';
export { ArtifactStore } from './parse/artifacts';
export { defaultAdapters, adapterFor, doclingPdf, markdown, decisionLog, type LoadedDoc, type SourceAdapter } from './adapters';
export { findReplacements, type Entry, type Replacement } from './rules/replaces';
export { checkFact, parseFacts, extractFacts, EXTRACT_SYSTEM } from './modules/extract';
export { MACHINES, createRegistry } from './machines';
export { ingest, rebuild, type BuildOptions, type BuildReport, type RebuildResult } from './build';
export { ollamaEmbedder, ollamaLlm } from './services/ollama';
export type { ModuleServices } from './services';
