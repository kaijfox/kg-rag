# v0 architecture draft: independence and testability lens

Lens: each Phase 2 package can be built by an agent on a cheap model from (a) its contract in `core`, (b) its package card, (c) the tests and fixtures in `testkit`, without opening a sibling's source. Everything below serves that rule; where it costs something, the cost is stated.

## 0. The three structural rules

1. **Star topology.** Every package depends at runtime on `@kg/core` only (plus third-party libraries). No package imports a sibling. The one exception is `@kg/app`, the composition root, which wires real implementations together. Enforced in CI by `dependency-cruiser` and by a `pnpm` check that no `package.json` outside `app` lists a sibling `@kg/*` other than `core` (and `testkit` as a devDependency).
2. **All shared knowledge lives in `core` as code, not prose.** Types, ports (interfaces), ID derivation, canonical JSON, event schemas (zod), the SQL schema text, conditioning templates, score and tie-break rules. If two packages must agree on something, it is a function or constant in `core` that both call, with golden vectors in `testkit`.
3. **Every port has a fake and a conformance suite, and every conformance suite has a broken fake that must fail it.** The real implementation and the fake run the same suite. The broken fake proves the suite has teeth (Phase 1 criterion "fixtures do not pass trivially").

`core` and `testkit` are written in Phase 0/1 by a strong model and frozen at fan-out. Phase 2 agents may not edit them; they file change proposals.

## 1. Packages and dependencies

| Package | Lang | Owns | Implements ports | Runtime deps |
|---|---|---|---|---|
| `core` | TS | types, ports, `ids.ts`, `canonical.ts`, `events.ts` (zod catalog), `schema.sql`, `conditioning.ts`, `CONTRACT_VERSION` | none | zod only |
| `testkit` | TS | fakes, conformance suites, broken fakes, fixtures, golden vectors | all (as fakes) | core |
| `parse-sidecar` | Python | docling CLI wrapper, artifact envelope writer | CLI contract (§7) | docling |
| `parse` | TS | `SubprocessParser`, `ArtifactDirParser`, envelope validation, artifact import | `Parser` | core |
| `chunk` | TS | docling JSON → `DocTree` normalizer; `DocTree` → `ChunkDraft[]`; the only code that knows docling's JSON layout | `Chunker` | core |
| `embed` | TS | Ollama HTTP client | `Embedder` | core |
| `store` | TS | SQLite open/migrate, corpus repos, builds, eval tables, KNN via sqlite-vec | `CorpusStore`, `EvalRepo` | core, better-sqlite3, sqlite-vec |
| `eventlog` | TS | `events`, `sessions`, `session_notes` tables | `EventLog`, `LogReader` | core, better-sqlite3 |
| `ingest` | TS | parse→chunk→store→embed orchestration, idempotency, build snapshot trigger | `IngestService` | core |
| `search` | TS | pipeline runner, step registry, v0 steps | `SearchService`, `SearchStep` | core |
| `api` | TS | `KgApi` implementation (handlers wrapped by core's `runTool`, the logging contract), sessions, feedback | `KgApi` | core |
| `mcp` | TS | MCP server exposing `KgApi` 1:1 as tools | none | core, @modelcontextprotocol/sdk |
| `eval` | TS | question generation, run conditions, recall@k, judge | `EvalService` | core |
| `viewer` | TS | static page + tiny HTTP server over `LogReader` | none | core |
| `app` | TS | config, wiring, CLI (`kg ingest`, `kg mcp`, `kg eval`, `kg viewer`, `kg build`) | none | everything |

```
              ┌──────────────────────── app (composition root) ───────────────────────┐
              │   parse chunk embed store eventlog ingest search api mcp eval viewer  │
              └──────┬─────┬─────┬─────┬──────┬───────┬──────┬────┬───┬────┬─────┬───┘
                     └─────┴─────┴─────┴──────┴───┬───┴──────┴────┴───┴────┴─────┘
                                                  ▼
                                                core  ◀── testkit (devDependency of all)
   parse-sidecar (Python): no code dependency; contract = CLI spec + JSON Schema exported from core
```

Why `ingest`, `search`, `api` and `eval` do not import `store` or `embed`: they receive ports by constructor injection. This is what lets `ingest` be tested with `InMemoryCorpusStore` + `HashEmbedder` + `FixtureParser` and no SQLite at all.

Why `store` and `eventlog` are two packages sharing one file: they own disjoint tables, both apply `core/schema.sql` (idempotent `CREATE ... IF NOT EXISTS`), and both take an open `better-sqlite3` `Database` handle. Coupling is through the schema text in core only. `app` opens the file once and passes the handle to both.

## 2. Core data model

### 2.1 Identifiers

```ts
// core/src/ids.ts
export type Brand<T, B extends string> = T & { readonly __brand: B };
export type ChunkId = Brand<string, 'ChunkId'>;      // ch_<20 b32>
export type ItemId = ChunkId | Brand<string, 'DerivedItemId'>; // ch_ | rl_ | sm_
export type NodeId = Brand<string, 'NodeId'>;        // nd_
export type RecipeId = Brand<string, 'RecipeId'>;    // rc_
export type BuildId = Brand<string, 'BuildId'>;      // bd_
export type MappingId = Brand<string, 'MappingId'>;  // mp_
export type RunId = Brand<string, 'RunId'>;          // dr_ (set-level derivation run)
export type DocKey = Brand<string, 'DocKey'>;        // stable document name, e.g. "ThermoPlischke"
export type DocVersionId = Brand<string, 'DocVersionId'>; // dv_
export type ArtifactId = Brand<string, 'ArtifactId'>; // pa_
export type SpaceId = Brand<string, 'SpaceId'>;      // es_ embedding space
export type SessionId = Brand<string, 'SessionId'>;  // se_ (ULID from IdGen)
export type SearchId = Brand<string, 'SearchId'>;    // sr_ (ULID from IdGen)
export type EventId = Brand<string, 'EventId'>;      // ev_ (ULID from IdGen)

/** sha256 over tag and parts joined by U+001F; base32 (RFC4648 lower, no pad); first 20 chars = 100 bits. */
export function hashId(prefix: string, tag: string, parts: readonly string[]): string;
/** NFC, CRLF→LF, runs of whitespace → single space, trim. Used for hashing only; stored text stays verbatim. */
export function normText(s: string): string;
/** NFKC, lowercase, whitespace collapsed, leading/trailing punctuation stripped. */
export function normName(s: string): string;
/** RFC 8785 (JCS) canonical JSON. */
export function canonicalJson(v: Json): string;

export const chunkId = (docKey: DocKey, sectionPath: readonly string[], text: string, occurrence: number): ChunkId =>
  hashId('ch_', 'chunk/1', [docKey, sectionPath.map(normText).join('\u001e'), sha256hex(normText(text)), String(occurrence)]) as ChunkId;
export const recipeId = (r: RecipeSpec): RecipeId => hashId('rc_', 'recipe/1', [canonicalJson(r)]) as RecipeId;
export const nodeId = (name: string): NodeId => hashId('nd_', 'node/1', [normName(name)]) as NodeId;
export const derivedItemId = (kind: 'relation' | 'summary', recipe: RecipeId, inputs: readonly ItemId[], text: string) =>
  hashId(kind === 'relation' ? 'rl_' : 'sm_', `${kind}/1`, [recipe, [...inputs].sort().join(','), sha256hex(normText(text))]);
export const artifactId = (sourceSha256: string, parseRecipe: RecipeId): ArtifactId =>
  hashId('pa_', 'artifact/1', [sourceSha256, parseRecipe]) as ArtifactId;
export const docVersionId = (docKey: DocKey, artifact: ArtifactId, chunkRecipe: RecipeId): DocVersionId =>
  hashId('dv_', 'docversion/1', [docKey, artifact, chunkRecipe]) as DocVersionId;
export const spaceId = (s: EmbeddingSpaceSpec): SpaceId => hashId('es_', 'space/1', [canonicalJson(s)]) as SpaceId;
export const buildId = (m: BuildManifest): BuildId => hashId('bd_', 'build/1', [canonicalJson(m)]) as BuildId;
export const mappingId = (m: Omit<Mapping, 'id'>): MappingId => hashId('mp_', 'mapping/1', [canonicalJson(m)]) as MappingId;
```

**Chunk ID scheme.** `chunkId = H(docKey, sectionPath, H(normText), occurrence)`, where `occurrence` is the index of this chunk among chunks with identical `normText` in the same section (almost always 0).

| Change | Effect on IDs |
|---|---|
| Re-ingest unchanged file, same recipes | all identical (pure function) |
| Re-parse elsewhere (GPU server), same recipe | all identical (spike: JSON round-trip gives identical chunks) |
| Paragraph inserted early in section S | new chunk(s) get new IDs; chunks in S whose packed text changes get new IDs (greedy packing cascades to the end of S only); every chunk outside S keeps its ID; chunks inside S whose text is unchanged keep their ID because no ordinal is hashed |
| Paragraph edited in place | that chunk (and any re-packed neighbours in its section) change |
| Heading renamed | all chunks of that section change (accepted; the section is the position) |
| Chunk recipe changed but yields same text at same position | IDs unchanged, so eval questions survive (desired) |
| Same document ingested into two databases | same IDs (no database ID in the hash), so an eval set built in DB "kardar" runs unchanged against DB "all" |

The ordinal-free design is the main difference from the spike's `sha256(index|text)`. `testkit/fixtures/mini-corpus` v1→v2 encodes the insertion case as a golden diff (§6.3).

### 2.2 Items, nodes, relations, mappings

```ts
// core/src/model.ts
export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
export type ItemKind = 'chunk' | 'relation' | 'summary';

export interface Item {
  id: ItemId;
  kind: ItemKind;
  text: string;                 // what is embedded and what a reader sees
  sourceChunkIds: ChunkId[];    // Rule 1; for a chunk: [itself]; non-empty, sorted, unique
  recipeId: RecipeId | null;    // Rule 4; null only for chunks (not derived)
  meta: Json;
}

export interface Chunk extends Item {
  kind: 'chunk';
  id: ChunkId;
  docKey: DocKey;
  sectionPath: string[];        // verbatim heading texts, outermost first; [] for preamble
  occurrence: number;
  pages: number[];              // 1-based, from docling provenance
  blockRefs: string[];          // docling self_refs, for provenance/debug only (not in ID)
}

export interface Node { id: NodeId; name: string }            // no content, no type
export interface NodeRef { nodeId: NodeId; surface: string; role: string | null }
export interface Relation extends Item { kind: 'relation'; nodes: NodeRef[] }
export interface Summary extends Item { kind: 'summary'; memberItemIds: ItemId[]; runId: RunId }

export type MappingKind = 'same-as' | 'duplicate-of' | 'refines' | 'supersedes';
export interface Mapping {
  id: MappingId;
  kind: MappingKind;
  subject: 'node' | 'item';
  fromId: NodeId | ItemId;
  toId: NodeId | ItemId;        // canonical / newer side
  runId: RunId;                 // producer and state (set-level)
  confidence: number | null;
  note: string | null;
}

/** Set-level derivations record producer and input state. */
export interface DerivationRun {
  id: RunId; recipeId: RecipeId; inputStateHash: string; baseBuildId: BuildId | null; createdAt: string;
}
```

### 2.3 Recipes, builds, documents

```ts
export type RecipeKind = 'parse' | 'chunk' | 'embed' | 'search' | 'extract' | 'equivalence'
  | 'cluster' | 'summarize' | 'eval-generate' | 'eval-judge';
export interface RecipeSpec { kind: RecipeKind; version: string; spec: Json }   // ID = recipeId(RecipeSpec)
export interface Recipe extends RecipeSpec { id: RecipeId }

export interface ParseRecipeSpec extends RecipeSpec {
  kind: 'parse';
  spec: { parser: 'docling'; doclingVersion: string; options: { do_ocr: boolean; do_table_structure: boolean; do_formula_enrichment: false } & Record<string, Json> };
}
export interface ChunkRecipeSpec extends RecipeSpec {
  kind: 'chunk';
  spec: { algorithm: 'section-pack/1'; targetChars: number; maxChars: number; minChars: number };
}
export interface EmbeddingSpaceSpec {
  model: string;                // e.g. "nomic-embed-text:v1.5" incl. tag
  dims: number;
  documentTemplate: string;     // e.g. "search_document: {headings}\n{text}"
  queryTemplate: string;        // e.g. "search_query: {query}"
}

export interface DocVersion {
  id: DocVersionId; docKey: DocKey; artifactId: ArtifactId; chunkRecipeId: RecipeId;
  chunkIds: ChunkId[];          // in reading order
  createdAt: string;
}

export interface BuildManifest {
  docVersions: Record<DocKey, DocVersionId>;   // sorted keys via canonicalJson
  embeddingSpaces: SpaceId[];
  searchRecipeId: RecipeId;
  derivedRecipes: RecipeId[];                  // empty in v0
  mappingRuns: RunId[];                        // empty in v0
  mixedRecipes: boolean;                       // true if any kind has >1 recipe among items
}
export interface Build {
  id: BuildId; name: string | null; createdAt: string; parentId: BuildId | null;
  manifest: BuildManifest;
  itemIds: ItemId[];            // stored as build_items rows; chunks of the doc versions + derived items
}
export interface StaleReport { buildId: BuildId; missingChunkIds: ChunkId[]; stale: boolean } // Rule 5
```

v0 has builds: each ingest that changes the current chunk set produces a new build (content-hashed, so an unchanged re-ingest yields the same build ID). `db_meta.current_build` points at it. Search considers only items in the build it runs against, which is what keeps superseded chunks (never deleted) out of results.

### 2.4 Events and search results

```ts
export interface EventEnvelope<T extends EventType = EventType> {
  id: EventId;
  sessionId: SessionId;
  seq: number;                  // per-session, contiguous from 1
  ts: string;                   // ISO-8601 UTC from Clock
  type: T;
  schemaVersion: 1;
  buildId: BuildId | null;      // required (non-null) when payload references items (Rule 6), checked by zod refine
  searchId: SearchId | null;
  parentId: EventId | null;     // tool.called event that caused it
  payload: EventPayloads[T];
}

export interface SearchResult {
  itemId: ItemId; kind: ItemKind; text: string; score: number; rank: number; sourceChunkIds: ChunkId[];
}
export interface SearchResponse { searchId: SearchId; buildId: BuildId; items: SearchResult[] }
```

Score rule (in `core/src/scoring.ts`): `score = 1 - cosineDistance`, higher is better; ties broken by `itemId` ascending; ranks 1-based and contiguous. Every step and every fake uses `sortCandidates()` from core, so no two packages can disagree on order.

## 3. Ports (interfaces between packages)

All in `core/src/ports/`. Store and log ports are synchronous because better-sqlite3 is synchronous and synchronous fakes make tests trivial to write; network-backed ports (parser, embedder, LLM) are async.

```ts
// Infrastructure injected everywhere (never Date.now() or random inside packages)
export interface Clock { now(): string }
export interface IdGen { ulid(prefix: 'se_' | 'sr_' | 'ev_' | 'dr_'): string }

// parse
export interface SourceRef { path: string; docKey: DocKey; sha256: string }
export interface ParseArtifact {                   // validated envelope, see §7
  format: 'kg-parse-artifact/1'; sourceSha256: string; sourceName: string;
  recipe: ParseRecipeSpec; parser: { name: 'docling'; version: string };
  producedAt: string; producedOn: string; stats: ParseStats; document: Json; // DoclingDocument, opaque outside `chunk`
}
export interface ParseStats { pages: number; chars: number; charsPerPage: number[]; undecodedFormulas: number; elapsedMs: number }
export interface Parser {
  parse(src: SourceRef, recipe: ParseRecipeSpec): Promise<ParseArtifact>;
}

// chunk (pure, sync, deterministic)
export interface ChunkDraft { id: ChunkId; text: string; sectionPath: string[]; occurrence: number; pages: number[]; blockRefs: string[]; headings: string[] }
export type Chunker = (artifact: ParseArtifact, docKey: DocKey, recipe: ChunkRecipeSpec) => ChunkDraft[];

// embed
export interface Embedder {
  readonly model: string; readonly dims: number;
  embed(texts: readonly string[]): Promise<Float32Array[]>;  // L2-normalized, same order, batch == singletons
}
// core/src/conditioning.ts: the only place templates are rendered
export function renderDocument(space: EmbeddingSpaceSpec, item: Item & { headings?: string[] }): string;
export function renderQuery(space: EmbeddingSpaceSpec, query: string): string;

// store
export interface CorpusStore {
  // recipes, artifacts, documents
  putRecipe(r: RecipeSpec): RecipeId;
  getRecipe(id: RecipeId): Recipe | null;
  putArtifact(a: ParseArtifact): ArtifactId;             // idempotent
  getArtifact(id: ArtifactId): ParseArtifact | null;
  findArtifact(sourceSha256: string, recipe: RecipeId): ArtifactId | null;
  putDocVersion(v: Omit<DocVersion, 'createdAt'>, chunks: ChunkDraft[]): { inserted: ChunkId[]; reused: ChunkId[] };
  currentDocVersions(): DocVersion[];
  setCurrentDocVersion(docKey: DocKey, v: DocVersionId): void;
  // items
  putItems(items: Item[], nodes?: Node[]): void;           // insert-only; same id + different content => throws ImmutableViolation
  getItems(ids: readonly ItemId[]): Item[];                // order of ids; unknown ids omitted
  itemsBySourceChunk(chunkIds: readonly ChunkId[]): Item[];
  // embeddings
  putSpace(s: EmbeddingSpaceSpec): SpaceId;
  missingEmbeddings(space: SpaceId, itemIds: readonly ItemId[]): ItemId[];
  putEmbeddings(space: SpaceId, rows: { itemId: ItemId; vector: Float32Array }[]): void;
  knn(q: { space: SpaceId; vector: Float32Array; buildId: BuildId; kinds: ItemKind[]; limit: number }): { itemId: ItemId; score: number }[];
  // builds and mappings
  putBuild(b: Omit<Build, 'id' | 'createdAt'>): BuildId;   // id = buildId(manifest); idempotent
  getBuild(id: BuildId): Build | null;
  currentBuild(): BuildId | null;
  setCurrentBuild(id: BuildId): void;
  staleCheck(id: BuildId): StaleReport;
  putMappings(run: DerivationRun, ms: Mapping[]): void;   // empty in v0; tables exist
  transaction<T>(fn: () => T): T;
}

// event log
export type EventDraft = Omit<EventEnvelope, 'id' | 'seq' | 'ts' | 'schemaVersion'>;
export interface EventLog {
  openSession(s: { kind: SessionKind; label: string | null; meta: Json }): SessionId;
  append(e: EventDraft): EventEnvelope;      // validates payload with core zod schema; assigns id, seq, ts
}
export type SessionKind = 'agent' | 'eval' | 'cli' | 'test';
export interface LogReader {
  sessions(f?: { kind?: SessionKind; since?: string; limit?: number }): SessionSummary[];
  events(sessionId: SessionId, afterSeq?: number, limit?: number): EventEnvelope[];
  eventsBySearch(searchId: SearchId): EventEnvelope[];
  notes(sessionId: SessionId): SessionNote[];
  addNote(sessionId: SessionId, text: string): void;      // the viewer's only write; separate table
}

// LLM (eval now; extraction later)
export interface LlmRequest { purpose: string; model: string; system: string; messages: { role: 'user' | 'assistant'; content: string }[]; temperature: number; maxTokens: number }
export interface Llm { complete(r: LlmRequest): Promise<{ text: string; model: string; inputTokens: number; outputTokens: number }> }

// eval persistence
export interface EvalRepo {
  putRun(r: EvalRunRecord): void;
  putResult(r: EvalResultRecord): void;
  results(runId: string): EvalResultRecord[];
}
```

### 3.1 Services and the search pipeline

```ts
/** Every domain service receives a context; it never sees EventLog. */
export interface Ctx {
  sessionId: SessionId; buildId: BuildId | null; clock: Clock; ids: IdGen;
  emit<T extends EventType>(type: T, payload: EventPayloads[T], o?: { searchId?: SearchId; buildId?: BuildId }): void;
}

export interface IngestService {
  ingest(ctx: Ctx, req: { sources: SourceRef[] | { artifacts: string[] }; parseRecipe: ParseRecipeSpec; chunkRecipe: ChunkRecipeSpec; space: EmbeddingSpaceSpec }): Promise<IngestReport>;
}
export interface IngestReport { docs: { docKey: DocKey; docVersionId: DocVersionId; unchanged: boolean; inserted: number; reused: number }[]; buildId: BuildId }

export interface SearchRequest { query: string; k: number; searchRecipeId?: RecipeId; buildId?: BuildId }
export interface SearchService { search(ctx: Ctx, req: SearchRequest): Promise<SearchResponse> }

// ---- pipeline ----
export interface QueryVariant { id: string; text: string; origin: 'original' | string }   // v0: exactly one, origin 'original'
export interface Candidate { itemId: ItemId; kind: ItemKind; score: number; sourceChunkIds: ChunkId[]; via: string; queryId: string | null }
export interface Seed { nodeId: NodeId | null; itemId: ItemId | null; weight: number }
export interface SearchState {
  query: string; k: number; buildId: BuildId;
  queries: QueryVariant[];      // query refinement writes here
  candidates: Candidate[];      // ranked, via sortCandidates()
  seeds: Seed[];                // graph walk reads/writes here; [] in v0
}
export interface RankedRef { itemId: ItemId; score: number; rank: number }
export interface StepTrace {
  stepIndex: number; stepType: string; params: Json;
  considered: RankedRef[];      // everything this step scored, before its own cut (pool, e.g. 100)
  output: RankedRef[];          // what it passed on
  queries?: QueryVariant[]; seeds?: Seed[]; details?: Json; durationMs: number;
}
export interface StepEnv { store: Pick<CorpusStore, 'knn' | 'getItems' | 'itemsBySourceChunk'>; embedder: Embedder; space: EmbeddingSpaceSpec & { id: SpaceId }; llm?: Llm }
export interface SearchStep {
  readonly type: string;
  run(state: Readonly<SearchState>, env: StepEnv): Promise<{ state: SearchState; trace: Omit<StepTrace, 'stepIndex' | 'durationMs'> }>;
}
export type StepFactory = (params: Json) => SearchStep;
export interface SearchRecipeSpec extends RecipeSpec { kind: 'search'; spec: { steps: { type: string; params: Json }[] } }
// v0 search recipe: [{type:'vector-knn', params:{pool:100, kinds:['chunk']}}, {type:'truncate', params:{}}]
```

The runner (in `search`) is the only thing that emits per-step events: for each step it calls `ctx.emit('search.step', {stepIndex, trace})`. Steps are pure with respect to logging, so a step is tested by feeding a state and asserting on the returned state and trace. `vector-knn` must iterate over `state.queries` and fuse by max score (v0 has one query, but the contract requires the loop so query refinement needs no change). Logging `considered` with a pool of 100 means the "retrieved but ranked low" pre-check (gold rank distribution) is computable from the log alone.

### 3.2 KgApi and the single logging contract

```ts
export interface ToolDef<I, O> { name: string; input: z.ZodType<I>; output: z.ZodType<O>; summarize(o: O): Json }
export interface KgApi {
  openSession(r: { kind: SessionKind; label?: string; meta?: Json }): Promise<{ sessionId: SessionId }>;
  search(s: SessionId, r: SearchRequest): Promise<SearchResponse>;
  getItems(s: SessionId, r: { itemIds: ItemId[]; buildId?: BuildId }): Promise<Item[]>;
  feedback(s: SessionId, r: { searchId: SearchId; itemId: ItemId | null; relevance: 0 | 1 | 2; note?: string }): Promise<{ eventId: EventId }>;
  reportUsage(s: SessionId, r: { searchId: SearchId; itemIds: ItemId[]; account: string }): Promise<{ eventId: EventId }>;
  reportOutcome(s: SessionId, r: { searchId?: SearchId; success: boolean | null; note: string }): Promise<{ eventId: EventId }>;
  ingest(s: SessionId, r: IngestRequest): Promise<IngestReport>;
  snapshotBuild(s: SessionId, r: { name: string }): Promise<{ buildId: BuildId; stale: StaleReport }>;
  addNote(s: SessionId, r: { text: string }): Promise<void>;
}
export const TOOLS: { [K in keyof Omit<KgApi, 'openSession'>]: ToolDef<Parameters<KgApi[K]>[1], Awaited<ReturnType<KgApi[K]>>> };
```

**The contract (one sentence):** every interaction is a call to a `KgApi` method; `runTool(def, sessionId, input, handler)` (in `core`, invoked by `api`) is the only code path that executes a handler, and it (1) validates input, (2) appends `tool.called`, (3) builds a `Ctx` whose `emit` appends events tagged with the session, the current build and `parentId = tool.called.id`, (4) runs the handler, (5) appends `tool.returned` with `def.summarize(output)` or `tool.failed` with the error, (6) returns.

Consequences, each checked by a test:
- MCP (`mcp`) maps each `TOOLS` entry to an MCP tool with the same name and zod schema and calls `KgApi`; it contains no logging code. Its tests use `FakeKgApi`.
- Eval calls the same `KgApi` with a session of kind `eval`, so agent and eval traffic write identical events (design: "same search path").
- `EventLog.append` is called only inside `core/src/runTool.ts`, which only `api` and `FakeKgApi` invoke (CI grep check), and the `events` table is written only by `eventlog`.
- `kgApiConformance` asserts, for each method, the event sequence `tool.called → domain events → tool.returned`, contiguous `seq`, non-null `buildId` on every item-referencing event, and that `feedback` on an unknown `searchId` yields `tool.failed`.

## 4. SQLite schema (`core/schema.sql`)

Owner column: S = `store`, L = `eventlog`.

```sql
PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS db_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);           -- S: schema_version, database_id, current_build
CREATE TABLE IF NOT EXISTS recipes (recipe_id TEXT PRIMARY KEY, kind TEXT NOT NULL, version TEXT NOT NULL, spec TEXT NOT NULL); -- S
CREATE TABLE IF NOT EXISTS parse_artifacts (artifact_id TEXT PRIMARY KEY, source_sha256 TEXT NOT NULL, recipe_id TEXT NOT NULL REFERENCES recipes,
  source_name TEXT NOT NULL, produced_at TEXT NOT NULL, produced_on TEXT NOT NULL, stats TEXT NOT NULL, body BLOB NOT NULL,   -- gzip of envelope JSON
  UNIQUE (source_sha256, recipe_id));                                                      -- S
CREATE TABLE IF NOT EXISTS documents (doc_key TEXT PRIMARY KEY, current_version TEXT);     -- S
CREATE TABLE IF NOT EXISTS doc_versions (doc_version_id TEXT PRIMARY KEY, doc_key TEXT NOT NULL REFERENCES documents,
  artifact_id TEXT NOT NULL REFERENCES parse_artifacts, chunk_recipe_id TEXT NOT NULL REFERENCES recipes, created_at TEXT NOT NULL); -- S
CREATE TABLE IF NOT EXISTS doc_version_chunks (doc_version_id TEXT NOT NULL REFERENCES doc_versions, ordinal INTEGER NOT NULL,
  chunk_id TEXT NOT NULL REFERENCES items, PRIMARY KEY (doc_version_id, ordinal));         -- S
CREATE INDEX IF NOT EXISTS dvc_chunk ON doc_version_chunks(chunk_id);
CREATE TABLE IF NOT EXISTS items (item_id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK (kind IN ('chunk','relation','summary')),
  text TEXT NOT NULL, recipe_id TEXT REFERENCES recipes, meta TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL,
  CHECK ((kind='chunk') = (recipe_id IS NULL)));                                           -- S
CREATE TABLE IF NOT EXISTS chunks (chunk_id TEXT PRIMARY KEY REFERENCES items, doc_key TEXT NOT NULL, section_path TEXT NOT NULL,
  occurrence INTEGER NOT NULL, pages TEXT NOT NULL, block_refs TEXT NOT NULL, headings TEXT NOT NULL); -- S
CREATE TABLE IF NOT EXISTS item_sources (item_id TEXT NOT NULL REFERENCES items, chunk_id TEXT NOT NULL REFERENCES chunks,
  PRIMARY KEY (item_id, chunk_id));                                                        -- S
CREATE INDEX IF NOT EXISTS item_sources_by_chunk ON item_sources(chunk_id, item_id);
CREATE TABLE IF NOT EXISTS embedding_spaces (space_id TEXT PRIMARY KEY, model TEXT NOT NULL, dims INTEGER NOT NULL, spec TEXT NOT NULL); -- S
CREATE TABLE IF NOT EXISTS embeddings (space_id TEXT NOT NULL REFERENCES embedding_spaces, item_id TEXT NOT NULL REFERENCES items,
  vector BLOB NOT NULL, PRIMARY KEY (space_id, item_id));                                  -- S; knn = vec_distance_cosine brute force
CREATE TABLE IF NOT EXISTS builds (build_id TEXT PRIMARY KEY, name TEXT, parent_id TEXT, created_at TEXT NOT NULL,
  manifest TEXT NOT NULL, mixed_recipes INTEGER NOT NULL);                                 -- S
CREATE TABLE IF NOT EXISTS build_items (build_id TEXT NOT NULL REFERENCES builds, item_id TEXT NOT NULL REFERENCES items,
  PRIMARY KEY (build_id, item_id));                                                        -- S
-- v0-empty tables (shape committed now)
CREATE TABLE IF NOT EXISTS nodes (node_id TEXT PRIMARY KEY, name TEXT NOT NULL);           -- S
CREATE TABLE IF NOT EXISTS relation_nodes (item_id TEXT NOT NULL REFERENCES items, node_id TEXT NOT NULL REFERENCES nodes,
  surface TEXT NOT NULL, role TEXT, PRIMARY KEY (item_id, node_id, surface));              -- S
CREATE INDEX IF NOT EXISTS relation_nodes_by_node ON relation_nodes(node_id);
CREATE TABLE IF NOT EXISTS summary_members (item_id TEXT NOT NULL REFERENCES items, member_id TEXT NOT NULL REFERENCES items,
  PRIMARY KEY (item_id, member_id));                                                       -- S
CREATE TABLE IF NOT EXISTS derivation_runs (run_id TEXT PRIMARY KEY, recipe_id TEXT NOT NULL REFERENCES recipes,
  input_state_hash TEXT NOT NULL, base_build_id TEXT, created_at TEXT NOT NULL);           -- S
CREATE TABLE IF NOT EXISTS mappings (mapping_id TEXT PRIMARY KEY, kind TEXT NOT NULL, subject TEXT NOT NULL,
  from_id TEXT NOT NULL, to_id TEXT NOT NULL, run_id TEXT NOT NULL REFERENCES derivation_runs, confidence REAL, note TEXT); -- S
CREATE INDEX IF NOT EXISTS mappings_from ON mappings(from_id); CREATE INDEX IF NOT EXISTS mappings_to ON mappings(to_id);
CREATE TABLE IF NOT EXISTS build_runs (build_id TEXT NOT NULL REFERENCES builds, run_id TEXT NOT NULL REFERENCES derivation_runs,
  PRIMARY KEY (build_id, run_id));                                                         -- S
-- eval
CREATE TABLE IF NOT EXISTS eval_runs (run_id TEXT PRIMARY KEY, eval_set_id TEXT NOT NULL, eval_set_sha256 TEXT NOT NULL,
  build_id TEXT NOT NULL, session_id TEXT NOT NULL, config TEXT NOT NULL, created_at TEXT NOT NULL); -- S
CREATE TABLE IF NOT EXISTS eval_results (run_id TEXT NOT NULL REFERENCES eval_runs, question_id TEXT NOT NULL,
  condition TEXT NOT NULL, search_id TEXT, retrieved TEXT, recall TEXT, answer TEXT, judge_score REAL, judge_raw TEXT,
  PRIMARY KEY (run_id, question_id, condition));                                           -- S
-- log
CREATE TABLE IF NOT EXISTS sessions (session_id TEXT PRIMARY KEY, kind TEXT NOT NULL, label TEXT, meta TEXT NOT NULL,
  started_at TEXT NOT NULL);                                                               -- L
CREATE TABLE IF NOT EXISTS events (event_id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions, seq INTEGER NOT NULL,
  ts TEXT NOT NULL, type TEXT NOT NULL, schema_version INTEGER NOT NULL, build_id TEXT, search_id TEXT, parent_id TEXT,
  payload TEXT NOT NULL, UNIQUE (session_id, seq));                                        -- L; append-only (trigger forbids UPDATE/DELETE)
CREATE INDEX IF NOT EXISTS events_search ON events(search_id); CREATE INDEX IF NOT EXISTS events_type_ts ON events(type, ts);
CREATE TRIGGER IF NOT EXISTS events_no_update BEFORE UPDATE ON events BEGIN SELECT RAISE(ABORT, 'append-only'); END;
CREATE TRIGGER IF NOT EXISTS events_no_delete BEFORE DELETE ON events BEGIN SELECT RAISE(ABORT, 'append-only'); END;
CREATE TABLE IF NOT EXISTS session_notes (note_id INTEGER PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions,
  ts TEXT NOT NULL, text TEXT NOT NULL);                                                   -- L
```

Items are insert-only (same as events); a trigger forbids `UPDATE` on `items`, `item_sources`, `mappings` (Rules 2, 3). Eval sets themselves are canonical JSON files (`evals/<setId>.json`, `setId` = hash), not tables: they are pinned by content hash, portable across databases (cross-corpus questions), and diffable in git.

## 5. Event catalog

Every payload is a zod schema in `core/src/events.ts`; `EventLog.append` rejects anything else. "B" = `buildId` required.

| Type | Emitted by | Payload | B |
|---|---|---|---|
| `session.started` | eventlog (on openSession) | `{kind, label, meta}` | |
| `tool.called` | runTool (api) | `{tool, input}` | |
| `tool.returned` | runTool (api) | `{tool, summary, durationMs}` | |
| `tool.failed` | runTool (api) | `{tool, error: {code, message}, durationMs}` | |
| `ingest.started` | ingest | `{docKey, sourceSha256, parseRecipeId, chunkRecipeId}` | |
| `ingest.parsed` | ingest | `{docKey, artifactId, cached, stats}` | |
| `ingest.chunked` | ingest | `{docKey, docVersionId, chunkCount, inserted, reused, dropped}` | |
| `ingest.embedded` | ingest | `{spaceId, embedded, skipped, elapsedMs}` | |
| `ingest.completed` | ingest | `{docKey, docVersionId, unchanged}` | |
| `build.created` | ingest / api.snapshotBuild | `{buildId, name, parentId, mixedRecipes, itemCount}` | B |
| `build.stale` | api.snapshotBuild, eval | `{buildId, missingChunkIds}` | B |
| `query` | search runner | `{searchId, query, k, searchRecipeId}` | B |
| `search.step` | search runner | `{searchId, trace: StepTrace}` | B |
| `search.result` | search runner | `{searchId, items: {itemId, kind, rank, score, sourceChunkIds}[]}` | B |
| `items.fetched` | api.getItems | `{itemIds}` | B |
| `feedback` | api.feedback | `{searchId, itemId, relevance: 0\|1\|2, note}` | B (of the search) |
| `usage` | api.reportUsage | `{searchId, itemIds, account}` | B |
| `outcome` | api.reportOutcome | `{searchId, success, note}` | |
| `llm.called` | eval (via a logged Llm wrapper) | `{purpose, model, requestSha256, responseSha256, inputTokens, outputTokens}` | |
| `eval.run.started` | eval | `{runId, evalSetId, evalSetSha256, conditions, k}` | B |
| `eval.question.scored` | eval | `{runId, questionId, condition, searchId, recallAtK, judgeScore}` | B |
| `eval.run.completed` | eval | `{runId, summary}` | B |

`feedback`, `usage` and `outcome` copy `buildId` from the referenced search's `query` event (looked up via `LogReader.eventsBySearch`), so Rule 6 holds even if the current build changed between search and feedback.

## 6. Testing in isolation

### 6.1 What `testkit` ships

| Port | Fake | Broken fake (must fail suite) | Conformance suite |
|---|---|---|---|
| `Parser` | `FixtureParser` (returns committed artifacts by sha256) | `DriftingParser` (sets `recipe` ≠ requested) | `parserConformance(make)`: envelope validates; `sourceSha256` matches file; recipe echoed verbatim; same input twice → deep-equal `document` |
| `Chunker` | none (pure function; golden tests instead) | `IndexIdChunker` (spike's index-based IDs) | `chunkerConformance(chunk)`: golden outputs on fixtures; v1→v2 ID diff; determinism; every chunk ≤ maxChars; no empty text; `occurrence` correct on duplicated paragraph |
| `Embedder` | `HashEmbedder(dims=64)`: token-hash bag of words, L2-normalized | `UnnormalizedEmbedder`, `BatchOrderEmbedder` | `embedderConformance(make)`: dims; unit norm ±1e-6; deterministic; `embed([a,b]) == [embed([a]), embed([b])]`; empty string allowed |
| `CorpusStore` | `InMemoryCorpusStore` | `MutableStore` (allows overwriting an item), `LeakyKnnStore` (ignores `buildId`) | `corpusStoreConformance(make)`: ~40 cases incl. immutability violation throws; `getItems` order; `itemsBySourceChunk` both directions; knn restricted to build and kinds, ties by id; `putBuild` idempotent; `staleCheck` after doc re-ingest; transaction rollback |
| `EventLog`+`LogReader` | `InMemoryEventLog` | `GappySeqLog`, `NoValidateLog` | `eventLogConformance(make)`: seq contiguous per session; schema rejection; `buildId` refine; `afterSeq` paging; `eventsBySearch`; notes don't touch events |
| `Llm` | `ScriptedLlm` (map from `requestSha256` or `purpose` → text; throws on unscripted) and `ReplayLlm` (reads a recorded JSONL cache, for reproducible eval) | n/a | `llmConformance`: request hash stable |
| `SearchStep` | `StaticStep(candidates)` | `MutatingStep` (mutates input state), `UnrankedStep` | `searchStepConformance(factory, params, state)`: input not mutated; output sorted via `sortCandidates`; ranks contiguous; trace.output ⊆ trace.considered; every candidate has non-empty `sourceChunkIds` (Rule 1) |
| `KgApi` | `FakeKgApi` (scripted responses, records calls, writes events through the canonical `runTool` from core) | `SilentKgApi` (skips `tool.returned`) | `kgApiConformance(make)`: event sequences per method (§3.2); feedback on unknown search fails; `buildId` propagation |
| `Clock`, `IdGen` | `FixedClock(start, stepMs)`, `SeqIds()` → `se_0001`… | | |

A meta-test in `testkit` runs each suite against its broken fake and asserts failure. A suite that stops catching its broken fake fails CI.

`FakeKgApi` is the one fake that contains real logic (`runTool`). Rather than make `testkit` depend on `api`, the canonical `runTool` lives in `core/src/runTool.ts` as a pure higher-order function over `EventLog`; `api` uses it, and so does the fake. This removes the risk of the fake's logging diverging from the real one.

### 6.2 Golden vectors (`testkit/golden/ids.json`)

About 30 cases: `canonicalJson` (key order, unicode escapes, `1.0` vs `1`, nested arrays), `normText` (NBSP, CRLF, ligature left alone under NFC), `normName` ("Dorsolateral Striatum (DLS)." → "dorsolateral striatum (dls)"), `chunkId` for the mini-corpus chunks, `recipeId` for the v0 default recipes, `buildId` for a two-doc manifest. Computed once in Phase 1 by `core` and reviewed by hand against the formulas; any package that recomputes IDs (only `core` should) is checked against them.

### 6.3 Fixtures that carry meaning

| Fixture | Content | What a wrong implementation would get wrong |
|---|---|---|
| `mini-corpus/v1/{gas,entropy}.docling.json` | Hand-built DoclingDocument JSON, 2 docs, 12 expected chunks: preamble with no heading; nested headings (level 1/2); a paragraph duplicated verbatim in one section; a 3,200-char paragraph; a table; a `<!-- formula-not-decoded -->`; page-header furniture; a picture with caption | furniture leaking into text; duplicate paragraph colliding (missing `occurrence`); long paragraph not split; table dropped; heading level ignored |
| `mini-corpus/v2/` + `expected-diff.json` | v1 with a paragraph inserted at the start of `gas` §1 and one edited in `entropy` §3 | `expected-diff.json` lists exactly which v1 IDs survive (all outside those sections, and the unchanged chunks inside them), which vanish, which are new; index-based schemes fail |
| `mini-corpus/expected-chunks.json` | full `ChunkDraft[]` for v1 | algorithm drift |
| `docling-real/thermo-plischke-p2-4.docling.json` | real docling 2.140 output (OCR off), trimmed to 3 pages, plus the envelope | normalizer handles the real tree (`body.children` refs, `groups`, `furniture`), not just the hand-built one |
| `search/queries.json` | 6 queries over mini-corpus with `HashEmbedder`, each with expected top-3 IDs computed by hand from word overlap, including one where a distractor chunk shares a heading word, and one with `k` larger than the build | KNN over stale chunks (v2 build must not return v1-only chunks); wrong tie-break; truncation off by one |
| `log/session-agent.jsonl`, `log/session-eval.jsonl`, `log/session-live-partial.jsonl` | recorded event streams: ingest, 3 searches with steps, feedback per item and overall, a `tool.failed`, a session cut mid-search | viewer rendering, paging with `afterSeq`, analysis tools; partial session tests the live view |
| `eval/mini-set.json` + `eval/llm-script.jsonl` + `eval/expected-metrics.json` | 5 questions (2 single-hop, 2 multi-hop with 2 gold chunks each, 1 topic) with gold chunk IDs; scripted retrieval results where one multi-hop question gets one of two gold chunks and one gold chunk is reached only via a relation item whose `sourceChunkIds` includes it; hand-computed recall@1/3/5 overall and per type | recall computed per item instead of per unique gold chunk; partial multi-hop credit wrong; summaries not scored separately; per-type aggregation |
| `parse/tiny.pdf` | 2-page generated PDF with a heading, two paragraphs, a table | used by the Python sidecar's pytest and by the optional live TS test |

### 6.4 Package cards

Each Phase 2 package gets `packages/<name>/CARD.md` written in Phase 1: the ports it implements, the exact test command, the fixtures it may read, forbidden imports, the decisions already made (with log links), and the open questions it should note but not decide. An implementer needs the card, `core`, and `testkit`; nothing else.

### 6.5 Change proposals

`scratch/sprint-1/change-proposals/<package>-<n>.md`: the contract text at issue, the failing case or evidence, the proposed change, the packages and tests it touches. The implementer keeps working against the current contract. The reviewer batches accepted proposals into a `core` minor version bump (`CONTRACT_VERSION`), and each package's test run prints the version it was built against.

## 7. Docling sidecar and parse artifacts

**Form:** a thin Python CLI (`parse-sidecar`, entry point `kg-parse`), invoked as a subprocess per document. Not docling-serve: the CLI has a three-command surface that a cheap model can implement and test with pytest, and it runs unchanged on a GPU server, where its output directory is copied back. A later `serve` mode or docling-serve would be one more `Parser` implementation.

```
kg-parse version                         → {"doclingVersion":"2.140.0","sidecar":"0.1.0"}
kg-parse check-recipe RECIPE.json        → exit 0 + echoed recipe, or exit 3 if doclingVersion ≠ installed / unknown option
kg-parse parse --input X.pdf --recipe RECIPE.json --out DIR [--name NAME]
                                         → writes DIR/<sha256[:16]>.<recipeSha256[:12]>.kgparse.json.gz
                                           stdout: one JSON line {"path":..., "sourceSha256":..., "stats":{...}}
                                           exit 2 on parse failure (stderr has traceback)
```

The sidecar never computes kg IDs. It hashes file bytes (sha256) and embeds the recipe verbatim; TS computes `recipeId` and `artifactId` on import. No cross-language hashing agreement is needed beyond sha256 of bytes. The file name hash is for humans; identity is recomputed.

**Envelope** (`core/schemas/parse-artifact.schema.json`, generated from the zod `ParseArtifact` schema in Phase 1 so the Python side validates against the same thing):

```json
{ "format": "kg-parse-artifact/1",
  "sourceSha256": "…64 hex…", "sourceName": "ThermoPlischke.pdf",
  "recipe": { "kind": "parse", "version": "1", "spec": { "parser": "docling", "doclingVersion": "2.140.0",
              "options": { "do_ocr": false, "do_table_structure": true, "do_formula_enrichment": false } } },
  "parser": { "name": "docling", "version": "2.140.0" },
  "producedAt": "2026-10-17T12:00:00Z", "producedOn": "m2pro-local",
  "stats": { "pages": 24, "chars": 35562, "charsPerPage": [ … ], "undecodedFormulas": 105, "elapsedMs": 6000 },
  "document": { …DoclingDocument.export_to_dict()… } }
```

`stats` is the hook for the future quality gate: an escalation policy reads `stats` (chars per page, undecoded formulas) and chooses a second recipe (OCR on) for the same file; the result is a second artifact with a different `artifactId`. Nothing in v0 escalates.

**Import path:** `ArtifactDirParser` implements `Parser` by looking up `DIR/*.kgparse.json.gz` with matching `sourceSha256` and recipe; `ingest` accepts either sources (parse locally via `SubprocessParser`, or skip if `store.findArtifact` hits) or a list of artifact files (`kg ingest --artifacts DIR`). Either way the artifact is stored in `parse_artifacts` and chunking runs locally in TS from `artifact.document`. Because `chunk` reads only the stored JSON, chunk IDs are identical wherever parsing ran.

**Chunker algorithm `section-pack/1`** (specified here so the implementer works from text, not from HybridChunker's source):
1. Normalize: walk `document.body` in reading order, resolving `$ref`s into `texts`/`tables`/`groups`/`pictures`; drop `content_layer == "furniture"`. `title`/`section_header` → heading (level from `level`, default 1); `text`, `paragraph`, `list_item`, `caption`, `footnote` → text block; `formula` → block text `[formula]`; `table` → rows joined by `\n`, cells by ` | `; picture → its caption only.
2. Sections: a heading closes the current section; the section path is the heading stack by level (equal levels replace).
3. Pack within a section: append blocks (joined by `\n\n`) while length ≤ `targetChars` (1000); a block > `maxChars` (1500) is split at sentence ends (`. ` followed by uppercase) into pieces ≤ `maxChars`, hard split at `maxChars` if no sentence end; a final piece < `minChars` (200) merges into the previous chunk of the same section if the result ≤ `maxChars`.
4. Number `occurrence` per (section, `normText`); compute `chunkId`. Headings are not in `text`; they go to `headings` for the embedding template.

## 8. Phase 2 work breakdown

All packages depend only on `core` + `testkit`, so every work package can start on day one. There are no inter-package build dependencies in Phase 2; ordering matters only in Phase 3 (wiring) and Phase 4 (chunker freeze).

| WP | Package | Size | Acceptance (tests written in Phase 0/1) | Model | Why |
|---|---|---|---|---|---|
| 1 | `parse-sidecar` | S | pytest: envelope validates against JSON Schema on `tiny.pdf`; `check-recipe` exit codes; OCR flag honoured | Sonnet | docling API knowledge, Python env quirks |
| 2 | `parse` | S | `parserConformance` for `ArtifactDirParser`; `SubprocessParser` against a stub `kg-parse` script in testkit; live test skipped without docling | Haiku | plumbing, fully specified |
| 3 | `chunk` | M | `chunkerConformance`, golden chunks, v1→v2 diff, real-docling fixture | Sonnet | most consequential package; ID stability; frozen before Phase 4 |
| 4 | `embed` | S | `embedderConformance` against a recorded Ollama HTTP fixture (msw/nock) + live test if Ollama up | Haiku | one HTTP endpoint |
| 5 | `store` | M | `corpusStoreConformance`, EvalRepo tests, trigger tests, 20k-vector knn latency smoke | Sonnet | sqlite-vec, transactions, many methods |
| 6 | `eventlog` | S | `eventLogConformance`, trigger tests | Haiku | narrow, well specified |
| 7 | `ingest` | M | scenario tests with fakes: first ingest; re-ingest unchanged = no new rows, same build, `unchanged: true`; v1→v2 produces expected inserted/reused counts and a new build; artifact-only ingest; embedder failure mid-batch leaves no half doc version | Sonnet | orchestration and idempotency invariants |
| 8 | `search` | S | `searchStepConformance` for `vector-knn`, `truncate`; runner tests asserting `query`/`search.step`/`search.result` events; `search/queries.json` | Haiku | small, golden-tested |
| 9 | `api` | S | `kgApiConformance` with fakes; feedback build propagation; unknown-search failure | Sonnet | owns the logging contract wiring; small but central |
| 10 | `mcp` | S | tool list equals `TOOLS`; each tool round-trips through `FakeKgApi` via MCP in-memory transport | Haiku | adapter |
| 11a | `eval` metrics and runner | M | `expected-metrics.json`; three conditions sequenced correctly with `FakeKgApi` + `ScriptedLlm`; results persisted via fake EvalRepo; stale build flagged | Haiku | arithmetic against hand-computed fixtures |
| 11b | `eval` prompts (generation, judge) | M | prompt files + output parsers; parser tests on scripted outputs; review samples real outputs | Opus (prompts) + Haiku (parsers) | roadmap: prompt design goes to stronger models |
| 12 | `viewer` | S–M | renders `log/*.jsonl` via `InMemoryEventLog`; polling with `afterSeq` picks up appended events; note add; Playwright snapshot | Haiku/Sonnet | static page; live view is the tricky part |
| 13 | `app` (Phase 3) | M | end-to-end on stat-mech: ingest 4 PDFs, search, feedback, eval smoke | Sonnet | integration; reads everything by definition |

11a and 11b share the `eval` directory with separate owned subdirectories (`src/metrics`, `src/prompts`); the boundary is the `QuestionDraft` and `JudgeVerdict` types in core.

## 9. Traceability

| Requirement | Where |
|---|---|
| Rule 1: derived items cite chunks | `Item.sourceChunkIds` non-empty (zod); `item_sources` table; `searchStepConformance` checks every candidate |
| Rule 2: immutability | insert-only repos, `ImmutableViolation` on conflicting `putItems`, `items`/`events` update triggers; derived IDs include `recipeId` |
| Rule 3: equivalence as mapping | `mappings` + `derivation_runs` tables; `CorpusStore.putMappings`; no update/delete API exists |
| Rule 4: items record recipe | `items.recipe_id` with CHECK (null only for chunks); `doc_versions.chunk_recipe_id`; `parse_artifacts.recipe_id`; embedding spaces keyed by spec |
| Rule 5: no silent orphaning | `CorpusStore.staleCheck`, `build.stale` event; eval refuses or flags a stale pinned build |
| Rule 6: feedback keys to chunks; events record build | `buildId` refine on item-referencing events; feedback copies the search's build; eval sets pin gold chunk IDs |
| v0.1 ingest and chunk | `parse-sidecar`, `parse`, `chunk`, `ingest`; idempotency via `findArtifact` + content-hashed doc versions and builds |
| v0.2 store | `store` + `eventlog` on one SQLite file; `core/schema.sql` |
| v0.3 search | `search` runner + `vector-knn`/`truncate`; `SearchResponse` with `searchId`; `search.step` traces with `considered` pool |
| v0.4 event log | `eventlog`; `runTool` in core used by `api`; MCP and eval both go through `KgApi` |
| v0.5 agent feedback | `KgApi.feedback/reportUsage/reportOutcome`; `feedback` event with `relevance` as the structured field |
| v0.6 eval harness | `eval` (11a/11b); eval sets as pinned JSON; `eval_runs`/`eval_results`; conditions no-context/gold/retrieved, oracle variants as condition names |

Gap: the companion analysis tools (failures by type, single-question diagnosis, build diff) are not a v0 package; they read `LogReader` and `EvalRepo` and can be added as `analysis` later without contract change.

## 10. Extension walk-throughs

| Layer | New packages | New/changed contracts | Existing interfaces modified? |
|---|---|---|---|
| Relation layer | `extract` (LLM, prompts) | new port `LocalDeriver { derive(ctx, chunks: Chunk[], recipe, llm): Promise<{items: Relation[]; nodes: Node[]}> }`; new recipe kind already in `RecipeKind`; search recipe adds `kinds:['chunk','relation']`; ingest or a `kg derive` command appends relation items to a new build | No for store (tables, `putItems(items, nodes)` already exist). `Relation` and `NodeRef` already typed. `Ctx` reused. Eval recall already uses `sourceChunkIds`. A `getRelationNodes` read on `CorpusStore` is an addition. |
| Graph walk | none or `graph` (in-memory PPR) | new step type `ppr` registered in `search`; new read port `GraphRead { relationsOfNodes(ids, buildId); nodesOfRelations(ids) }` implemented by `store` | `SearchState.seeds` and `StepTrace.seeds` already exist. `StepEnv.store` is a `Pick<CorpusStore,…>`; adding `GraphRead` to `StepEnv` is an additive field. |
| Equivalence | `equivalence` | new port `SetDeriver { run(ctx, build, recipe): Promise<{run: DerivationRun; mappings: Mapping[]}> }`; builds list run IDs (`build_runs`) | **Yes, semantically:** reads must offer a canonical view where `duplicate-of` merges sources and nodes resolve to canonical IDs. Plan: add `view?: 'raw' \| 'canonical'` to `getItems`/`knn` (optional, default `raw`), or a `canonicalize` search step. Either is additive in signature but changes what downstream steps see; the walk must be told which view it gets. |
| Reranking | `rerank` | new port `Reranker { score(query, texts): Promise<number[]> }`; step type `rerank` | No. Note: Ollama does not serve cross-encoders natively; the port may need a sidecar (Python) like docling. |
| Query refinement | none | step type `rewrite` writing `state.queries`; uses `StepEnv.llm` | No, because `vector-knn` already loops over `state.queries` (contract requirement now). Critique-driven re-querying needs a loop in the runner: **runner change** (a step returning `{repeatFrom: stepIndex}`), not a port change. |
| Community summaries | `cluster`, `summarize` | `SetDeriver` reuse; `Summary` items, `summary_members`; eval scores `kind='summary'` separately (11a already aggregates per kind) | No interface change expected; staleness of summaries uses `staleCheck` extended to member items (internal to `store`). |

Honest summary: equivalence is the one layer that changes the meaning of an existing read, and multi-round query refinement changes the runner. Everything else is new step types, new ports and filling existing tables.

## 11. Decisions

| # | Decision | Kind | Rationale / options |
|---|---|---|---|
| D1 | Star topology: packages depend on `core` only | evidence-resolvable (by the roadmap's independence criterion) | Options: layered (search → store), star. Layered lets search call real store, but forces implementers to read or wait on store. Star costs ports + fakes in core, written once by a strong model. |
| D2 | `runTool` in core, called by `api` and by `FakeKgApi` | arbitrary | Putting it in `api` would force testkit to depend on `api`; result is the same contract either way. |
| D3 | Logging boundary = `KgApi`, which MCP exposes 1:1 | **needs the user** (confirm) | Design says logging is "a property of the MCP tool layer". Options: (a) log in the MCP server and run eval through an in-process MCP client; (b) log at `KgApi`, MCP is a thin adapter. Both give one path for agent and eval. (b) keeps MCP trivial and tests without transport. Recommend (b); it reads the design's "MCP tool layer" as the tool contract, not the transport. |
| D4 | Chunk ID = H(docKey, sectionPath, H(text), occurrence); no ordinal, no database ID | evidence-resolvable | Options: global index+text (spike), section+ordinal, section+text+occurrence. Insertion test (fixture v1→v2) settles it by construction; Phase 1 runs it on a real edited stat-mech section. |
| D5 | Chunking reimplemented in TS (`section-pack/1`) instead of docling HybridChunker in the sidecar | evidence-resolvable | TS: pure, fixture-testable without Python, chunker owned by one package. Python: reuse of HybridChunker (tokenizer-aware), but chunking then needs the Python env locally and its ID rules sit in Python. Spike: run both on the 4 PDFs, compare chunk count and size distribution (HybridChunker gave median 857, max 1146 chars). |
| D6 | docKey defaults to file basename without extension, overridable | arbitrary | Any stable name works; it only has to survive edits (so not the file hash). |
| D7 | Thin CLI sidecar, subprocess per doc, artifacts as `.kgparse.json.gz` files | arbitrary | docling-serve would work too; the `Parser` port hides it and remote use is "run CLI there, copy dir". |
| D8 | Parse artifacts also stored as gzip blobs in SQLite | arbitrary | ~2 MB for the corpus; keeps the database one portable file. |
| D9 | Store and log ports synchronous | arbitrary | better-sqlite3 is sync; a remote store would need async later, which is a signature change (noted). |
| D10 | Brute-force KNN via `vec_distance_cosine` on a plain table, not `vec0` | arbitrary | Avoids per-dimension virtual tables per space; spike shows brute force is fast enough. |
| D11 | Every content-changing ingest auto-creates a content-hashed build; search filters by build | evidence-resolvable (design reading) | Needed so superseded (never-deleted) chunks stay out of results and every search event has a build (Rule 6). |
| D12 | `considered` pool of 100 logged per step | arbitrary | Large enough for rank-distribution pre-check at 337 chunks; cheap. |
| D13 | Relevance scale 0/1/2 | arbitrary | Any small ordinal aggregates the same way. |
| D14 | Eval sets as content-hashed JSON files; runs/results in SQLite | arbitrary | Portable across databases (cross-corpus) and diffable; results need joins with the log. |
| D15 | LLM for question generation and judging | **needs the user** | Options: Claude API (better questions and judging, costs money, network); local Ollama model (free, weaker judge, more leakage risk). Affects Phase 4 trustworthiness and cost. Recommend Claude for generation and judge, behind `Llm` with `ReplayLlm` caching so reruns are free and reproducible. Blocks: 11b prompt tuning (11a is unblocked). |
| D16 | Embedding model | evidence-resolvable | Spike in Phase 1: 2-3 Ollama models (e.g. nomic-embed-text, mxbai-embed-large, bge-m3) on stat-mech chunks; speed and a small hand-made recall check. Space keyed by model, so switching is cheap. |
| D17 | Same document in two databases gets identical chunk IDs | **needs the user** (light) | Enables running one eval set against a combined database; the alternative (database-scoped IDs) isolates databases fully. Recommend shared IDs; cheap to reverse before Phase 4, expensive after. |

Needs the user: D3, D15, D17.

## Conflicts

- **Logging location.** Design v0.4: "Logging is a property of the MCP tool layer." Design Core Concepts: eval runs "pass through the same search path". This draft puts logging in `KgApi`/`runTool`, which MCP exposes one-to-one (D3).
- **Chunk text vs. "verbatim span".** `section-pack/1` joins blocks with `\n\n`, renders tables as `|`-joined text and formulas as `[formula]`. The chunk is verbatim with respect to docling's text, not to the PDF. I think this is within intent; noted.
- **Builds in v0.** The design introduces builds alongside derived items; v0 has none, but this draft creates builds in v0 to satisfy Rule 6 ("events that reference derived items also record the build") for chunk results and to filter superseded chunks. This is more than v0 strictly asks.

## 12. Biggest risk

That `section-pack/1` over docling's JSON can be specified tightly enough, in text and fixtures, for one agent to implement it and get the same chunks on real stat-mech output. The hand-built fixture models the DoclingDocument tree as I understand it (`body` refs, `groups`, `furniture`, heading levels); if real output nests differently (list groups, inline groups, multi-page paragraphs split into two `texts` entries, unreliable heading levels on Plischke), the normalizer will need judgment the card does not give, and chunk IDs could shift in ways the golden diff does not cover. Mitigation in Phase 1: the real-docling fixture from ThermoPlischke pages 2-4 plus one Kardar slice, an edit-and-reingest test on a real section, and a side-by-side against HybridChunker counts (D5) before the chunker card is frozen.
