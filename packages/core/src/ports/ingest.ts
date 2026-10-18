import type { BuildId, DocKey, DocVersionId } from '../ids';
import type { Ctx } from './infra';

/**
 * Exactly one of sources / artifacts. Sources are parsed (or found in the artifact cache by sha256 and
 * parse recipe); artifacts are files produced elsewhere (e.g. on a GPU server) and imported.
 * Recipes come from the DatabaseConfig the service was constructed with.
 */
export interface IngestRequest {
  sources?: { path: string; docKey?: string }[];
  artifacts?: { path: string; docKey?: string }[];
}

export interface IngestDocReport {
  docKey: DocKey;
  docVersionId: DocVersionId;
  /** true if the document's current version was already this one */
  unchanged: boolean;
  inserted: number;
  reused: number;
  /** chunks of the previous current version that the new version does not contain */
  dropped: number;
}
export interface IngestReport {
  docs: IngestDocReport[];
  /** the current build after the ingest (unchanged if nothing changed) */
  buildId: BuildId;
  buildChanged: boolean;
}

/**
 * Ingest is a hand-written state machine (package ingest): validate and prepare, then per document identify or
 * import, look up the artifact cache, parse, store the artifact, chunk and embed; then embed other current documents
 * that lack vectors in config.space, check completeness, commit in one transaction and announce. Before composing
 * the build, every chunk of every current doc version (not only the requested documents) is embedded in
 * config.space if it lacks a vector there, so a space switch followed by a partial ingest still yields a complete
 * build. Ingest has no pause or resume: a failed run is started again from the beginning.
 * Invariants (ingestScenarios in testkit):
 * re-ingesting unchanged content writes nothing new and keeps the build id; a failure (parser, embedder)
 * leaves no doc version, no current-pointer change and no build for the failed document; the run is bracketed by
 * pipeline.started and pipeline.finished (the latter names the state where a failed run stopped); per document the
 * events are ingest.started, ingest.parsed, ingest.chunked, ingest.embedded, ingest.completed; after all
 * documents, build.created once if the build changed.
 * Pointer events: ingest.completed carries previousDocVersionId (the document's current version before
 * the ingest, null if none); build.created carries parentId = the previous current build and revert = true when
 * the build already existed (the current build moved back to an existing build; parentId then differs from the
 * stored first-seen builds.parent_id).
 */
export interface IngestService {
  ingest(ctx: Ctx, req: IngestRequest): Promise<IngestReport>;
}
