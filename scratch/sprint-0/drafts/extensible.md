# v0 architecture draft: extensibility lens

Lens: later layers (relations, graph walk, equivalence, reranking, query refinement, community summaries, recipes and builds) should join by **adding** packages, item kinds, producers, search steps and recipes, and by changing only the composition root. Four mechanisms carry that:

1. **One generic item model.** Chunks, relations and summaries share one `items` table with `kind` + typed `attrs`, plus `item_sources` (to chunks) and `item_inputs` (to immediate inputs). Kind-specific TS types are added by the layer package through module augmentation, not by editing core.
2. **One derivation runner.** Every derived thing (v0: embeddings; later relations, nodes, mappings, summaries) is written by a registered `Producer` through one runner that derives IDs, writes provenance, records the run and emits events. v0 exercises it with embeddings so the path is proven before the relation layer uses it.
3. **One build-scoped read view.** Every consumer (search steps, eval, tools) reads derived data through `BuildView`, which already exposes `canonical`, `equivalents`, `sourcesOf`, `nodesOf`, `itemsOfNode` and `links`. In v0 those return identities and empty sets. Equivalence and the graph fill them later without changing callers.
4. **One search pipeline of registered steps** over a shared `SearchState` with named candidate pools, specified as a recipe, with logging done by the runner. New retrieval behaviour is a new step plus a new pipeline recipe.

Where this still breaks is listed in section 10 and in the risk.

---

## 1. Packages and dependency directions

pnpm workspace, `packages/*`, plus `sidecars/docling` (Python).

| Package | Owns | May import |
|---|---|---|
| `@kg/contracts` | All shared types, interfaces, ID derivation, canonical JSON, hashing, registries (kinds, events, steps, producers, services). No I/O. | nothing (zod only) |
| `@kg/store` | SQLite schema + migrations, repositories, `BuildView` impl, immutability triggers, KNN via sqlite-vec | contracts |
| `@kg/parse` | `Parser` impl: HTTP client for the sidecar, parse-artifact read/write/verify, artifact import | contracts |
| `@kg/chunk` | `Chunker` impl: calls sidecar `/chunk` on an artifact, normalizes drafts, derives chunk IDs | contracts |
| `@kg/embed` | `Embedder` impl (Ollama HTTP), the embedding `Producer` | contracts |
| `@kg/derive` | Producer runner (local and set-level), derivation cache, run records | contracts |
| `@kg/build` | `BuildService`: create/pin builds, carry-forward on re-ingest, staleness reports | contracts |
| `@kg/ingest` | Orchestration: file → artifact → chunks → store → embed → new build | contracts |
| `@kg/search` | Pipeline runner, step registry, v0 steps | contracts |
| `@kg/llm` | `LlmClient` impls (Anthropic, Ollama) | contracts |
| `@kg/tools` | Tool handlers (search, feedback, usage, outcome, ingest, note) with logging built in; `Recorder` | contracts |
| `@kg/mcp` | MCP server: thin adapter from MCP transport to `@kg/tools` | contracts |
| `@kg/eval` | Question generation, eval runner, judge, metrics | contracts |
| `@kg/viewer` | Read-only HTTP server + static page over `StoreReader` | contracts |
| `@kg/app` | Composition root: config, database registry, wiring, CLI (`kg ingest`, `kg import`, `kg eval`, `kg serve`) | everything |
| `@kg/testkit` | Fakes, fixtures, conformance suites | contracts (+ store for the real-sqlite test harness) |

**Rule: implementation packages import only `@kg/contracts`. Only `@kg/app` (and `@kg/testkit` for store) imports implementations.** Enforced by `dependency-cruiser` in CI.

```
                         @kg/contracts
   ┌────────┬────────┬───────┼────────┬────────┬───────┬───────┐
 store   parse   chunk   embed   derive  build  search  tools  eval viewer mcp llm
   └────────┴────────┴───────┴────────┴────────┴───────┴───────┘
                              @kg/app  (only importer of implementations)
```

Extension consequence: a new layer is a new package `@kg/<layer>` importing contracts, plus registrations in `@kg/app`. Additive files may be added to `@kg/contracts` (new interface files); existing ones should not change.

---

## 2. Core data model

```ts
// @kg/contracts/src/ids.ts
type Brand<T, B extends string> = T & { readonly __brand: B };
export type ItemId       = Brand<string, 'ItemId'>;      // "it_<20 hex>"  (chunks: "ch_<20 hex>")
export type ChunkId      = ItemId & { readonly __chunk: true };
export type NodeId       = Brand<string, 'NodeId'>;      // "nd_..."
export type RecipeId     = Brand<string, 'RecipeId'>;    // "rc_..."
export type BuildId      = Brand<string, 'BuildId'>;     // "bd_..." (random ULID; builds are named events, not content)
export type MappingId    = Brand<string, 'MappingId'>;   // "mp_..."
export type MappingSetId = Brand<string, 'MappingSetId'>;
export type RunId        = Brand<string, 'RunId'>;       // ULID
export type SpaceId      = Brand<string, 'SpaceId'>;     // "sp_..." embedding space
export type IngestId     = Brand<string, 'IngestId'>;    // ULID
export type SessionId    = Brand<string, 'SessionId'>;   // ULID
export type SearchId     = Brand<string, 'SearchId'>;    // ULID
export type EventId      = Brand<string, 'EventId'>;     // ULID
export type DocKey       = Brand<string, 'DocKey'>;      // stable document identity, see below
export type FileHash     = Brand<string, 'FileHash'>;    // sha256 of source bytes

/** h(prefix, ...parts) = prefix + "_" + sha256(parts joined by "\u001f")[:20 hex] */
export function h(prefix: string, ...parts: string[]): string;
/** RFC 8785 canonical JSON, used for every hashed spec. */
export function canonicalJson(v: unknown): string;
```

### ID derivation

| Object | ID | Notes |
|---|---|---|
| Recipe | `h('rc', canonicalJson({kind, producer, version, params}))` | content-addressed; same spec = same recipe |
| Chunk | `h('ch', docKey, headingPathNorm, textHash, String(dupOrdinal))` | see below |
| Derived item | `h('it', recipeId, sortedInputIds.join(','), textHash)` | textHash added; see Conflicts |
| Node | `h('nd', normalizerVersion, normalizeName(name))` | no recipe; shared across recipes |
| Mapping | `h('mp', setId, relation, fromId, toId)` | |
| Embedding space | `h('sp', model, conditioningRecipeId, targetKind, inputBuildId ?? '')` | inputBuildId only for set-level conditioning |
| Parse artifact | `h('pa', fileHash, parserRecipeId)` | |

**Chunk ID scheme.** `textHash = sha256(nfc(collapseWhitespace(text)))`. `headingPathNorm` = the chunk's docling heading path, each heading lowercased, whitespace-collapsed and stripped of leading section numbering (`/^[\dA-Z]+(\.\d+)*\.?\s+/`), joined by `" > "`. `dupOrdinal` = number of earlier chunks in the same document with the same `(headingPathNorm, textHash)` (almost always 0).

Properties:
- Re-ingesting unchanged content: identical IDs (no position counter enters the ID).
- Insertion early in a document: only chunks whose text changes get new IDs. Chunks after the insertion keep their IDs, even in the same section, because no ordinal enters the ID. The chunker may re-split the boundaries next to the insertion, which changes those one or two chunks only. This beats both global-index and section-ordinal schemes.
- Inserting a new numbered chapter does not rename later chapters, because numbering is stripped.
- `ord` (global order), page span and prev/next are **attributes** of a chunk under a given document version, stored in `chunk_positions`, never part of the ID. Adjacent-chunk expansion uses them.
- `docKey` is the source's stable identity (default: path relative to the database's source root; overridable in config). A renamed file gets new chunk IDs unless the user keeps its key. See decisions D3.
- The chunker recipe is **not** in the chunk ID. A chunker change that leaves a chunk's text and heading unchanged keeps its ID, so the eval set survives harmless upgrades; a change that alters text produces new IDs, as the design requires.

### Types

```ts
// @kg/contracts/src/items.ts
/** Kind registry. Layers add kinds by module augmentation:
 *  declare module '@kg/contracts' { interface ItemKinds { relation: RelationAttrs } } */
export interface ItemKinds {
  chunk: ChunkAttrs;
}
export type ItemKind = keyof ItemKinds & string;

export interface ChunkAttrs {
  docKey: DocKey;
  headingPath: string[];          // as parsed, unnormalized
  dupOrdinal: number;
}

export interface Item<K extends ItemKind = ItemKind> {
  id: K extends 'chunk' ? ChunkId : ItemId;
  kind: K;
  text: string;
  textHash: string;
  recipeId: RecipeId | null;      // null only for chunks (not derived)
  runId: RunId;                   // run that first wrote it
  sourceChunkIds: ChunkId[];      // Rule 1; for a chunk, [its own id]
  inputIds: ItemId[];             // immediate inputs (relation -> chunk, summary -> relations)
  attrs: ItemKinds[K];
  createdAt: string;
}
export type Chunk = Item<'chunk'>;

/** Stored per document version, not part of identity. */
export interface ChunkPosition {
  chunkId: ChunkId;
  docKey: DocKey;
  parseArtifactId: string;
  chunkRecipeId: RecipeId;
  ord: number;
  pageStart: number | null;
  pageEnd: number | null;
  prevChunkId: ChunkId | null;
  nextChunkId: ChunkId | null;
}

// v0 creates none of these; tables exist.
export interface Node {
  id: NodeId;
  normName: string;
  normalizerVersion: string;
  createdAt: string;
}
export interface NodeLink { itemId: ItemId; nodeId: NodeId; role: string | null; surfaceForm: string }

/** Relation attrs are declared by @kg/relations, shown here for reference only. */
// interface RelationAttrs { qualifiers?: Record<string, string>; relationType?: string }

export type MappingRelation = 'same' | 'duplicate' | 'refines' | 'supersedes' | 'distinct';
export interface Mapping {
  id: MappingId;
  setId: MappingSetId;
  relation: MappingRelation;      // 'distinct' records a negative verdict so it is not re-asked
  subject: 'node' | 'item';
  fromId: string;                 // NodeId | ItemId
  toId: string;                   // canonical side for same/duplicate; newer/finer side for refines/supersedes
  confidence: number | null;
  evidence: unknown;              // judge output, similarity, etc.
  createdAt: string;
}
export interface MappingSet {
  id: MappingSetId;
  recipeId: RecipeId;
  runId: RunId;
  inputBuildId: BuildId;          // the state it was computed from (set-level)
  parentSetId: MappingSetId | null; // incremental chain
  createdAt: string;
}

// @kg/contracts/src/recipes.ts
export type RecipeKind =
  | 'parse' | 'chunk' | 'embed-conditioning' | 'search-pipeline'
  | 'derive' /* relation extraction, summaries, ... */ | 'mapping' | 'eval-gen' | 'judge';
export interface Recipe<P = unknown> {
  id: RecipeId;
  kind: RecipeKind;
  producer: string;               // registry name, e.g. 'docling', 'hybrid-chunker', 'ollama-embed', 'relation-extract'
  version: string;                // producer code version; bump = new recipe
  params: P;                      // models, prompts (full text, not refs), config
  scope: 'local' | 'set';
}

export interface Run {
  id: RunId;
  recipeId: RecipeId;
  scope: 'local' | 'set';
  inputBuildId: BuildId | null;   // required for set-level
  status: 'running' | 'done' | 'failed';
  startedAt: string; finishedAt: string | null;
  stats: Record<string, number>;
}

// @kg/contracts/src/builds.ts
export interface Build {
  id: BuildId;
  name: string | null;
  parentBuildId: BuildId | null;
  ingestId: IngestId;             // the chunk snapshot it is defined against
  recipeIds: RecipeId[];          // derived from members; >1 per kind => mixed
  mixedRecipes: boolean;
  spaces: Partial<Record<ItemKind | 'node', SpaceId>>; // which embedding space serves each kind
  mappingSetIds: MappingSetId[];  // mapping state pinned by this build
  defaultPipelineId: RecipeId;    // search pipeline recipe
  createdAt: string;
  note: string | null;
}
/** Membership is explicit: build_members(build_id, item_id). Copies IDs, not data. */

export interface Ingest {
  id: IngestId;
  parentIngestId: IngestId | null;
  docs: { docKey: DocKey; fileHash: FileHash; parseArtifactId: string; chunkRecipeId: RecipeId }[];
  createdAt: string;
}

export interface StaleReport {
  buildId: BuildId; againstIngestId: IngestId;
  missingChunkIds: ChunkId[];
  affectedItemIds: ItemId[];      // members citing a missing chunk
  stale: boolean;
}

// @kg/contracts/src/embeddings.ts
export interface EmbeddingSpace {
  id: SpaceId;
  model: string;                  // e.g. 'nomic-embed-text:v1.5'
  dims: number;
  conditioningRecipeId: RecipeId; // e.g. {template:'{headings}\n\n{text}', prefix:'search_document: '}
  targetKind: ItemKind | 'node';
  inputBuildId: BuildId | null;   // non-null when conditioning reads set-level context (contextual node embeddings)
}

// @kg/contracts/src/search.ts
export interface SearchRequest {
  db: string;
  query: string;
  k: number;
  buildId?: BuildId;              // default: db's 'current' pointer
  pipelineId?: RecipeId;          // default: build.defaultPipelineId
  options?: Record<string, unknown>; // granularity controls etc., validated by the pipeline's steps
  parentSearchId?: SearchId;      // follow-up / refinement chains
}
export interface ResultItem {
  id: ItemId;
  kind: ItemKind;
  text: string;
  score: number;
  sourceChunkIds: ChunkId[];
  attrs?: Record<string, unknown>;  // e.g. headingPath, page, docKey; summary level later
  expandedFrom?: ItemId;            // set when a step expanded e.g. relation -> chunk
}
export interface SearchResult {
  searchId: SearchId;
  buildId: BuildId;
  pipelineId: RecipeId;
  stale: boolean;
  items: ResultItem[];
}
```

`Event` is in section 5.

---

## 3. Interfaces between packages

```ts
// ---------- parsing (@kg/contracts/src/parse.ts) ----------
export interface ParseRecipeParams {
  doclingVersion: string;         // pinned; sidecar refuses a mismatch
  doOcr: boolean;                 // default false
  doFormulaEnrichment: boolean;   // false in v0
  device: 'cpu' | 'mps' | 'cuda';
  extra?: Record<string, unknown>;
}
export interface Parser {
  parse(file: { path: string; fileHash: FileHash }, recipe: Recipe<ParseRecipeParams>): Promise<ParseArtifact>;
}
export interface ArtifactStore {             // implemented by @kg/store (blobs in the db file)
  get(fileHash: FileHash, recipeId: RecipeId): Promise<ParseArtifact | null>;
  put(a: ParseArtifact): Promise<void>;      // verifies envelope hash
}
/** Future: QualityGate inspects an artifact and proposes an escalation recipe. Interface reserved. */
export interface ParseQualityGate {
  assess(a: ParseArtifact): Promise<{ ok: boolean; metrics: Record<string, number>; escalateTo?: Recipe<ParseRecipeParams> }>;
}

// ---------- chunking ----------
export interface ChunkRecipeParams { chunker: 'hybrid'; doclingCoreVersion: string; tokenizer: string; maxTokens: number; mergePeers: boolean }
export interface ChunkDraft { text: string; headingPath: string[]; pageStart: number | null; pageEnd: number | null; docItemRefs: string[] }
export interface Chunker {
  chunk(a: ParseArtifact, recipe: Recipe<ChunkRecipeParams>): Promise<ChunkDraft[]>;
}
/** Pure, in contracts so every package derives the same IDs. */
export function assignChunkIds(docKey: DocKey, drafts: ChunkDraft[]): { id: ChunkId; draft: ChunkDraft; dupOrdinal: number; ord: number }[];

// ---------- embedding ----------
export interface Embedder {
  readonly model: string;
  readonly dims: number;
  embed(texts: string[], role: 'document' | 'query'): Promise<Float32Array[]>;
}
export interface Conditioner<T = unknown> {   // turns an item (+ context) into the text to embed
  condition(item: Item, ctx: { view: BuildView }): Promise<string>;
}

// ---------- LLM ----------
export interface LlmClient {
  complete(req: { model: string; system?: string; messages: { role: 'user' | 'assistant'; content: string }[]; json?: boolean; maxTokens: number; temperature?: number }): Promise<{ text: string; usage: { in: number; out: number } }>;
}

// ---------- store (repositories) ----------
export interface ItemRepo {
  putItems(items: Item[]): Promise<void>;     // INSERT OR IGNORE; rows immutable
  get(ids: ItemId[]): Promise<Item[]>;
  bySource(chunkId: ChunkId, kind?: ItemKind): Promise<ItemId[]>;
  byInput(inputId: ItemId, kind?: ItemKind): Promise<ItemId[]>;
}
export interface NodeRepo {
  putNodes(nodes: Node[], links: NodeLink[]): Promise<void>;
  nodesOf(itemId: ItemId): Promise<NodeLink[]>;
  itemsOf(nodeId: NodeId): Promise<NodeLink[]>;
}
export interface EmbeddingRepo {
  ensureSpace(s: Omit<EmbeddingSpace, 'id'>): Promise<EmbeddingSpace>;
  put(space: SpaceId, rows: { targetId: string; vector: Float32Array }[]): Promise<void>;
  missing(space: SpaceId, targetIds: string[]): Promise<string[]>;
  knn(space: SpaceId, q: Float32Array, k: number, restrictTo: { buildId: BuildId } | { ids: string[] }): Promise<{ id: string; score: number }[]>;
}
export interface MappingRepo {
  putSet(set: MappingSet, mappings: Mapping[]): Promise<void>;
  bySets(setIds: MappingSetId[]): Promise<Mapping[]>;
}
export interface RunRepo {
  start(r: Omit<Run, 'status' | 'finishedAt' | 'stats'>): Promise<void>;
  finish(id: RunId, status: 'done' | 'failed', stats: Record<string, number>): Promise<void>;
  cached(recipeId: RecipeId, inputKey: string): Promise<ItemId[] | null>;
  recordDerivation(recipeId: RecipeId, inputKey: string, runId: RunId, outputIds: ItemId[]): Promise<void>;
}
export interface BuildRepo { /* create, members add/list, pointer get/set, ingest snapshots */ }
export interface EventSink { append(e: NewEvent): Promise<Event>; }
export interface StoreReader { /* read-only: sessions, events since seq, items, builds; used by viewer and analysis */ }

export interface Store {
  items: ItemRepo; nodes: NodeRepo; embeddings: EmbeddingRepo; mappings: MappingRepo;
  runs: RunRepo; builds: BuildRepo; artifacts: ArtifactStore; events: EventSink; reader: StoreReader;
  recipes: { put(r: Recipe): Promise<void>; get(id: RecipeId): Promise<Recipe> };
  view(buildId: BuildId): Promise<BuildView>;
  tx<T>(fn: () => T): T;
}

// ---------- the build-scoped view: the single read path for derived data ----------
export interface BuildView {
  readonly build: Build;
  has(id: ItemId): boolean;
  items<K extends ItemKind>(kind: K): AsyncIterable<Item<K>>;
  get(ids: ItemId[]): Promise<Item[]>;
  /** Union of sources over the item's equivalence class (v0: its own sources). */
  sourcesOf(id: ItemId): Promise<ChunkId[]>;
  itemsCiting(chunkId: ChunkId, kind?: ItemKind): Promise<ItemId[]>;
  /** Equivalence resolution under build.mappingSetIds (v0: identity / [id] / []). */
  canonical(id: ItemId | NodeId): string;
  equivalents(id: ItemId | NodeId): string[];
  links(id: ItemId, rel?: 'refines' | 'supersedes'): Mapping[];
  /** Graph access (v0: empty). Returns canonical ids. */
  nodesOf(itemId: ItemId): Promise<NodeLink[]>;
  itemsOfNode(nodeId: NodeId): Promise<NodeLink[]>;
  adjacentChunks(chunkId: ChunkId, radius: number): Promise<ChunkId[]>;
  space(kind: ItemKind | 'node'): SpaceId | undefined;
  knn(space: SpaceId, q: Float32Array, k: number): Promise<{ id: string; score: number }[]>; // restricted to members
}

// ---------- derivation (@kg/contracts/src/derive.ts) ----------
export interface DerivedDraft {
  kind: ItemKind;
  text: string;
  attrs: unknown;
  inputIds: ItemId[];
  sourceChunkIds?: ChunkId[];     // default: union of inputs' sourcesOf
  nodes?: { name: string; role?: string; surfaceForm: string }[];
}
export interface ProducerContext {
  view: BuildView;                // input state
  llm?: LlmClient;
  embedder?: Embedder;
  services: Services;             // see below
  recorder: Recorder;
  signal: AbortSignal;
}
export interface LocalProducer<P = unknown> {
  name: string; version: string; scope: 'local';
  /** Groups of inputs, each processed independently (v0 embedding: one item per group). */
  inputs(view: BuildView, recipe: Recipe<P>): AsyncIterable<Item[]>;
  produce(inputs: Item[], recipe: Recipe<P>, ctx: ProducerContext): Promise<ProducerOutput>;
}
export interface SetProducer<P = unknown> {
  name: string; version: string; scope: 'set';
  produce(recipe: Recipe<P>, ctx: ProducerContext): Promise<ProducerOutput>;
}
export interface ProducerOutput {
  items?: DerivedDraft[];
  mappings?: Omit<Mapping, 'id' | 'setId' | 'createdAt'>[];
  embeddings?: { space: Omit<EmbeddingSpace, 'id'>; rows: { targetId: string; vector: Float32Array }[] };
}
export interface DeriveRunner {
  /** Runs a recipe against a build; local producers skip cached (recipe, inputKey) pairs.
   *  Returns the run and the new item/mapping-set ids, which BuildService can add to a new build. */
  run(recipe: Recipe, buildId: BuildId, opts?: { only?: ChunkId[]; force?: boolean }): Promise<{ run: Run; itemIds: ItemId[]; mappingSetId?: MappingSetId; spaceId?: SpaceId }>;
}

// ---------- builds ----------
export interface BuildService {
  /** v0 path: after an ingest, carry forward members whose sources are all in the new ingest, add new chunks,
   *  run the db's configured local recipes on new chunks, and point 'current' at the result (configurable). */
  fromIngest(ingestId: IngestId, opts?: { setCurrent?: boolean }): Promise<Build>;
  derive(from: BuildId, change: { addItems?: ItemId[]; removeItems?: ItemId[]; spaces?: Build['spaces']; mappingSetIds?: MappingSetId[]; defaultPipelineId?: RecipeId; name?: string; note?: string }): Promise<Build>;
  stale(buildId: BuildId, ingestId?: IngestId): Promise<StaleReport>;
  setPointer(name: 'current' | string, buildId: BuildId): Promise<void>;
}

// ---------- search pipeline (@kg/contracts/src/pipeline.ts) ----------
export interface QueryVariant { id: string; text: string; origin: 'user' | string; parentId?: string; vectors: Partial<Record<SpaceId, Float32Array>> }
export interface Candidate {
  id: ItemId | NodeId;
  kind: ItemKind | 'node';
  score: number;
  channel: string;                // which step/pool produced it
  queryId: string;
  provenance?: Record<string, unknown>;
}
export interface SearchState {
  readonly request: SearchRequest;
  readonly searchId: SearchId;
  queries: QueryVariant[];
  pools: Record<string, Candidate[]>;   // named, e.g. 'chunks', later 'relations', 'nodes', 'summaries', 'walk'
  candidates: Candidate[];              // the current ranked list
  result?: ResultItem[];                // set by 'hydrate'
}
export interface StepContext {
  view: BuildView;
  services: Services;
  recorder: Recorder;
  /** Runs a nested pipeline (critique loops, decomposition); logged as a child search. */
  subsearch(req: SearchRequest): Promise<SearchResult>;
  signal: AbortSignal;
}
export interface StepOutcome { trace?: unknown }        // step-specific extra log payload (walk seeds, rewrite prompts...)
export interface Step {
  readonly name: string;
  run(state: SearchState, ctx: StepContext): Promise<StepOutcome | void>;
}
export interface StepFactory<P = unknown> { name: string; paramsSchema: ZodType<P>; create(params: P): Step }

/** Pipeline recipe params. Composite steps ('loop', 'parallel') hold nested specs. */
export interface PipelineSpec { steps: { use: string; params?: unknown; as?: string }[] }

export interface SearchService {
  search(req: SearchRequest, recorder: Recorder): Promise<SearchResult>;
}

// ---------- services and registries ----------
/** Typed service map, augmented by layers: declare module '@kg/contracts' { interface ServiceMap { graph: GraphSource } } */
export interface ServiceMap { embedder: Embedder; llm: LlmClient }
export interface Services { get<K extends keyof ServiceMap>(k: K): ServiceMap[K]; has(k: keyof ServiceMap): boolean }
export interface Registry {
  steps: Map<string, StepFactory>;
  producers: Map<string, LocalProducer | SetProducer>;
  conditioners: Map<string, Conditioner>;
  kinds: Map<string, { attrsSchema: ZodType; scoredAs: 'chunk-recall' | 'separate' }>;
}

// ---------- tools (@kg/contracts/src/tools.ts) ----------
export type Relevance = 0 | 1 | 2;   // irrelevant, partial, relevant
export interface SessionHandle { id: SessionId; kind: 'agent' | 'eval' | 'cli'; recorder: Recorder }
export interface Tools {
  search(a: SearchRequest, s: SessionHandle): Promise<SearchResult>;
  feedback(a: { searchId: SearchId; overall?: Relevance; items?: { itemId: ItemId; relevance: Relevance; note?: string }[]; note?: string }, s: SessionHandle): Promise<void>;
  usage(a: { searchId: SearchId; itemIds: ItemId[]; how: string }, s: SessionHandle): Promise<void>;
  outcome(a: { searchIds?: SearchId[]; worked: 'yes' | 'partial' | 'no'; note?: string }, s: SessionHandle): Promise<void>;
  ingest(a: { db: string; paths?: string[]; artifacts?: string[] }, s: SessionHandle): Promise<{ ingestId: IngestId; buildId: BuildId }>;
  note(a: { sessionId: SessionId; text: string }, s: SessionHandle): Promise<void>;
}
```

### Search pipeline in v0

The v0 pipeline recipe (`kind: 'search-pipeline'`):

```json
{ "steps": [
  { "use": "embed-query" },
  { "use": "knn", "params": { "kind": "chunk", "k": 100 }, "as": "chunks" },
  { "use": "fuse", "params": { "method": "rrf", "pools": ["chunks"] } },
  { "use": "truncate", "params": { "k": "$request.k" } },
  { "use": "hydrate" }
]}
```

The runner (`@kg/search`):
1. allocates `searchId`, resolves build and pipeline, writes `search.request`;
2. for each step (path `"1"`, `"2"`, nested `"3.1"`), runs it, then writes one `search.step` event with the diff it can observe: queries added, each pool touched, the `candidates` list (`id, kind, score, rank, channel, queryId`), counts in/out, `params`, the step's `trace`, and duration;
3. writes `search.result` with the returned items and their source chunk IDs, and the stale flag.

Steps never write events themselves except through `trace`. This makes step logging uniform and impossible to forget, and later steps (walk seeds, rerank scores) appear in the same shape. `fuse` with one pool is trivial in v0 but fixes the multi-channel shape now. Oracle conditions for eval (gold first, gold relations supplied) are a step `oracle-inject` reading `options.oracle`, so later layers' oracle variants are also just steps.

---

## 4. SQLite schema

One file per database, WAL mode (viewer reads concurrently). Immutability enforced by triggers.

```sql
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);       -- schema_version, db config json
CREATE TABLE recipes (id TEXT PRIMARY KEY, kind TEXT NOT NULL, producer TEXT NOT NULL, version TEXT NOT NULL,
  scope TEXT NOT NULL, spec_json TEXT NOT NULL, created_at TEXT NOT NULL);

-- sources and parsing
CREATE TABLE source_files (file_hash TEXT PRIMARY KEY, byte_size INTEGER, first_seen_path TEXT, seen_at TEXT);
CREATE TABLE parse_artifacts (id TEXT PRIMARY KEY, file_hash TEXT NOT NULL, parser_recipe_id TEXT NOT NULL,
  envelope_json TEXT NOT NULL,       -- artifact minus document
  document_gz BLOB NOT NULL,         -- gzip(docling JSON)
  sha256 TEXT NOT NULL, produced_where TEXT, created_at TEXT NOT NULL,
  UNIQUE (file_hash, parser_recipe_id));
CREATE TABLE ingests (id TEXT PRIMARY KEY, parent_ingest_id TEXT, created_at TEXT NOT NULL, note TEXT);
CREATE TABLE ingest_docs (ingest_id TEXT NOT NULL, doc_key TEXT NOT NULL, file_hash TEXT NOT NULL,
  parse_artifact_id TEXT NOT NULL, chunk_recipe_id TEXT NOT NULL, PRIMARY KEY (ingest_id, doc_key));
CREATE TABLE ingest_chunks (ingest_id TEXT NOT NULL, chunk_id TEXT NOT NULL, PRIMARY KEY (ingest_id, chunk_id));

-- items (chunks + all derived kinds)
CREATE TABLE items (id TEXT PRIMARY KEY, kind TEXT NOT NULL, text TEXT NOT NULL, text_hash TEXT NOT NULL,
  recipe_id TEXT, run_id TEXT NOT NULL, attrs_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL);
CREATE INDEX items_kind ON items(kind);
CREATE INDEX items_recipe ON items(recipe_id);
CREATE TABLE item_sources (item_id TEXT NOT NULL, chunk_id TEXT NOT NULL, PRIMARY KEY (item_id, chunk_id)) WITHOUT ROWID;
CREATE INDEX item_sources_rev ON item_sources(chunk_id, item_id);
CREATE TABLE item_inputs (item_id TEXT NOT NULL, input_id TEXT NOT NULL, role TEXT, PRIMARY KEY (item_id, input_id)) WITHOUT ROWID;
CREATE INDEX item_inputs_rev ON item_inputs(input_id, item_id);
CREATE TABLE chunk_positions (chunk_id TEXT NOT NULL, doc_key TEXT NOT NULL, parse_artifact_id TEXT NOT NULL,
  chunk_recipe_id TEXT NOT NULL, ord INTEGER NOT NULL, page_start INTEGER, page_end INTEGER,
  prev_chunk_id TEXT, next_chunk_id TEXT, PRIMARY KEY (chunk_id, parse_artifact_id, chunk_recipe_id));
CREATE INDEX chunk_positions_doc ON chunk_positions(doc_key, parse_artifact_id, chunk_recipe_id, ord);

-- graph (empty in v0)
CREATE TABLE nodes (id TEXT PRIMARY KEY, norm_name TEXT NOT NULL, normalizer_version TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE item_nodes (item_id TEXT NOT NULL, node_id TEXT NOT NULL, role TEXT, surface_form TEXT NOT NULL,
  PRIMARY KEY (item_id, node_id, surface_form)) WITHOUT ROWID;
CREATE INDEX item_nodes_rev ON item_nodes(node_id, item_id);

-- derivation bookkeeping
CREATE TABLE runs (id TEXT PRIMARY KEY, recipe_id TEXT NOT NULL, scope TEXT NOT NULL, input_build_id TEXT,
  status TEXT NOT NULL, started_at TEXT NOT NULL, finished_at TEXT, stats_json TEXT);
CREATE TABLE derivations (recipe_id TEXT NOT NULL, input_key TEXT NOT NULL, run_id TEXT NOT NULL,
  output_ids_json TEXT NOT NULL, PRIMARY KEY (recipe_id, input_key));

-- embeddings: one plain table, brute-force via sqlite-vec scalar functions
CREATE TABLE embedding_spaces (id TEXT PRIMARY KEY, model TEXT NOT NULL, dims INTEGER NOT NULL,
  conditioning_recipe_id TEXT NOT NULL, target_kind TEXT NOT NULL, input_build_id TEXT, created_at TEXT NOT NULL);
CREATE TABLE embeddings (space_id TEXT NOT NULL, target_id TEXT NOT NULL, vector BLOB NOT NULL, run_id TEXT NOT NULL,
  PRIMARY KEY (space_id, target_id)) WITHOUT ROWID;
-- knn: SELECT e.target_id, vec_distance_cosine(e.vector, :q) d FROM embeddings e
--      JOIN build_members m ON m.item_id = e.target_id AND m.build_id = :b
--      WHERE e.space_id = :s ORDER BY d LIMIT :k;

-- equivalence (empty in v0)
CREATE TABLE mapping_sets (id TEXT PRIMARY KEY, recipe_id TEXT NOT NULL, run_id TEXT NOT NULL,
  input_build_id TEXT NOT NULL, parent_set_id TEXT, created_at TEXT NOT NULL);
CREATE TABLE mappings (id TEXT PRIMARY KEY, set_id TEXT NOT NULL, relation TEXT NOT NULL, subject TEXT NOT NULL,
  from_id TEXT NOT NULL, to_id TEXT NOT NULL, confidence REAL, evidence_json TEXT, created_at TEXT NOT NULL);
CREATE INDEX mappings_from ON mappings(set_id, from_id);
CREATE INDEX mappings_to ON mappings(set_id, to_id);

-- builds
CREATE TABLE builds (id TEXT PRIMARY KEY, name TEXT UNIQUE, parent_build_id TEXT, ingest_id TEXT NOT NULL,
  default_pipeline_id TEXT NOT NULL, mixed_recipes INTEGER NOT NULL, created_at TEXT NOT NULL, note TEXT);
CREATE TABLE build_members (build_id TEXT NOT NULL, item_id TEXT NOT NULL, PRIMARY KEY (build_id, item_id)) WITHOUT ROWID;
CREATE TABLE build_spaces (build_id TEXT NOT NULL, target_kind TEXT NOT NULL, space_id TEXT NOT NULL, PRIMARY KEY (build_id, target_kind));
CREATE TABLE build_mapping_sets (build_id TEXT NOT NULL, mapping_set_id TEXT NOT NULL, PRIMARY KEY (build_id, mapping_set_id));
CREATE TABLE build_pointers (name TEXT PRIMARY KEY, build_id TEXT NOT NULL, updated_at TEXT NOT NULL); -- mutable by design

-- log
CREATE TABLE sessions (id TEXT PRIMARY KEY, kind TEXT NOT NULL, started_at TEXT NOT NULL, client_json TEXT);
CREATE TABLE events (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, session_id TEXT NOT NULL,
  ts TEXT NOT NULL, type TEXT NOT NULL, v INTEGER NOT NULL, build_id TEXT, search_id TEXT, parent_id TEXT,
  payload_json TEXT NOT NULL);
CREATE INDEX events_session ON events(session_id, seq);
CREATE INDEX events_search ON events(search_id, seq);
CREATE INDEX events_type ON events(type, seq);

-- eval
CREATE TABLE eval_sets (id TEXT PRIMARY KEY, name TEXT, gen_recipe_id TEXT NOT NULL, ingest_id TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE eval_questions (id TEXT PRIMARY KEY, set_id TEXT NOT NULL, qtype TEXT NOT NULL, question TEXT NOT NULL,
  reference_answer TEXT NOT NULL, origin TEXT NOT NULL /* 'own' | 'cross:<db>' */, meta_json TEXT);
CREATE TABLE eval_gold (question_id TEXT NOT NULL, chunk_id TEXT NOT NULL, passage TEXT NOT NULL, PRIMARY KEY (question_id, chunk_id));
CREATE TABLE eval_runs (id TEXT PRIMARY KEY, set_id TEXT NOT NULL, build_id TEXT NOT NULL, pipeline_id TEXT NOT NULL,
  judge_recipe_id TEXT, session_id TEXT NOT NULL, conditions_json TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE eval_results (run_id TEXT NOT NULL, question_id TEXT NOT NULL, condition TEXT NOT NULL, search_id TEXT,
  metrics_json TEXT NOT NULL, answer TEXT, judgement_json TEXT, PRIMARY KEY (run_id, question_id, condition));

-- immutability (repeat for item_sources, item_inputs, item_nodes, nodes, mappings, mapping_sets, recipes, events, embeddings,
-- build_members, parse_artifacts, eval_gold)
CREATE TRIGGER items_no_update BEFORE UPDATE ON items BEGIN SELECT RAISE(ABORT, 'items are immutable'); END;
CREATE TRIGGER items_no_delete BEFORE DELETE ON items BEGIN SELECT RAISE(ABORT, 'items are immutable'); END;
```

Extensibility notes: no table is kind-specific except `chunk_positions`. Relations, summaries and any future kind live in `items` with `attrs_json`. Per-database relation structure (types, qualifier fields) lives in `attrs_json`, validated by the kind's zod schema in the registry. Communities, if they need their own records, are items of kind `community` whose `item_inputs` are their members.

---

## 5. Event catalog and the logging contract

```ts
// @kg/contracts/src/events.ts
/** Payload registry, augmented by layers. */
export interface EventPayloads {
  'session.start':   { kind: 'agent' | 'eval' | 'cli'; client?: unknown };
  'session.end':     {};
  'tool.call':       { tool: string; args: unknown };
  'tool.error':      { tool: string; message: string; stack?: string };
  'ingest.start':    { db: string; inputs: string[] };
  'ingest.doc':      { docKey: DocKey; fileHash: FileHash; parseArtifactId: string; reused: boolean; chunks: number; newChunks: number; durationMs: number };
  'ingest.done':     { ingestId: IngestId; buildId: BuildId; staleItems: number };
  'artifact.import': { parseArtifactId: string; producedWhere: string };
  'derive.run':      { runId: RunId; recipeId: RecipeId; scope: 'local' | 'set'; status: 'start' | 'done' | 'failed'; stats?: Record<string, number> };
  'build.create':    { buildId: BuildId; parentBuildId: BuildId | null; added: number; removed: number; mixedRecipes: boolean };
  'build.pointer':   { name: string; buildId: BuildId };
  'search.request':  { request: SearchRequest; pipelineId: RecipeId };
  'search.step':     { path: string; step: string; params: unknown; queriesAdded: QueryVariant[] /* without vectors */;
                       pools: Record<string, LoggedCandidate[]>; candidates: LoggedCandidate[]; inCount: number; outCount: number;
                       trace?: unknown; durationMs: number };
  'search.result':   { items: { id: ItemId; kind: string; score: number; rank: number; sourceChunkIds: ChunkId[] }[]; stale: boolean };
  'feedback':        { searchId: SearchId; overall?: Relevance; items?: { itemId: ItemId; sourceChunkIds: ChunkId[]; relevance: Relevance; note?: string }[]; note?: string };
  'usage':           { searchId: SearchId; items: { itemId: ItemId; sourceChunkIds: ChunkId[] }[]; how: string };
  'outcome':         { searchIds?: SearchId[]; worked: 'yes' | 'partial' | 'no'; note?: string };
  'note':            { text: string; target?: { sessionId?: SessionId; eventId?: EventId } };
  'eval.run':        { evalRunId: string; status: 'start' | 'done'; setId: string; conditions: string[] };
  'eval.answer':     { evalRunId: string; questionId: string; condition: string; searchId?: SearchId; metrics: Record<string, number> };
}
export interface LoggedCandidate { id: string; kind: string; score: number; rank: number; channel: string; queryId: string }
export type EventType = keyof EventPayloads & string;
export interface Event<T extends EventType = EventType> {
  seq: number; id: EventId; sessionId: SessionId; ts: string; type: T; v: number;
  buildId: BuildId | null; searchId: SearchId | null; parentId: EventId | null;
  payload: EventPayloads[T];
}
export type NewEvent<T extends EventType = EventType> = Omit<Event<T>, 'seq' | 'id' | 'ts' | 'v' | 'sessionId'>;

/** The one contract. Bound to a session; the only writer of events. */
export interface Recorder {
  readonly sessionId: SessionId;
  emit<T extends EventType>(type: T, payload: EventPayloads[T], ctx?: { buildId?: BuildId; searchId?: SearchId; parentId?: EventId }): Promise<EventId>;
  child(ctx: { buildId?: BuildId; searchId?: SearchId; parentId?: EventId }): Recorder; // pre-binds context
}
```

**Contract.** Every interaction enters through a `Tools` handler in `@kg/tools`. Each handler is defined with `defineTool(name, schema, impl)`, which (a) requires a `SessionHandle` (no handler type-checks without one), (b) emits `tool.call` and, on failure, `tool.error`, and (c) passes the session's `Recorder` into the services it calls. `SearchService`, `DeriveRunner`, `BuildService` and ingest take a `Recorder` as a required parameter, so there is no code path that does work without a log handle. The MCP server, CLI and eval runner are all callers of `Tools`; eval opens a session with `kind: 'eval'`. That satisfies "agent sessions and eval runs pass through the same search path and write the same events", and keeps logging a property of the tool layer (the tool layer owns the session and recorder; inner services only emit through it).

Rule 6 enforcement in the contract: `Recorder.emit` rejects (`TypeError` at runtime, plus a type-level overload) any event whose payload names an `ItemId` without a `buildId` in context. `feedback` and `usage` resolve and store `sourceChunkIds` at write time, so feedback keys to chunks even when the rated item is a relation or summary.

---

## 6. Testing in isolation

`@kg/testkit` exports:

| Fake | Behaviour |
|---|---|
| `FakeParser` | returns committed fixture artifacts by file hash |
| `FakeChunker` | splits fixture text on blank lines with given heading paths (for packages that need chunks but not docling) |
| `HashEmbedder(dims)` | deterministic: seeded by sha256 of text, so similar tests are reproducible; plus `KeywordEmbedder` (bag-of-words vector) so knn tests carry meaning |
| `ScriptedLlm` | returns canned responses keyed by prompt hash; fails loudly on unknown prompts |
| `MemoryRecorder` | collects events in an array; assertions helpers `expectStepLogged(path)` |
| `testStore()` | real `@kg/store` on `:memory:` (cheap, avoids a second store impl that could diverge) |
| `FakeClock`, `SeqIds` | deterministic ULIDs and timestamps |

Conformance suites, each a function taking a factory, run by the real implementation and by the fake:

- `parserConformance(make)`: artifact envelope fields; `sha256` matches; same file + recipe twice gives equal `document`.
- `chunkerConformance(make)`: on fixture artifacts, golden chunk-ID list; on the **edited** fixture (paragraph inserted in section 1), all chunks outside the inserted span keep IDs (allowing at most 2 boundary chunks to change); round-trip through gzip/import gives identical IDs.
- `embedderConformance(make)`: dims stable, batch = singles, `query` and `document` roles honoured.
- `storeConformance(make)`: immutability triggers fire; `INSERT OR IGNORE` idempotence; `bySource`/`byInput` both directions; knn restricted to build members.
- `buildViewConformance(make)`: v0 identity behaviour of `canonical/equivalents/links`, then (pre-written for equivalence) a fixture mapping set where `duplicate` unions sources. The second half is marked `todo` until equivalence lands, so the contract is written before the layer.
- `stepConformance(factory)`: a step must not mutate `request`, must keep candidate IDs within view membership, must be deterministic given fixed inputs.
- `producerConformance(producer)`: outputs cite chunks (Rule 1), stable IDs on rerun with `ScriptedLlm`, cache hit on second run.
- `toolConformance(tools)`: every handler emits `tool.call`; search emits `search.request`, one `search.step` per step, `search.result`; feedback with relation item includes `sourceChunkIds`.

Fixtures (committed under `packages/testkit/fixtures/`): `thermo-plischke.artifact.json.gz` (real docling output, 0.3 MB), `mini.artifact.json` (hand-made, 3 sections, 8 chunks), `mini-edited.artifact.json` (paragraph inserted early, one heading renumbered), golden ID lists for each, a 10-question mini eval set keyed to `mini` chunk IDs.

---

## 7. Docling sidecar and parse artifact

**Form: thin wrapper**, Python package `sidecars/docling` (`kg_docling`), managed with `uv`, two entry points over the same functions:
- HTTP (FastAPI): `POST /parse` (multipart file + recipe JSON) → artifact; `POST /chunk` (artifact + chunk recipe) → `ChunkDraft[]`; `GET /version` → `{docling, docling_core, device}`.
- CLI: `python -m kg_docling parse <files...> --recipe r.json --out dir/` for batch runs on a GPU box with no server.

`@kg/parse` talks to a configured base URL (`http://127.0.0.1:<port>` spawned by `@kg/app`, or a remote host). Local or remote is configuration only.

Why not docling-serve: its output envelope and option names are its own, and we need recipe hashing, version pinning and a `/chunk` that matches our recipe exactly. The wrapper is about 150 lines. (Evidence-resolvable; revisit if docling-serve's chunk endpoint gives identical drafts.)

Chunking runs in the sidecar's `/chunk` (docling-core `HybridChunker`, no ML models needed beyond a tokenizer) but always **locally**, from the artifact, and IDs are assigned in TS by `assignChunkIds`. So the GPU server only ever produces artifacts. The spike showed identical chunk IDs after JSON round-trip.

```ts
export interface ParseArtifact {
  format: 'kg-parse-artifact';
  formatVersion: 1;
  id: string;                         // h('pa', sourceFileHash, parserRecipeId)
  sourceFileHash: FileHash;
  sourceByteSize: number;
  sourceFilename: string;             // informational only
  parserRecipe: Recipe<ParseRecipeParams>;  // full spec, so an import needs nothing else
  parserRecipeId: RecipeId;
  environment: { docling: string; doclingCore: string; python: string; platform: string; device: string };
  producedAt: string;
  producedWhere: string;              // hostname or label
  quality?: { pages: number; charsPerPage: number[]; undecodedFormulas: number; [k: string]: unknown }; // for a future gate
  documentSha256: string;             // of canonical document JSON
  document: unknown;                  // DoclingDocument JSON (docling-core schema)
}
```

File form: `<fileHash[:16]>.<recipeId>.kgparse.json.gz`. Import: `kg import <dir|files>` verifies `documentSha256` and that `parserRecipeId` equals the hash of `parserRecipe`, stores it in `parse_artifacts`, emits `artifact.import`. A later `kg ingest` of the same source file finds the artifact by `(fileHash, recipeId)` and does not call `/parse`. Escalation (OCR, formulas) is a second recipe on the same file, producing a second artifact; which artifact a document uses is recorded in `ingest_docs`.

---

## 8. Phase 2 work breakdown

Phase 1 delivers `@kg/contracts`, `@kg/testkit` (fakes, fixtures, conformance suites) and `@kg/app` skeleton. Then:

| WP | Package | Depends on (contracts + …) | Size | Model |
|---|---|---|---|---|
| 1 | `@kg/store` (schema, repos, BuildView v0, knn) | — | M | Sonnet (BuildView semantics, triggers) |
| 2 | `sidecars/docling` + `@kg/parse` | fixtures | S | Haiku |
| 3 | `@kg/chunk` (`/chunk` client, `assignChunkIds` already in contracts) | WP2 sidecar for real runs; fixtures otherwise | S | Haiku |
| 4 | `@kg/embed` (Ollama client + embedding producer) + model spike | — | S | Haiku (spike: Sonnet) |
| 5 | `@kg/derive` (runner, cache, runs) | testStore | M | Sonnet |
| 6 | `@kg/build` (fromIngest carry-forward, staleness) | testStore | M | Sonnet |
| 7 | `@kg/ingest` orchestration | fakes for 2-6 | S | Haiku |
| 8 | `@kg/search` (runner, registry, 5 v0 steps, `oracle-inject`) | testStore, HashEmbedder | M | Sonnet for runner, Haiku for steps |
| 9 | `@kg/tools` + `@kg/mcp` | fakes | S | Haiku |
| 10 | `@kg/llm` | — | S | Haiku |
| 11 | `@kg/eval` (generation prompts, runner, metrics, judge) | Tools fake, ScriptedLlm | L | Opus/Sonnet for prompts and judge; Haiku for runner/metrics |
| 12 | `@kg/viewer` | StoreReader, fixture event logs | M | Haiku (with a fixture log spec) |

All of WP1-12 can run in parallel after Phase 1; the only real-implementation dependency is WP3 on WP2 for its integration test. The chunker (WP2+3) freezes before Phase 4 question generation.

---

## 9. Traceability

| Requirement | Where |
|---|---|
| Rule 1: derived items cite chunks | `item_sources`; `DeriveRunner` fills it (default = union of inputs' sources) and rejects drafts that resolve to none; `producerConformance` |
| Rule 2: immutable | `INSERT OR IGNORE` + update/delete triggers on all derived tables; new recipe ⇒ new recipe ID ⇒ new item IDs |
| Rule 3: equivalence as mapping | `mappings`/`mapping_sets`; `BuildView.canonical/equivalents/sourcesOf`; no API edits items |
| Rule 4: items record recipe | `items.recipe_id`, `runs`, `derivations`; embeddings via `embedding_spaces.conditioning_recipe_id`; chunks via `chunk_positions.chunk_recipe_id` + `ingest_docs.parse_artifact_id` |
| Rule 5: stale flagged | `BuildService.stale`; `fromIngest` excludes and reports affected items (`ingest.done.staleItems`); `SearchResult.stale` and `search.result.stale`; eval refuses stale builds unless `--allow-stale` |
| Rule 6: feedback/eval key to chunks; events record build | `eval_gold` on chunk IDs; `feedback`/`usage` payloads carry `sourceChunkIds`; `Recorder.emit` requires `buildId` when payload names items |
| v0.1 Ingest and chunk, idempotent, embedded | `@kg/parse`, `@kg/chunk`, `@kg/ingest`, `@kg/embed`; idempotence from artifact cache + content IDs + `INSERT OR IGNORE` + derivation cache |
| v0.2 Store | `@kg/store`, one SQLite file, schema §4 |
| v0.3 Search with step logging | `@kg/search` runner, `search.step` events, `SearchResult` |
| v0.4 Event log | `events` table, `Recorder`, `defineTool`, catalog §5 |
| v0.5 Agent feedback | `Tools.feedback` (+ `usage`, `outcome`), relevance `0|1|2` |
| v0.6 Eval harness | `@kg/eval`, `eval_*` tables, eval session through `Tools.search`, `oracle-inject` step, per-kind scoring via `Registry.kinds[k].scoredAs` |
| Companion: viewer | `@kg/viewer` over `StoreReader`, polls `events.seq`, notes as `note` events |
| Companion: analysis tools | read `search.step` events + `eval_results`; `BuildService` diff = set difference of `build_members` (not built in v0) |

---

## 10. Extension walk-throughs

For each layer: what is added, what changes, and whether an existing interface changes.

### 10.1 Relation layer

Added:
- `@kg/relations`: augments `ItemKinds` with `relation: RelationAttrs`; registers a `LocalProducer` `relation-extract` (input group = one chunk, optionally with neighbours via `view.adjacentChunks`), whose output is `DerivedDraft[]` with `nodes` filled; registers a conditioner for relation text.
- Recipes: extraction recipe (model, prompt text, few-shot examples, per-db guidance from `DatabaseConfig.layers.relations`), embedding space for `relation`.
- Pipeline recipe v1: add `{use:'knn', params:{kind:'relation'}, as:'relations'}`, `fuse` over both pools, and an `expand` step (`mode: 'sources' | 'none' | 'both'`) that maps relation hits to chunks via `view.sourcesOf` with `expandedFrom` set.
- `@kg/app`: register the above; CLI `kg derive relation-extract --build current`.

Flow: `DeriveRunner.run(extractRecipe, current)` → items + `item_sources` + `nodes` + `item_nodes` + derivations rows → embedding run → `BuildService.derive(current, {addItems, spaces:{relation}})` → new build; eval runs both builds on the same set.

Existing interfaces changed: **none**, given `DerivedDraft.nodes` and `NodeRepo` already exist. The `expand` and generic `knn` steps could ship in v0 (`expand` on chunks = adjacent-chunk expansion), so v1 is configuration.

Strain: re-running extraction with a nondeterministic LLM. With `textHash` in the ID (see Conflicts) two runs produce two item sets; the derivation cache stops accidental reruns, `force` creates a deliberate one. The pilot pre-check ("how many gold facts become relations") is `DeriveRunner.run(..., {only: sampleChunkIds})` into a scratch build, no extra machinery.

### 10.2 Graph walk

Added:
- `@kg/graph`: `GraphSource` (new interface file in contracts, additive), built in memory (graphology) from `view.items('relation')`, `view.nodesOf`, `view.canonical`; cached per build ID. Augments `ServiceMap { graph: GraphSourceFactory }`.
- Step `ppr-walk`: reads seeds from named pools (`relations`, optional `nodes` pool from knn over a node space), runs personalized PageRank (damping, hub penalty, max nodes as params), writes pool `walk` with relation candidates, and returns `trace: { seeds: [{id, weight}], iterations, hubsDown }`. The runner logs seeds automatically, which is what v0 item 3 asks for.
- Pipeline recipe v2 adds `ppr-walk` before `fuse`.

Existing interfaces changed: **none**. Nodes as seeds need a node embedding space; `EmbeddingSpace.targetKind` already allows `'node'`.

Strain: `GraphSource` reaches the step through the `Services` locator, typed by augmentation. Missing registration is a startup error (pipeline validation checks `services.has` for each step's declared needs), not a compile error. A move to a graph store (Scale and Cost) changes only `@kg/graph`.

### 10.3 Equivalence

Added:
- `@kg/equivalence`: `SetProducer` `equiv-propose-verify`: for each new node/relation in the build since `parentSetId`'s input build, knn over its space, LLM judge per pair, output `mappings` (including `distinct`). Runner writes a `MappingSet` with `inputBuildId` and `parentSetId`.
- `BuildService.derive(current, {mappingSetIds: [...prev, newSet]})` → new build.
- `BuildView` impl in `@kg/store`: `canonical/equivalents` via union-find over `same|duplicate` mappings of the pinned sets; `sourcesOf` unions over the class; `links` returns `refines|supersedes`.
- Step `collapse-equivalents`: merges candidates of one class into the canonical, max score, union sources.

Existing interfaces changed: **none** (all `BuildView` methods exist). Implementation changes in an existing package: **yes**, `@kg/store`'s `BuildView` gains real resolution logic. The `buildViewConformance` second half is already written for it.

Strain (honest):
- Policy for conflicting mappings across sets (set 2 says A≡B, set 3 says A distinct B) is new logic, not just data; the rule "later set in the build's list wins per pair" is a guess.
- Equivalence changes recall (duplicate unions sources). Builds pin mapping sets, so comparisons stay interpretable, but eval reports must show the mapping state; `eval_runs.build_id` covers it.
- The judge's "refinement vs supersession" output may want a direction and a scope note; `evidence_json` absorbs it, but the walk may want typed access.

### 10.4 Reranking

Added:
- `CrossEncoder` interface (additive contracts file), impl either `/rerank` on the sidecar (sentence-transformers / bge-reranker) or an Ollama/LLM-as-reranker; registered in `ServiceMap`.
- Step `rerank` (`params: {top: 50, model}`): reorders `candidates`, `trace: {model, latencyMs}`; the runner logs before/after ranks.
- Recipe pipeline v-next.

Existing interfaces changed: **none**. The pre-check (rank distribution of gold under the baseline) uses only v0 `search.step` events: the gold rank in the `knn` step's 100-candidate list against `truncate`. That is why v0 knn keeps k=100 candidates while returning `request.k`.

Strain: the sidecar grows a second responsibility with its own model deps. Acceptable; could be a second sidecar with the same pattern.

### 10.5 Query refinement

Added:
- Step `rewrite` (LLM paraphrase/decompose): appends `QueryVariant`s with `parentId`; subsequent `embed-query`/`knn` steps already iterate over all queries and tag candidates with `queryId`; `fuse` (RRF) fuses across queries.
- Composite step `loop` (`params: {max: 3, steps: [...], until: 'critique-ok'}`) and step `critique` (LLM reads `candidates`, optionally drafts an answer, emits new queries or sets `state.done`). Nested steps log at paths `"4.1"`, `"4.2"`.
- Agent-driven refinement (agent issues follow-up searches) uses `SearchRequest.parentSearchId`; viewer threads them.

Existing interfaces changed: **one small one likely**: `SearchState` needs a `done`/`stop` flag and maybe a scratch area (`state.notes: Record<string, unknown>`) for a critique's draft answer. I would add both to v0 now (empty), which makes it no change. Pre-check ("recall of original vs best paraphrase") runs as an eval with pipeline variant using `rewrite`, so no new machinery.

Strain: a `loop` composite is a mini control-flow language inside a recipe. If decomposition needs per-subquery pipelines with their own fusion, the linear list with named pools gets awkward; `ctx.subsearch` is the escape hatch (child search with its own ID and log), at the cost of a less flat log.

### 10.6 Community summaries

Added:
- `@kg/communities`: augments `ItemKinds { summary: { level: number; communityId: string; parentId: ItemId | null } }`, registers `kinds.summary.scoredAs = 'separate'`; `SetProducer` `cluster-summarize`: Leiden over `GraphSource` (graphology-communities, or the sidecar if hierarchical Leiden is needed), summarize each community with the LLM; outputs summary items with `inputIds` = member relations, `sourceChunkIds` = union of members' sources. Run records `inputBuildId`.
- Embedding space for `summary`; pipeline channel `summaries` with `options.level`.

Staleness: a summary is stale in a build if any `item_inputs` member is not in `build_members`; `BuildService.stale` generalizes from "chunk missing from ingest" to "input missing from build" over `item_inputs`. That is an implementation extension, not an interface change (`StaleReport.affectedItemIds` already covers it, but a field `missingInputIds` would be clearer → small additive change).

Eval: v0 metrics already compute recall per kind and exclude `scoredAs: 'separate'` kinds from chunk recall, so summaries are scored separately without touching eval.

Existing interfaces changed: **none required; one additive field suggested** (`StaleReport.missingInputIds`).

Strain: derived item ID = `h(recipe, sortedInputIds, textHash)` with hundreds of input IDs is fine for hashing but the `derivations` cache key for set-level runs is the input build, not inputs; incremental community maintenance (order-dependent) would need its own chain like `mapping_sets.parent_set_id`. Not modelled for items; it would be a `runs.parent_run_id` column (schema addition).

### 10.7 Recipes and builds beyond v0

Already exercised in v0: every ingest produces a build; embeddings go through `DeriveRunner`; search pipelines are recipes. Re-extracting only failing chunks: `DeriveRunner.run(newRecipe, b, {only})` then `BuildService.derive(b, {addItems: new, removeItems: oldForThoseChunks})` → `mixedRecipes: true`. Diff of builds = set difference of members + spaces + mapping sets.

### 10.8 Contextual node embeddings (cross-cutting)

Conditioning reads a node's relations and chunks, so the embedding is set-level. `EmbeddingSpace.inputBuildId` covers that, and the space ID includes it. Change: none to interfaces; a new conditioner. Strain: every new build that changes relations needs a new node space, re-embedding all nodes unless the conditioner declares which inputs it reads (not modelled).

### Summary of interface changes

| Layer | New contract files | Existing interface changes | Existing package impl changes |
|---|---|---|---|
| Relations | none | none | none |
| Graph walk | `GraphSource` | none | none |
| Equivalence | none | none | `@kg/store` BuildView resolution |
| Reranking | `CrossEncoder` | none | sidecar `/rerank` (optional) |
| Query refinement | none | `SearchState.done/notes` unless added in v0 (recommended) | `@kg/search` gets `loop` composite |
| Communities | none | `StaleReport.missingInputIds` (additive) | `@kg/build` staleness over `item_inputs`; `runs.parent_run_id` if incremental |
| Builds | none | none | none |

`@kg/app` changes for every layer (registration); that is intended.

### Where the structure still breaks

1. **Service locator.** Steps and producers find `graph`, `crossEncoder`, `llm` through `Services`. Typed by augmentation, but a missing service is a startup error, not a compile error. Accepted to avoid changing `StepContext` per layer.
2. **`@kg/contracts` is a shared hub.** Additive files are cheap, but a mistaken core type (e.g. `Candidate`) ripples into every package. Phase 1's skeleton must exercise it hard.
3. **Linear pipeline.** Decomposition with per-subquery fusion and answer critique push toward a DAG; `loop` and `subsearch` are escape hatches, not a design for it.
4. **Set-level incremental items** (communities, maintained incrementally) have no chain record like mapping sets do; needs `runs.parent_run_id`.
5. **BuildView as choke point.** All equivalence semantics land in one implementation; performance at large graphs (resolve per call) is untested; may need a materialized `build_canonical(build_id, id, canonical_id)` table, a schema addition.
6. **Kind augmentation is compile-time.** Reading a database with kinds the running code does not know yields `Item<string>` with unvalidated attrs; tools return them but cannot interpret them. Fine for viewer, not for steps.
7. **Logging volume** with walk traces and several pools per step: one `search.step` with 5 pools × 100 candidates ≈ 25 KB; fine at this scale, a design-feedback item if it grows.

---

## 11. Decisions

| # | Decision | Kind | Rationale / options |
|---|---|---|---|
| D1 | Chunk ID = h(docKey, normalized heading path, textHash, dupOrdinal); ord/page as attributes | evidence-resolvable | Options: global index (shifts every later ID on insertion), section path + ordinal (shifts within section), content + heading (shifts only changed chunks). Settle with the `mini-edited` fixture and an insert-a-paragraph test on ThermoPlischke in Phase 1. Risk: heading detection changes under a different parser recipe (OCR) rename all chunks in a document. |
| D2 | Strip leading section numbers from headings in the ID | evidence-resolvable | Check docling heading text on the four PDFs; if they carry numbering, inserting a chapter would otherwise rename all later chunks. |
| D3 | `docKey` = path relative to source root, overridable | **needs the user** | Options: (a) path (rename = new IDs, simple), (b) user-assigned key in config (stable, manual), (c) first-seen file hash (stable across rename, but an edited file is a new doc unless linked). Turns on how project databases will add/move files. Recommend (a) with override; blocks nothing in v0 for stat-mech. |
| D4 | Derived item ID includes `textHash` | **needs the user** (touches Core Concepts wording) | Options: (a) h(recipe, inputs, ordinal): rerun of a nondeterministic LLM collides with different text, so reruns must be forbidden; (b) add textHash: reruns produce distinct immutable items, build chooses. Recommend (b). Blocks nothing in v0: v0 writes no derived text items, and embeddings are keyed by space. |
| D5 | Chunker recipe not in chunk ID | evidence-resolvable | Design: ID from content and position. Keeps eval valid across chunker changes that preserve text; Rule 4 still met via `chunk_positions.chunk_recipe_id`. |
| D6 | Every ingest creates a build; `current` pointer auto-advances in v0 | arbitrary | Exercising builds from day one costs a few rows; auto-advance can be turned off per db. |
| D7 | Build membership explicit (`build_members`) | evidence-resolvable | Options: rules (recipe per kind + overrides) vs explicit IDs. Explicit is exact and supports mixed recipes; cost O(items) rows per build, trivial at <100k items. Revisit under Scale. |
| D8 | Embeddings in one plain table, brute-force via `vec_distance_cosine`, not `vec0` virtual tables | evidence-resolvable | Uniform for all spaces and dims, easy join on build membership. Phase 1 benchmark: must be < 20 ms at 20k × 768. Fallback: per-space `vec0`. |
| D9 | Parse artifacts stored gzipped inside the SQLite file | arbitrary | 0.3–1 MB each; keeps the one-file-per-database property; files on disk would work equally. |
| D10 | Thin FastAPI + CLI wrapper, not docling-serve | evidence-resolvable | Need recipe hashing, version pinning and our `/chunk`; check docling-serve chunk output equality if someone prefers it. |
| D11 | Chunking via sidecar `/chunk` (docling-core HybridChunker), IDs in TS | evidence-resolvable | Options: TS reimplementation of the chunker (no Python locally) vs sidecar. Spike evidence covers HybridChunker round-trip only. Local Python is needed anyway in v0. Revisit if local Python becomes a burden. |
| D12 | Implementations import only contracts; app is the only composition root | arbitrary | Standard DI; any single-root scheme gives similar independence. |
| D13 | Kind/event/service registries via TS module augmentation | arbitrary | Alternatives (string maps with runtime schemas only) give similar results with weaker types. |
| D14 | Search runner logs all steps; steps only return `trace` | evidence-resolvable (by design reading) | v0 item 3 requires logging what each step considered; runner-side logging makes it unforgeable. |
| D15 | Retrieval candidate depth 100 in v0 knn, return k | arbitrary | Enables rank-distribution pre-check; any depth ≥ 50 suffices at 337 chunks. |
| D16 | Relevance scale 0/1/2 | arbitrary | Aggregatable ordinal; 0/1 or 1-5 would serve. |
| D17 | Recorder enforces `buildId` when payloads carry item IDs | arbitrary | Mechanical Rule 6 check; could be a test instead. |
| D18 | Hash: sha256 truncated to 20 hex chars, prefixed | arbitrary | 80 bits, collision-free at any foreseeable scale. |
| D19 | Embedding model | evidence-resolvable | Open sub-choice in decision log; spike on stat-mech chunks (`nomic-embed-text`, `mxbai-embed-large`, `bge-m3`) with a 30-question pilot recall. |
| D20 | Stat-mech corpus suffices | (user decision, fixed) | — |
| D21 | `SearchState.done` and `notes` present (unused) in v0 | arbitrary | Avoids an interface change for query refinement. |

**Needs the user:** D3 (document identity) and D4 (text hash in derived item IDs).

---

## 12. Conflicts

1. **Derived item ID vs nondeterministic producers.** Design: "each item's ID derives from its recipe and its input chunk IDs". An LLM with the same recipe and inputs can produce different relations; with ID = f(recipe, inputs, ordinal) two runs collide on IDs with different text, violating immutability. I add `textHash` (D4). Alternative that keeps the wording: forbid reruns (derivation cache is authoritative), which makes a deliberate re-sample need a recipe bump (e.g. a `seed` param).
2. **Chunks and Rule 4.** Chunks are "never derived", yet they come from a parser and chunker recipe. I keep chunk IDs recipe-free (per "ID derives from content and position") and record recipes on `chunk_positions`/`ingest_docs`. A chunker change is still traceable, but chunk IDs do not tell you which chunker made them.
3. **"Logging is a property of the MCP tool layer" vs step-level logging.** Step detail is only visible inside search. Resolved by having the tool layer own sessions and recorders and pass them down as required parameters; search emits through them. If the user reads the design as "only `@kg/mcp` writes events", eval (which bypasses MCP transport) would violate it; I placed logging in `@kg/tools`, which both MCP and eval call.
4. **Nodes vs items.** Design: items are what search returns; nodes carry no content. Graph seeding by node similarity returns nodes as candidates. I let `Candidate.kind` be `'node'` inside the pipeline, but nodes never reach `SearchResult` (a step must map them to items). This is a slight widening.
5. **Builds in v0.** The design's v0 does not mention builds, but Rule 6 requires events referencing derived items to record the build, and v0 has derived embeddings. I create builds from v0. Adds scope (WP6), reduces later change.

---

## 13. Biggest risk

**That a linear list of steps over one mutable `SearchState` with named pools, plus `loop` and `subsearch` as escape hatches, is expressive enough for graph walk, query decomposition and answer critique without the pipeline becoming a control-flow language, and that its per-step log stays diagnosable.** Graph walk and reranking fit it cleanly. Decomposition into sub-questions whose results must be fused per sub-question, and critique loops that draft answers, are the cases I am least sure of. If they do not fit, the fix is a DAG pipeline spec, which changes `PipelineSpec`, the runner and the `search.step` log shape (paths become node IDs), though not `Step`, `SearchService` or `SearchResult`. Phase 1 can test this cheaply: write (not implement) the pipeline recipes for decomposition and critique against the v0 contract and see whether they express the intent.

Second-least sure: D1 under parser escalation. If an OCR recipe changes docling's heading detection, every chunk in that document gets a new ID and its eval questions must be regenerated. Settle it in Phase 1 by parsing ThermoPlischke with OCR on and off and comparing heading paths.
