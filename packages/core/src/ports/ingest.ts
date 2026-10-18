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
 * Orchestrates parse -> chunk -> embed -> store -> build. Before composing the build, every chunk of every
 * current doc version (not only the requested documents) is embedded in config.space if it lacks a vector there,
 * so a space switch followed by a partial ingest still yields a complete build (S2, R-24).
 * Invariants (ingestScenarios in testkit):
 * re-ingesting unchanged content writes nothing new and keeps the build id; a failure (parser, embedder)
 * leaves no doc version, no current-pointer change and no build for the failed document; per document the
 * events are ingest.started, ingest.parsed, ingest.chunked, ingest.embedded, ingest.completed; after all
 * documents, build.created once if the build changed.
 */
export interface IngestService {
  ingest(ctx: Ctx, req: IngestRequest): Promise<IngestReport>;
}
