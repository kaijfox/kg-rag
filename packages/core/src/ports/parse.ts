import type { DocKey, ChunkId } from '../ids';
import type { ChunkRecipeSpec, FormulaView, ParseArtifact, ParseRecipeSpec } from '../model';

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

/**
 * Renders the embedding text of one chunk under a formula view (0.6.0). Pure, synchronous, deterministic; owned by the
 * `chunk` package, called by the ingest embed state (the embedder never sees parse structure). `blockRefs` are the
 * chunk's block refs for the document version (`doc_version_chunks.block_refs`), in reading order; `chunkText` is the
 * stored chunk text. View `full` returns `chunkText`. View `placeholder` walks the chunk's `formula` blocks in reading
 * order and replaces each one's text, found in `chunkText` at or after the end of the previous match, with
 * `[formula]` (formula blocks are never split, so each occurs whole; the walk is positional, not a global search).
 * A formula block whose text cannot be found in order is an `invalid_input` error. The result is the `{text}` that
 * `renderDocument` receives.
 */
export type ChunkViewRenderer = (
  artifact: ParseArtifact,
  blockRefs: readonly string[],
  chunkText: string,
  view: FormulaView,
) => string;
