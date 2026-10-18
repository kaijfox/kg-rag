/**
 * Corpus store port. Synchronous (better-sqlite3 is synchronous; a remote store later is a signature change).
 * Insert-only except two pointers: each document's current version and the current build.
 * Errors are KgError with the codes named per method.
 */
import type { ArtifactId, BuildId, ChunkId, DocKey, DocVersionId, ItemId, RecipeId, SpaceId } from '../ids';
import type {
  AnyItem,
  Build,
  BuildLabel,
  DerivationRun,
  DocVersion,
  EmbeddingSpace,
  EmbeddingSpaceSpec,
  ItemKind,
  Mapping,
  Node,
  ParseArtifact,
  Recipe,
  RecipeSpec,
  StaleReport,
  EvalResultRecord,
  EvalRunRecord,
} from '../model';
import type { EvalRunId } from '../ids';
import type { ChunkDraft } from './parse';

export interface KnnQuery {
  space: SpaceId;
  vector: Float32Array;
  buildId: BuildId;
  kinds: readonly ItemKind[];
  limit: number;
}

export interface CorpusStore {
  // ---- recipes
  /** idempotent; returns recipeId(r) */
  putRecipe(r: RecipeSpec): RecipeId;
  getRecipe(id: RecipeId): Recipe | null;

  // ---- parse artifacts
  /** idempotent; also stores a.recipe; returns artifactId(a.sourceSha256, recipeId(a.recipe)). invalid_input if a fails parseArtifactSchema */
  putArtifact(a: ParseArtifact): ArtifactId;
  getArtifact(id: ArtifactId): ParseArtifact | null;
  findArtifact(sourceSha256: string, parseRecipe: RecipeId): ArtifactId | null;

  // ---- documents and chunks
  /**
   * Writes a doc version and inserts its chunks as items (kind 'chunk', recipeId null, sourceChunkIds [id]).
   * Checks (invalid_input): v.id = docVersionId(v.docKey, v.artifactId, v.chunkRecipeId);
   * v.chunkIds = chunks.map(c => c.id); every draft id = chunkId(v.docKey, sectionPath, text, occurrence).
   * not_found if the artifact or chunk recipe is absent.
   * A chunk ID already present is reused, not rewritten: the first-seen verbatim text and provenance stay
   * on the item; per-version pages and blockRefs are kept with the doc version.
   * Idempotent: an existing doc version id with the same ordered chunk list returns {inserted: [], reused: all}.
   * An existing doc version id with a different chunk list throws immutable_violation (0.4.0, CP-01b): the same
   * artifact and chunk recipe produced other chunks, i.e. the chunker changed without a recipe version bump.
   * Does not change the document's current version.
   */
  putDocVersion(v: Omit<DocVersion, 'createdAt'>, chunks: readonly ChunkDraft[]): { inserted: ChunkId[]; reused: ChunkId[] };
  getDocVersion(id: DocVersionId): DocVersion | null;
  /** one per document that has a current version, sorted by docKey */
  currentDocVersions(): DocVersion[];
  /** not_found if the version is absent; invalid_input if it belongs to another docKey */
  setCurrentDocVersion(docKey: DocKey, v: DocVersionId): void;

  // ---- items
  /**
   * Insert-only for derived items (relations, summaries) and nodes. Same id with identical content is a
   * no-op; same id with different content throws immutable_violation. Chunks are rejected (invalid_input):
   * they enter only through putDocVersion. Every item needs non-empty, sorted, unique sourceChunkIds
   * naming existing chunks (Rule 1).
   */
  putItems(items: readonly AnyItem[], nodes?: readonly Node[]): void;
  /** in the order of ids; unknown ids omitted */
  getItems(ids: readonly ItemId[]): AnyItem[];
  /** items citing any of the chunks (a chunk cites itself), sorted by id */
  itemsBySourceChunk(chunkIds: readonly ChunkId[]): AnyItem[];

  // ---- embeddings
  /** idempotent; validates templates; returns spaceId(s) */
  putSpace(s: EmbeddingSpaceSpec): SpaceId;
  getSpace(id: SpaceId): EmbeddingSpace | null;
  /** the subset of itemIds (in input order) with no vector in the space; unknown items count as missing */
  missingEmbeddings(space: SpaceId, itemIds: readonly ItemId[]): ItemId[];
  /** insert-only; an existing (space, item) row is kept (first writer wins). invalid_input on dims mismatch; not_found on unknown space or item */
  putEmbeddings(space: SpaceId, rows: readonly { itemId: ItemId; vector: Float32Array }[]): void;
  /**
   * Brute-force KNN restricted to items of buildId whose kind is in kinds and that have a vector in the space.
   * score = cosineScore; ordered by sortCandidates; at most limit rows. not_found on unknown build or space.
   */
  knn(q: KnnQuery): { itemId: ItemId; score: number }[];

  // ---- builds
  /**
   * Idempotent; id = buildId(b.manifest, b.itemIds); if the id exists the stored build is kept (parentId of the
   * first write wins). builds.parent_id is first-seen history, not identity; lineage across ingests is in the
   * build.created events (see store card). invalid_input if itemIds are not sorted and unique; not_found if any item, doc version,
   * space or recipe it names is absent; precondition if any item lacks an embedding in any of the manifest's
   * embeddingSpaces (S2: a build never holds items its search cannot see).
   */
  putBuild(b: Omit<Build, 'id' | 'createdAt'>): BuildId;
  getBuild(id: BuildId): Build | null;
  currentBuild(): BuildId | null;
  /** not_found if absent */
  setCurrentBuild(id: BuildId): void;
  /** Insert-only label: a name, once given, always names that build. Same name+build is a no-op; same name, other build: conflict */
  labelBuild(name: string, id: BuildId): BuildLabel;
  getLabel(name: string): BuildLabel | null;
  /** Rule 5 against the current ingest (union of chunks of each document's current version) */
  staleCheck(id: BuildId): StaleReport;

  // ---- set-level derivations (tables exist; v0 writes none)
  putMappings(run: DerivationRun, ms: readonly Mapping[]): void;

  /** Runs fn atomically: if it throws, every write inside it is undone. Nested calls join the outer transaction. */
  transaction<T>(fn: () => T): T;
}

/** Eval persistence. Insert-only. */
export interface EvalRepo {
  /** idempotent for identical content; conflict if runId exists with different content */
  putRun(r: EvalRunRecord): void;
  /** not_found if the run is absent; conflict if (runId, questionId, condition) exists with different content */
  putResult(r: EvalResultRecord): void;
  getRun(runId: EvalRunId): EvalRunRecord | null;
  /** sorted by questionId, then condition */
  results(runId: EvalRunId): EvalResultRecord[];
}
