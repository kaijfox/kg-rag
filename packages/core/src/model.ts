/**
 * Core data model. Object types that are hashed (recipes, spaces, manifests, mappings) are `type`
 * aliases, not interfaces, so they stay assignable to Json.
 */
import type {
  ArtifactId,
  BuildId,
  ChunkId,
  DerivedItemId,
  DocKey,
  DocVersionId,
  EvalRunId,
  EvalSetId,
  ItemId,
  MappingId,
  NodeId,
  RecipeId,
  RunId,
  SearchId,
  SessionId,
  SpaceId,
} from './ids';

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
export type JsonObject = { [k: string]: Json };

// ---------------------------------------------------------------- items

export type ItemKind = 'chunk' | 'relation' | 'summary';
export const ITEM_KINDS: readonly ItemKind[] = ['chunk', 'relation', 'summary'];

/** Anything a search returns. */
export interface Item {
  id: ItemId;
  kind: ItemKind;
  /** What is embedded (after conditioning) and what a reader sees. Chunks: verbatim docling text. */
  text: string;
  /** Rule 1. Non-empty, sorted ascending, unique. For a chunk: [its own id]. */
  sourceChunkIds: ChunkId[];
  /** Rule 4. null only for chunks (ground truth; their recipes sit on the DocVersion). */
  recipeId: RecipeId | null;
  meta: JsonObject;
}

export interface Chunk extends Item {
  kind: 'chunk';
  id: ChunkId;
  recipeId: null;
  docKey: DocKey;
  /** Verbatim heading texts, outermost first; [] before the first heading. Also the conditioning headings. */
  sectionPath: string[];
  occurrence: number;
  /** 1-based page numbers from docling provenance, sorted unique. */
  pages: number[];
  /** docling self_refs that contributed, for provenance and debugging only (not in the ID). */
  blockRefs: string[];
}

/** A shared handle for something named in the corpus. No content, no type. v0: none written. */
export interface Node {
  id: NodeId;
  name: string;
}
export interface NodeRef {
  nodeId: NodeId;
  surface: string;
  role: string | null;
}
export interface Relation extends Item {
  kind: 'relation';
  id: DerivedItemId;
  recipeId: RecipeId;
  nodes: NodeRef[];
}
export interface Summary extends Item {
  kind: 'summary';
  id: DerivedItemId;
  recipeId: RecipeId;
  memberItemIds: ItemId[];
  runId: RunId;
}
export type AnyItem = Chunk | Relation | Summary;

// ---------------------------------------------------------------- mappings (v0: tables only)

/**
 * Every kind reads "fromId <kind> toId" (0.4.0, CP-02):
 * - same-as / duplicate-of: fromId is the same as / a duplicate of toId (toId is the canonical side).
 * - superseded-by: {fromId: old, toId: new} reads "old is superseded by new".
 * - refined-by: {fromId: general, toId: specific} reads "general is refined by specific".
 */
export type MappingKind = 'same-as' | 'duplicate-of' | 'refined-by' | 'superseded-by';
export type Mapping = {
  id: MappingId;
  kind: MappingKind;
  subject: 'node' | 'item';
  fromId: NodeId | ItemId;
  /** canonical / newer / more specific side (see MappingKind for each kind's reading) */
  toId: NodeId | ItemId;
  /** producer and state (set-level) */
  runId: RunId;
  confidence: number | null;
  note: string | null;
};

/** A set-level derivation records its producer and the state it was computed from. */
export type DerivationRun = {
  id: RunId;
  recipeId: RecipeId;
  inputStateHash: string;
  baseBuildId: BuildId | null;
  createdAt: string;
};

// ---------------------------------------------------------------- recipes

export type RecipeKind =
  | 'parse'
  | 'chunk'
  | 'embed'
  | 'search'
  | 'extract'
  | 'equivalence'
  | 'cluster'
  | 'summarize'
  | 'eval-generate'
  | 'eval-judge';

/** ID = recipeId(RecipeSpec) = hash of its canonical JSON. */
export type RecipeSpec = { kind: RecipeKind; version: string; spec: JsonObject };
export type Recipe = RecipeSpec & { id: RecipeId };

export type ParseRecipeSpec = {
  kind: 'parse';
  version: string;
  spec: {
    parser: 'docling';
    doclingVersion: string;
    options: { do_ocr: boolean; do_table_structure: boolean; do_formula_enrichment: false } & JsonObject;
    /**
     * Display-formula decoding (0.6.0). Absent = off: the key is then not part of the hashed spec, so recipes without
     * it keep their ids. Present = the decode-formulas step of the parse sidecar fills in the text of `formula`
     * blocks by cropping each from its page and decoding the image with this model.
     */
    formulaDecoding?: FormulaDecodingSpec;
  };
};

/** How display formulas are decoded (0.6.0). Every field is part of the parse recipe id. */
export type FormulaDecodingSpec = {
  /** decoder model name, e.g. "mlx-community/GLM-OCR-4bit" */
  model: string;
  /** pinned model revision (commit hash or digest) */
  revision: string;
  /** the prompt given to the decoder with each crop */
  prompt: string;
  /** crop margin around the block's bounding box, as a fraction of the box size (docling's default crop expands each side by 0.18) */
  cropMargin: number;
};

export type ChunkRecipeSpec = {
  kind: 'chunk';
  version: string;
  spec: { algorithm: 'section-pack/1'; targetChars: number; maxChars: number; minChars: number };
};

/**
 * A recipe for a pipeline that is a hand-written state machine: which machine (`spec.machine`), which version of that
 * machine (`version`, bumped on any behaviour change), its typed settings, and a pin of its wiring. The recipe id
 * (recipeId) hashes all of it, so two runs are the same recipe only if machine, version, settings, topology and (where
 * present) prompt text all match.
 */
export type MachineRecipeSpec<K extends RecipeKind, S extends JsonObject = JsonObject> = {
  kind: K;
  /** version of the machine code: '1', '2', ... */
  version: string;
  spec: {
    /** machine name, e.g. 'similarity' */
    machine: string;
    /** typed per machine in the package that owns it, validated there */
    settings: S;
    /** 16 hex chars: fingerprint of the machine's states, moves, guard names and step names (computed by @kg/pipeline) */
    topology: string;
    /** only for machines that carry prompt text: sha256 hex of the prompt files */
    promptDigest?: string;
  };
};
export type SearchRecipeSpec = MachineRecipeSpec<'search'>;

/**
 * Plain-data drawing of a machine, for diagrams and for mapping a logged session back onto states. Produced from a
 * machine definition (package pipeline), checked by machineMapSchema / validateMachineMap, never read from live actors.
 */
export type MachineNodeKind = 'work' | 'routing' | 'final';
export type MachineNode = {
  /** state id, unique in the map; equals StepTrace.state for steps run in that state */
  id: string;
  /** enclosing state id, null at the top level */
  parent: string | null;
  kind: MachineNodeKind;
  label: string;
  /** event types this state emits (EventType values) */
  logs: string[];
  /** name of the module call the state makes, null for routing and final states */
  step: string | null;
  /** true when the state is the target of a move that goes backwards (a loop) */
  loop: boolean;
};
export type MachineEdge = {
  from: string;
  to: string;
  event: 'done' | 'error' | 'always';
  /** name of the guard that must hold, null if unguarded */
  guard: string | null;
};
export type MachineMap = {
  machine: string;
  version: string;
  /** same fingerprint as MachineRecipeSpec.spec.topology */
  topology: string;
  /** id of the initial state */
  initial: string;
  nodes: MachineNode[];
  edges: MachineEdge[];
};

/**
 * An embedding space: model plus conditioning templates. Embeddings are keyed by SpaceId, so several
 * variants coexist and item identity never depends on them. Templates: see conditioning.ts.
 */
export type EmbeddingSpaceSpec = {
  /** Ollama model name including tag, e.g. "embeddinggemma:latest". */
  model: string;
  /**
   * Digest of the model weights as reported by Ollama `/api/tags` (`models[].digest`, the hex string without prefix),
   * pinned when the space is created (0.4.0, CP-01a). It enters the SpaceId, so a model update that keeps the tag
   * is a new space. An embedder given a digest must refuse (`precondition`) when the server reports another one.
   * Test doubles with no real model use a fake non-empty digest.
   */
  digest: string;
  dims: number;
  documentTemplate: string;
  queryTemplate: string;
  /**
   * How display formulas enter the embedded text (0.6.0). `placeholder`: a formula block is rendered as `[formula]`;
   * `full`: as its decoded text, i.e. exactly the stored chunk text. Part of the SpaceId, so another view is another
   * space. Has no effect on documents without decoded formulas.
   */
  formulaView: FormulaView;
};
export type FormulaView = 'placeholder' | 'full';
export type EmbeddingSpace = EmbeddingSpaceSpec & { id: SpaceId };

// ---------------------------------------------------------------- parse artifacts

export type ParseStats = {
  pages: number;
  chars: number;
  /** may be [] when the producer did not compute it */
  charsPerPage: number[];
  undecodedFormulas: number;
  elapsedMs: number;
};

/** The portable unit produced by the docling sidecar (anywhere) and imported here. See schemas/parse-artifact.schema.json. */
export type ParseArtifact = {
  format: 'kg-parse-artifact/1';
  sourceSha256: string;
  sourceName: string;
  recipe: ParseRecipeSpec;
  parser: { name: 'docling'; version: string };
  producedAt: string;
  producedOn: string;
  stats: ParseStats;
  /** DoclingDocument.export_to_dict(); opaque outside the `chunk` package. */
  document: JsonObject;
};

// ---------------------------------------------------------------- documents and builds

export interface DocVersion {
  /** docVersionId(docKey, artifactId, chunkRecipeId) */
  id: DocVersionId;
  docKey: DocKey;
  artifactId: ArtifactId;
  chunkRecipeId: RecipeId;
  /** in reading order */
  chunkIds: ChunkId[];
  createdAt: string;
}

export type BuildManifest = {
  /** docKey -> current doc version (canonicalJson sorts keys) */
  docVersions: Record<string, DocVersionId>;
  /** sorted ascending; v0: exactly one */
  embeddingSpaces: SpaceId[];
  searchRecipeId: RecipeId;
  /** sorted; empty in v0 */
  derivedRecipes: RecipeId[];
  /** sorted; empty in v0 */
  mappingRuns: RunId[];
  /** true if the doc versions use more than one parse recipe or more than one chunk recipe */
  mixedRecipes: boolean;
};

/** Content-addressed: id = buildId(manifest). Copies no data. Names are separate, insert-only labels. */
export interface Build {
  id: BuildId;
  createdAt: string;
  parentId: BuildId | null;
  manifest: BuildManifest;
  /** chunks of the doc versions plus derived items; sorted ascending */
  itemIds: ItemId[];
}
export interface BuildLabel {
  name: string;
  buildId: BuildId;
  createdAt: string;
}

/** Rule 5. "Current ingest" = union of chunk IDs over every document's current version. */
export interface StaleReport {
  buildId: BuildId;
  /** source chunks of the build's items that are absent from the current ingest; sorted */
  missingChunkIds: ChunkId[];
  stale: boolean;
}

// ---------------------------------------------------------------- search results

export interface SearchResult {
  itemId: ItemId;
  kind: ItemKind;
  text: string;
  score: number;
  /** 1-based, contiguous */
  rank: number;
  sourceChunkIds: ChunkId[];
}
export interface SearchResponse {
  searchId: SearchId;
  buildId: BuildId;
  /** Rule 5: true if the build searched references chunks outside the current ingest */
  stale: boolean;
  items: SearchResult[];
}

// ---------------------------------------------------------------- sessions and notes

export type SessionKind = 'agent' | 'eval' | 'cli' | 'test';
export interface SessionSummary {
  sessionId: SessionId;
  kind: SessionKind;
  label: string | null;
  startedAt: string;
  lastEventAt: string;
  eventCount: number;
}
export interface SessionNote {
  noteId: number;
  sessionId: SessionId;
  ts: string;
  text: string;
}

export type Relevance = 0 | 1 | 2; // not relevant / partly relevant / relevant

// ---------------------------------------------------------------- eval

export type QuestionType = 'single-hop' | 'multi-hop' | 'topic' | 'exact-term';
export type EvalQuestion = {
  id: string;
  type: QuestionType;
  question: string;
  referenceAnswer: string;
  /** unique, sorted */
  goldChunkIds: ChunkId[];
  /** gold passages verbatim, so cross-corpus runs need no access to the source database */
  goldText: string[];
  sourceDocKeys: DocKey[];
};
/** Stored as canonical JSON in evals/<id>.json; id = evalSetId(questions). */
export type EvalSet = {
  id: EvalSetId;
  name: string;
  genRecipeId: RecipeId | null;
  questions: EvalQuestion[];
};
/** Boundary between eval prompts (11b) and eval metrics/runner (11a). */
export type QuestionDraft = Omit<EvalQuestion, 'id'>;
export type JudgeVerdict = { score: number; rationale: string; raw: string }; // score in [0, 1]
/** Standard condition names; open strings so oracle variants can be added later. */
export type EvalCondition = 'no-context' | 'gold' | 'retrieved' | 'oracle-gold-first' | (string & {});

export interface EvalRunRecord {
  runId: EvalRunId;
  evalSetId: EvalSetId;
  evalSetSha256: string;
  buildId: BuildId;
  sessionId: SessionId;
  config: JsonObject;
  createdAt: string;
}
export interface EvalResultRecord {
  runId: EvalRunId;
  questionId: string;
  condition: EvalCondition;
  searchId: SearchId | null;
  /** item IDs in rank order */
  retrieved: ItemId[] | null;
  /** recall@k by k, e.g. {"1":0.5,"5":1} */
  recall: Record<string, number> | null;
  answer: string | null;
  judgeScore: number | null;
  judgeRaw: string | null;
}

// ---------------------------------------------------------------- database configuration

/** Per-database configuration given to ingest at construction (v0: from the app config file). */
export type DatabaseConfig = {
  parseRecipe: ParseRecipeSpec;
  chunkRecipe: ChunkRecipeSpec;
  space: EmbeddingSpaceSpec;
  searchRecipe: SearchRecipeSpec;
};
