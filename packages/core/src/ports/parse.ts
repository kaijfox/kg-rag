import type { DocKey, ChunkId } from '../ids';
import type { ChunkRecipeSpec, ParseArtifact, ParseRecipeSpec } from '../model';

export interface SourceRef {
  path: string;
  docKey: DocKey;
  /** sha256 of the file bytes, lowercase hex */
  sha256: string;
}

/**
 * Parsing behind a port, so the sidecar can run locally or on another machine.
 * Implementations: SubprocessParser (runs kg-parse), ArtifactDirParser (reads artifacts copied from elsewhere).
 */
export interface Parser {
  /** Hash a source file's bytes. */
  identify(path: string): Promise<{ sha256: string; sourceName: string }>;
  /**
   * Produce an artifact for src under exactly this recipe. The returned artifact's recipe deep-equals
   * `recipe`, its sourceSha256 equals src.sha256, and it validates against parseArtifactSchema.
   * Throws KgError('upstream') if the parser fails, ('precondition') if the recipe cannot be honoured
   * (e.g. doclingVersion differs from the installed one), ('not_found') if no artifact is available.
   */
  parse(src: SourceRef, recipe: ParseRecipeSpec): Promise<ParseArtifact>;
  /** Read and validate an artifact file (.kgparse.json or .kgparse.json.gz) produced elsewhere. */
  readArtifact(path: string): Promise<ParseArtifact>;
}

export interface ChunkDraft {
  /** chunkId(docKey, sectionPath, text, occurrence), assigned with core's assignChunkIds */
  id: ChunkId;
  /** verbatim docling text of the blocks, joined by "\n\n" */
  text: string;
  sectionPath: string[];
  occurrence: number;
  pages: number[];
  blockRefs: string[];
}

/** Pure, synchronous, deterministic. The only code that knows docling's JSON layout. */
export type Chunker = (artifact: ParseArtifact, docKey: DocKey, recipe: ChunkRecipeSpec) => ChunkDraft[];
