# v0 architecture draft: minimal lens

Lens: use the fewest packages and the least machinery that still satisfies the six Rules and v0 items 1-6. Where I add a seam, it is because a named planned layer needs it. Section 13 lists what I left out on purpose.

Summary in five lines:
- There are six TypeScript packages plus a Python sidecar directory. Four of the packages depend only on `core`, and one composition root (`server`) wires everything together.
- One class, `Engine`, is the only way in for MCP, the CLI, the viewer's note writes and eval. It is also the only code that writes events, so "every interaction reaches the log" holds by construction.
- One SQLite file per database. Plain tables plus sqlite-vec's scalar `vec_distance_cosine` for brute-force KNN, with no virtual tables. Immutability is enforced by triggers.
- The chunker is a pure TypeScript function over docling JSON. A machine that only imports parse artifacts therefore needs no Python.
- A chunk ID is `H(docId, sectionPath, normalizedText, occurrence)`. It has no global index, so an insertion changes IDs only inside its own section.

---

## 1. Packages and dependency directions

| Package | Owns | Runtime deps |
|---|---|---|
| `@kg/core` | All types, ID derivation, all interfaces (`Store`, `Parser`, `Chunker`, `Embedder`, `Llm`, `SearchStep`, `Engine`), event catalog types, and `core/testing` (fakes, conformance suites, fixtures) | `node:crypto` only |
| `@kg/store` | SQLite schema, `SqliteStore implements Store`, KNN, stale check | `core`, better-sqlite3, sqlite-vec |
| `@kg/ingest` | `DoclingCliParser implements Parser` (calls the sidecar), parse-artifact import and validation, `doclingChunker implements Chunker`, `OllamaEmbedder implements Embedder` | `core` |
| `@kg/engine` | `createEngine()`: ingest orchestration, builds, search pipeline runner plus v0 steps, feedback, the logging contract | `core` |
| `@kg/eval` | Question generation, eval-set files, eval runs (recall@k, three answer conditions, oracle variants), judge, pre-check reports, `AnthropicLlm` / `OllamaLlm implements Llm` | `core` |
| `@kg/server` | Composition root: CLI (`kg ...`), MCP stdio server, viewer (tiny HTTP server plus one static HTML page) | all of the above, `@modelcontextprotocol/sdk`, zod |
| `sidecar/` (Python, uv project, not a pnpm package) | `kg-parse` CLI wrapping docling: PDF to parse artifact | docling |

```
            ┌────────────── server ──────────────┐
            │      (composition root only)       │
            ▼        ▼         ▼         ▼       │
          store    ingest    engine     eval     │
            │        │         │         │       │
            └────────┴────┬────┴─────────┘       │
                          ▼                      │
                        core  ◄──────────────────┘
ingest ──(child process, JSON file)──► sidecar/ (Python)
```

Rules:
- Only `server` imports more than `core`. `store`, `ingest`, `engine` and `eval` import only `@kg/core`, so none of them can reach into a sibling's code. Each receives its collaborators by constructor injection.
- `core` has no I/O.
- devDependencies follow the same rule. Tests in a leaf package use `@kg/core/testing`, never a sibling.
- pnpm workspace boundaries enforce this. A root test (`deps.test.ts`) reads each `package.json` and fails on any edge not in the table.

Phase 2 work packages are owned directories. Two of them share the `ingest` package (`ingest/src/chunker/` and `ingest/src/adapters/`). Section 8 has the breakdown.

---

## 2. Core data model

```ts
// @kg/core/src/types.ts
export type ChunkId = `c_${string}`;
export type RecipeId = `r_${string}`;
export type NodeId = `n_${string}`;
export type ItemId = ChunkId | `rel_${string}` | `sum_${string}`;
export type MappingId = `m_${string}`;
export type BuildId = `b_${string}`;
export type DerivationId = `d_${string}`;
export type SearchId = `s_${string}`;
export type SessionId = `ses_${string}`;
export type ItemKind = 'chunk' | 'relation' | 'summary';

/** Anything search returns. Chunks are items whose only source is themselves. */
export interface Item {
  id: ItemId;
  kind: ItemKind;
  text: string;                 // verbatim for chunks; self-contained description for relations
  sourceChunkIds: ChunkId[];    // Rule 1. For a chunk: [its own id]
  recipeId: RecipeId | null;    // Rule 4. null only for chunks (ground truth)
  derivationId: DerivationId | null;
  createdAt: string;            // ISO
}

export interface Chunk extends Item {
  kind: 'chunk';
  id: ChunkId;
  docId: string;                // stable document handle, see ids.ts
  sectionPath: string[];        // heading texts, outermost first; [] before the first heading
  occurrence: number;           // count of earlier chunks in the same doc+section with identical normalized text
  pages: number[];              // provenance from docling prov
  headings: string[];           // = sectionPath, kept separately for embedding conditioning
}

/** v0: output of the chunker before IDs are assigned. */
export interface ChunkDraft { sectionPath: string[]; text: string; pages: number[] }

export interface Node {         // shared handle, no content, no type
  id: NodeId;
  name: string;                 // normalized name (the ID input)
}

export interface Relation extends Item {
  kind: 'relation';
  nodes: { nodeId: NodeId; surfaceForm: string; role?: string }[]; // any arity
  structured?: Record<string, unknown>; // optional per-database structure; the text stays authoritative
}

export interface Summary extends Item {
  kind: 'summary';
  memberIds: ItemId[];          // source relations (staleness); sourceChunkIds = union of members' sources
  level: number;
}

export type MappingKind = 'same-as' | 'duplicate' | 'refines' | 'supersedes';
export interface Mapping {
  id: MappingId;
  kind: MappingKind;
  fromId: ItemId | NodeId;
  toId: ItemId | NodeId;
  recipeId: RecipeId;           // what produced it
  stateRef: BuildId;            // the state it was computed from (set-level)
  confidence?: number;
  note?: string;
  createdAt: string;
}

export type RecipeKind = 'parse' | 'chunk' | 'embed' | 'search'
  | 'extract' | 'equivalence' | 'summary' | 'eval-gen' | 'judge';
export interface Recipe {
  id: RecipeId;                 // = recipeId(kind, spec)
  kind: RecipeKind;
  name: string;                 // human label, e.g. "docling-standard-noocr"
  spec: Record<string, unknown>;// full spec: models (with digests), prompts, params, tool versions
}

/** A record that a recipe ran on given inputs, even if it produced nothing. Empty in v0. */
export interface Derivation {
  id: DerivationId;             // = derivationId(recipeId, inputIds)
  recipeId: RecipeId;
  inputIds: ItemId[];
  outputIds: ItemId[];
  stateRef: BuildId | null;     // set-level derivations only
  createdAt: string;
}

/** Immutable, content-addressed manifest. Copies no item data. */
export interface Build {
  id: BuildId;                  // = buildId(manifest)
  parentId: BuildId | null;
  recipes: Partial<Record<RecipeKind, RecipeId[]>>; // >1 entry per kind = mixed-recipe build, recorded
  itemIds: ItemId[];            // current items (v0: current chunks)
  mappingIds: MappingId[];      // active mappings (v0: [])
  createdAt: string;
}

export interface DocumentVersion {
  id: string;                   // H(docId, sourceSha256, parseRecipeId, chunkRecipeId)
  docId: string;
  sourceName: string;
  sourceSha256: string;
  parseRecipeId: RecipeId;
  chunkRecipeId: RecipeId;
  chunkIds: ChunkId[];          // document order
}

export interface SearchResultItem {
  id: ItemId; kind: ItemKind; text: string;
  score: number; rank: number;  // rank 1-based
  sourceChunkIds: ChunkId[];
}
export interface SearchResponse {
  searchId: SearchId;
  buildId: BuildId;
  items: SearchResultItem[];
  warnings: string[];           // e.g. "build b_x references 12 stale chunks"
}
```

Events are in section 5.

### ID derivation

```ts
// @kg/core/src/ids.ts
import { createHash } from 'node:crypto';
const SEP = '\u001f';
export const H = (...parts: string[]) =>
  base32(createHash('sha256').update(parts.join(SEP)).digest()).slice(0, 20); // 100 bits

export const normText = (s: string) => s.normalize('NFC').replace(/\s+/g, ' ').trim();
export const normName = (s: string) =>
  s.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').replace(/^[\p{P}\s]+|[\p{P}\s]+$/gu, '');

export const chunkId = (docId: string, sectionPath: string[], text: string, occurrence: number): ChunkId =>
  `c_${H('chunk/1', docId, sectionPath.map(normText).join('\u001e'), normText(text), String(occurrence))}`;
export const recipeId = (kind: RecipeKind, spec: unknown): RecipeId =>
  `r_${H('recipe/1', kind, canonicalJson(spec))}`;
export const nodeId = (name: string): NodeId => `n_${H('node/1', normName(name))}`;
export const derivationId = (r: RecipeId, inputs: ItemId[]): DerivationId =>
  `d_${H('derivation/1', r, ...[...inputs].sort())}`;
export const derivedItemId = (kind: 'relation' | 'summary', d: DerivationId, outputIndex: number) =>
  `${kind === 'relation' ? 'rel' : 'sum'}_${H('item/1', d, String(outputIndex))}` as ItemId;
export const mappingId = (k: MappingKind, from: string, to: string, r: RecipeId, state: BuildId): MappingId =>
  `m_${H('mapping/1', k, from, to, r, state)}`;
export const buildId = (m: Omit<Build, 'id' | 'createdAt'>): BuildId =>
  `b_${H('build/1', canonicalJson({ ...m, itemIds: [...m.itemIds].sort(), mappingIds: [...m.mappingIds].sort() }))}`;
// searchId, sessionId, evalRunId: prefix + ULID (time-ordered, not content-derived)

/** Assign chunk IDs to a chunker's drafts. */
export function assignChunkIds(docId: string, drafts: ChunkDraft[]): { draft: ChunkDraft; id: ChunkId; occurrence: number }[] {
  const seen = new Map<string, number>();
  return drafts.map(d => {
    const key = d.sectionPath.map(normText).join('\u001e') + SEP + normText(d.text);
    const occurrence = seen.get(key) ?? 0; seen.set(key, occurrence + 1);
    return { draft: d, id: chunkId(docId, d.sectionPath, d.text, occurrence), occurrence };
  });
}
```

How the chunk ID scheme behaves:
- **Position** means (document, section path, occurrence of identical text in that section). There is no global or in-section ordinal. Two identical paragraphs in one section still get distinct IDs. A paragraph that moves within its section keeps its ID. Document order is stored separately in `DocumentVersion.chunkIds`.
- **Re-ingesting unchanged content.** The same text under the same headings gives the same IDs. This holds whatever the parse location (local or GPU server), because IDs are computed in TypeScript from the artifact.
- **An insertion early in a document.** Only chunks whose text changes get new IDs. The chunker restarts packing at every section header (section 7.3), so greedy repacking can only cascade to the end of the inserted section. Every other section keeps its IDs. Phase 1 tests this by construction with the `edit-insert` fixture (section 6).
- **The chunk recipe is not in the ID.** Identical text from a different chunker version is the same chunk, which fits "derives from content and position". The recipes that produced a chunk are recorded on the `DocumentVersion`, not on the chunk.
- **`docId`** defaults to the source file name without its extension and can be overridden at ingest. Renaming a document gives it new chunk IDs. This is accepted and documented. Using the file hash instead would give every edit new IDs.

---

## 3. Interfaces

All of these are in `@kg/core/src/interfaces.ts`.

```ts
export interface Ctx { sessionId: SessionId; source: 'mcp' | 'cli' | 'eval' | 'viewer' }

// ---------- parsing (ingest/adapters; sidecar behind it) ----------
export interface ParseSettings { doOcr: boolean; doTableStructure: boolean; doFormulaEnrichment: false; extra?: Record<string, unknown> }
export interface Parser {
  /** Effective recipe for these settings (includes docling version reported by the sidecar). */
  recipe(settings: ParseSettings): Promise<Recipe>;
  parse(files: string[], settings: ParseSettings): Promise<ParseArtifact[]>; // batched: one model load
}
export interface ParseArtifact {   // the portable unit, section 7
  format: 'kg-parse-artifact/1';
  sourceName: string;
  sourceSha256: string;
  recipe: Recipe;                  // kind 'parse'
  stats: { pageCount: number; charsPerPage: number[]; formulaPlaceholders: number; ocrPages: number };
  document: DoclingDocumentJson;   // docling's own JSON, untouched
  createdAt: string;
}
export function validateArtifact(x: unknown): ParseArtifact; // in core; throws with a path to the bad field

// ---------- chunking (ingest/chunker) ----------
export interface Chunker {
  recipe: Recipe;                  // kind 'chunk'
  chunk(doc: DoclingDocumentJson): ChunkDraft[]; // pure, deterministic
}

// ---------- embedding (ingest/adapters) ----------
export interface Embedder {
  recipe: Recipe;                  // kind 'embed': {model, modelDigest, dims, docTemplate, queryTemplate, normalize}
  embedItems(items: Pick<Chunk, 'text' | 'headings'>[] | Pick<Item, 'text'>[]): Promise<Float32Array[]>;
  embedQuery(q: string): Promise<Float32Array>;
}

// ---------- LLM (eval; later extract/judge) ----------
export interface Llm {
  id: string;                      // provider:model
  complete(req: { system?: string; prompt: string; maxTokens: number; temperature: number; json?: boolean }): Promise<string>;
}

// ---------- store (store) ----------
export interface Store {
  tx<T>(fn: () => T): T;
  // config & recipes
  getMeta(key: string): string | null; setMeta(key: string, v: string): void;
  putRecipe(r: Recipe): void; getRecipe(id: RecipeId): Recipe | null;
  // parse artifacts
  putArtifact(a: ParseArtifact): void;
  getArtifact(sourceSha256: string, recipeId: RecipeId): ParseArtifact | null;
  // documents & chunks
  putDocumentVersion(v: DocumentVersion, chunks: Chunk[]): { added: number; reused: number }; // INSERT OR IGNORE chunks, set current
  currentVersions(): DocumentVersion[];
  currentChunkIds(): Set<ChunkId>;
  // items (generic; v0 only chunks)
  getItems(ids: ItemId[]): Item[];
  itemsCiting(chunkIds: ChunkId[], kind?: ItemKind): ItemId[];   // reverse source lookup
  // embeddings
  putEmbeddings(recipeId: RecipeId, rows: { itemId: ItemId; vector: Float32Array }[]): void;
  missingEmbeddings(recipeId: RecipeId, itemIds: ItemId[]): ItemId[];
  knn(q: { recipeId: RecipeId; vector: Float32Array; k: number; buildId: BuildId; kinds?: ItemKind[] }):
    { itemId: ItemId; score: number }[];                         // score = 1 - cosine distance, desc
  // builds
  putBuild(b: Build): void; getBuild(id: BuildId): Build | null;
  staleItems(buildId: BuildId): { itemId: ItemId; missingChunkIds: ChunkId[] }[]; // Rule 5
  // mappings, derivations (empty in v0; implemented and conformance-tested now)
  putMapping(m: Mapping): void; mappingsFor(ids: (ItemId | NodeId)[], buildId?: BuildId): Mapping[];
  putDerivation(d: Derivation, items: Item[]): void;             // items + item_sources (+ relation_nodes / members)
  getDerivation(id: DerivationId): Derivation | null;
  // events (append-only)
  appendEvent(e: NewEvent): KgEvent;                              // assigns seq, ts
  readEvents(f: { sessionId?: SessionId; searchId?: SearchId; types?: EventType[]; afterSeq?: number; limit?: number }): KgEvent[];
  sessions(): { sessionId: SessionId; source: string; firstTs: string; lastTs: string; count: number }[];
}

// ---------- search pipeline (engine) ----------
export interface SearchRequest { query: string; k: number; buildId?: BuildId; searchRecipeId?: RecipeId }
export interface Candidate { itemId: ItemId; score: number; via: string } // via = step that introduced it
export interface StepState {
  queries: string[];               // v0: [request.query]; query refinement may expand
  candidates: Candidate[];         // ordered, best first
}
export interface StepDeps {        // grows additively as layers arrive
  store: Store; embedder: Embedder; buildId: BuildId;
  llm?: Llm; reranker?: unknown; graph?: unknown;
}
export interface StepTrace {
  step: string; params: Record<string, unknown>;
  inputCount: number;
  candidates: { itemId: ItemId; score: number; rank: number }[]; // full output of the step, capped at traceLimit
  detail?: Record<string, unknown>; // e.g. graph-walk seeds, rewritten queries
  children?: StepTrace[];           // composite steps (union/fusion) later
  ms: number;
}
export interface SearchStep {
  name: string;
  run(state: StepState, deps: StepDeps, params: Record<string, unknown>):
    Promise<{ state: StepState; detail?: Record<string, unknown>; children?: StepTrace[] }>;
}
/** A search recipe (kind 'search') spec: */
export interface SearchRecipeSpec { steps: { name: string; params: Record<string, unknown> }[]; traceLimit: number }

// ---------- engine (the only entry point) ----------
export interface IngestReport { docId: string; versionId: string; status: 'unchanged' | 'new' | 'changed';
  chunks: number; added: number; reused: number; embedded: number; buildId: BuildId }
export type Relevance = 0 | 1 | 2;   // not relevant / partly / relevant
export interface FeedbackInput { searchId: SearchId; overall?: Relevance; items?: { itemId: ItemId; relevance: Relevance }[]; note?: string }

export interface Engine {
  ingestFiles(ctx: Ctx, files: string[], opts?: { docIds?: string[]; parse?: Partial<ParseSettings> }): Promise<IngestReport[]>;
  importArtifacts(ctx: Ctx, artifacts: unknown[], opts?: { docIds?: string[] }): Promise<IngestReport[]>;
  search(ctx: Ctx, req: SearchRequest): Promise<SearchResponse>;
  getItems(ctx: Ctx, ids: ItemId[]): Promise<Item[]>;
  feedback(ctx: Ctx, fb: FeedbackInput): Promise<void>;
  record(ctx: Ctx, e: ConsumerEvent): Promise<void>;     // eval.*, usage, outcome, note (section 5)
  currentBuild(): BuildId;
}

export function createEngine(deps: {
  store: Store; embedder: Embedder; chunker: Chunker; parser?: Parser; // parser optional: import-only machines
  steps?: Record<string, SearchStep>;                                    // defaults to v0 steps
  defaultSearchRecipe?: SearchRecipeSpec; clock?: () => Date; newId?: () => string;
}): Engine;   // declared in core, implemented in engine
```

### v0 search pipeline

Default search recipe: `{ steps: [{ name: 'vector', params: { k: 100, kinds: ['chunk'] } }, { name: 'topk', params: {} }], traceLimit: 100 }`

| Step | Does | Trace |
|---|---|---|
| `vector` | `embedder.embedQuery` for each query, then `store.knn` filtered to the build. With several queries, takes the max score per item | 100 candidates with score and rank |
| `topk` | Truncates to `request.k` | k candidates |

The runner, in `engine/src/search.ts`, takes these steps:
1. Resolve the build (default: current) and the search recipe (default: stored meta).
2. Log `query`.
3. Fold over the steps, recording each `StepTrace`.
4. Hydrate the final candidates with `store.getItems`.
5. Run `staleItems(buildId)`. If it is non-empty, add a warning.
6. Log `search_result` with every trace, then return.

The candidates at 100 are what the "ranked low" pre-check reads: gold ranks beyond k.

Later layers plug in as named steps registered in `steps`. Section 10 covers them.

---

## 4. SQLite schema

The file is `<dbdir>/<name>.kg.sqlite`. WAL mode is on, so the viewer can read while MCP writes. The schema version is `PRAGMA user_version = 1`. There is no migration framework. A version mismatch refuses to open and prints the expected version.

```sql
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
-- keys: config (json: default parse settings, chunk recipe id, embed recipe id, search recipe id), current_build

CREATE TABLE recipes (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, name TEXT NOT NULL, spec TEXT NOT NULL, created_at TEXT NOT NULL);

CREATE TABLE parse_artifacts (
  source_sha256 TEXT NOT NULL, recipe_id TEXT NOT NULL REFERENCES recipes(id),
  source_name TEXT NOT NULL, stats TEXT NOT NULL, body BLOB NOT NULL,   -- gzip(artifact json)
  created_at TEXT NOT NULL, PRIMARY KEY (source_sha256, recipe_id));

CREATE TABLE documents (doc_id TEXT PRIMARY KEY, current_version_id TEXT NOT NULL);  -- the only mutable row type besides meta
CREATE TABLE document_versions (
  id TEXT PRIMARY KEY, doc_id TEXT NOT NULL, source_name TEXT NOT NULL, source_sha256 TEXT NOT NULL,
  parse_recipe_id TEXT NOT NULL REFERENCES recipes(id), chunk_recipe_id TEXT NOT NULL REFERENCES recipes(id),
  created_at TEXT NOT NULL);
CREATE TABLE version_chunks (
  version_id TEXT NOT NULL REFERENCES document_versions(id), ordinal INTEGER NOT NULL,
  chunk_id TEXT NOT NULL REFERENCES items(id), PRIMARY KEY (version_id, ordinal));
CREATE INDEX version_chunks_chunk ON version_chunks(chunk_id);

CREATE TABLE items (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK (kind IN ('chunk','relation','summary')),
  text TEXT NOT NULL, recipe_id TEXT REFERENCES recipes(id), derivation_id TEXT,
  structured TEXT, created_at TEXT NOT NULL,
  CHECK ((kind = 'chunk') = (recipe_id IS NULL)));                       -- Rule 4 for derived items
CREATE TABLE chunks (
  item_id TEXT PRIMARY KEY REFERENCES items(id), doc_id TEXT NOT NULL,
  section_path TEXT NOT NULL, occurrence INTEGER NOT NULL, pages TEXT NOT NULL);
CREATE TABLE item_sources (                                               -- Rule 1, both directions indexed
  item_id TEXT NOT NULL REFERENCES items(id), chunk_id TEXT NOT NULL REFERENCES items(id),
  PRIMARY KEY (item_id, chunk_id));
CREATE INDEX item_sources_by_chunk ON item_sources(chunk_id, item_id);

CREATE TABLE embeddings (
  recipe_id TEXT NOT NULL REFERENCES recipes(id), item_id TEXT NOT NULL REFERENCES items(id),
  vector BLOB NOT NULL,                                                   -- float32, normalized
  PRIMARY KEY (recipe_id, item_id));

CREATE TABLE builds (
  id TEXT PRIMARY KEY, parent_id TEXT, recipes TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE build_items (build_id TEXT NOT NULL REFERENCES builds(id), item_id TEXT NOT NULL REFERENCES items(id),
  PRIMARY KEY (build_id, item_id));
CREATE TABLE build_mappings (build_id TEXT NOT NULL REFERENCES builds(id), mapping_id TEXT NOT NULL REFERENCES mappings(id),
  PRIMARY KEY (build_id, mapping_id));

-- ---- empty in v0 ----
CREATE TABLE derivations (
  id TEXT PRIMARY KEY, recipe_id TEXT NOT NULL REFERENCES recipes(id),
  input_ids TEXT NOT NULL, output_ids TEXT NOT NULL, state_ref TEXT, created_at TEXT NOT NULL);
CREATE TABLE nodes (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE relation_nodes (
  relation_id TEXT NOT NULL REFERENCES items(id), node_id TEXT NOT NULL REFERENCES nodes(id),
  surface_form TEXT NOT NULL, role TEXT, PRIMARY KEY (relation_id, node_id, surface_form));
CREATE INDEX relation_nodes_by_node ON relation_nodes(node_id, relation_id);
CREATE TABLE item_members (                                               -- summary -> member relations
  item_id TEXT NOT NULL REFERENCES items(id), member_id TEXT NOT NULL REFERENCES items(id),
  PRIMARY KEY (item_id, member_id));
CREATE INDEX item_members_by_member ON item_members(member_id, item_id);
CREATE TABLE mappings (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, from_id TEXT NOT NULL, to_id TEXT NOT NULL,
  recipe_id TEXT NOT NULL REFERENCES recipes(id), state_ref TEXT NOT NULL, confidence REAL, note TEXT,
  created_at TEXT NOT NULL);
CREATE INDEX mappings_from ON mappings(from_id); CREATE INDEX mappings_to ON mappings(to_id);

-- ---- event log ----
CREATE TABLE events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, session_id TEXT NOT NULL, source TEXT NOT NULL,
  type TEXT NOT NULL, search_id TEXT, build_id TEXT, payload TEXT NOT NULL);
CREATE INDEX events_session ON events(session_id, seq);
CREATE INDEX events_search ON events(search_id) WHERE search_id IS NOT NULL;
CREATE INDEX events_type ON events(type, seq);

-- ---- immutability (Rules 2, 3; append-only log) ----
-- for T in (items, chunks, item_sources, embeddings, recipes, builds, build_items, build_mappings,
--           derivations, nodes, relation_nodes, item_members, mappings, events, parse_artifacts,
--           document_versions, version_chunks):
CREATE TRIGGER <T>_no_update BEFORE UPDATE ON <T> BEGIN SELECT RAISE(ABORT, '<T> is immutable'); END;
CREATE TRIGGER <T>_no_delete BEFORE DELETE ON <T> BEGIN SELECT RAISE(ABORT, '<T> is append-only'); END;
```

KNN is brute force with a filter, and needs no virtual table:
```sql
SELECT e.item_id, 1 - vec_distance_cosine(e.vector, :q) AS score
FROM embeddings e JOIN build_items b ON b.item_id = e.item_id AND b.build_id = :build
JOIN items i ON i.id = e.item_id AND i.kind IN (...)
WHERE e.recipe_id = :recipe ORDER BY score DESC LIMIT :k;
```

The stale check (Rule 5) returns build items that cite a chunk outside the current ingest:
```sql
SELECT bi.item_id, s.chunk_id FROM build_items bi JOIN item_sources s ON s.item_id = bi.item_id
WHERE bi.build_id = :b AND s.chunk_id NOT IN
  (SELECT vc.chunk_id FROM documents d JOIN version_chunks vc ON vc.version_id = d.current_version_id);
```
The current ingest is defined as the union of chunks over each document's current version. Old versions' chunks stay in the store, because events and eval sets reference them.

### Builds in v0

After an ingest or import call changes anything, the engine computes `Build { parentId: previous, recipes: {parse: [...distinct across docs], chunk: [...], embed: [current]}, itemIds: currentChunkIds, mappingIds: [] }`. The ID is content-addressed, so an idempotent re-ingest produces the same build ID and writes nothing. The engine then sets `meta.current_build`. A build with several parse recipes, for example after OCR escalation on one document, records that mix.

---

## 5. Event catalog and logging contract

```ts
interface EventBase { seq: number; ts: string; sessionId: SessionId; source: Ctx['source'];
  searchId?: SearchId; buildId?: BuildId }
export type KgEvent = EventBase & (
  | { type: 'session_start'; payload: { client?: string; argv?: string[] } }
  | { type: 'ingest_start'; payload: { files: string[]; mode: 'parse' | 'import' } }
  | { type: 'ingest_document'; payload: IngestReport & { parseMs?: number; parseRecipeId: RecipeId; stats: ParseArtifact['stats'] } }
  | { type: 'ingest_end'; payload: { reports: number; buildId: BuildId; ms: number } }
  | { type: 'query'; payload: { request: SearchRequest; searchRecipeId: RecipeId } }          // searchId, buildId set
  | { type: 'search_result'; payload: { steps: StepTrace[]; results: { itemId: ItemId; kind: ItemKind; score: number; rank: number; sourceChunkIds: ChunkId[] }[]; warnings: string[]; ms: number } }
  | { type: 'items_fetched'; payload: { itemIds: ItemId[] } }
  | { type: 'feedback'; payload: FeedbackInput }                                                // searchId, buildId copied from the search
  | { type: 'usage'; payload: { searchId: SearchId; itemIds: ItemId[]; how: string } }        // schema only, no v0 tool
  | { type: 'outcome'; payload: { searchIds: SearchId[]; worked: boolean | null; note?: string } } // schema only
  | { type: 'note'; payload: { text: string; targetSessionId: SessionId } }                   // viewer notes
  | { type: 'eval_run_start'; payload: { evalRunId: string; evalSetId: string; conditions: string[]; k: number[]; llm: string; judgeRecipeId: RecipeId } }
  | { type: 'eval_answer'; payload: { evalRunId: string; questionId: string; condition: 'none' | 'gold' | 'retrieved' | 'oracle-gold-first'; searchId?: SearchId; answer: string } }
  | { type: 'eval_judgment'; payload: { evalRunId: string; questionId: string; condition: string; score: number; rationale: string } }
  | { type: 'eval_run_end'; payload: { evalRunId: string; summary: Record<string, number> } }
  | { type: 'error'; payload: { op: string; message: string; stack?: string } }
);
export type EventType = KgEvent['type'];
export type NewEvent = Omit<KgEvent, 'seq' | 'ts'>;
export type ConsumerEvent = Extract<NewEvent, { type: 'usage' | 'outcome' | 'note' | `eval_${string}` }>;
```

**The contract.** Every interaction is a call to an `Engine` method, and only `engine/src/log.ts` calls `store.appendEvent`.
1. MCP tools, CLI commands, viewer note posts and eval runs reach the system only through `Engine`. `server` holds no `Store` write handle except through the engine. The viewer gets a read-only `Store` opened with `readonly: true`.
2. Each engine method is wrapped by `logged(op, ctx, fn)`. The wrapper writes the request event (`query`, `ingest_start`) before doing any work, and the result event after. If the method throws, the wrapper writes `error` with the same `searchId` or correlation and rethrows. A failed call therefore still leaves a trace.
3. An event that references derived items, a build-dependent ranking or a search carries `buildId` (Rule 6). `feedback` copies `buildId` from the `search_result` event of its `searchId`. Feedback for an unknown `searchId`, or for item IDs that search did not return, is rejected and logged as `error`.
4. Appends are synchronous, using better-sqlite3 in the same transaction as any data write. The log is never behind the data, and a viewer that polls sees every event.
5. Eval runs use `source: 'eval'` and `sessionId = evalRunId`. They go through `Engine.search`, the same code path as MCP (design: "one analysis path serves both").

Enforcement tests: (a) the engine conformance test calls each `Engine` method against `MemoryStore` and asserts the exact event types written, including on a forced failure; (b) a root test greps for `appendEvent(` outside `engine/src/log.ts` and `store/` and fails if it finds any.

---

## 6. Testing in isolation

Everything below lives in `@kg/core/testing`, which Phase 1 writes. Implementers do not write their own conformance tests.

| Thing | Purpose | Notes |
|---|---|---|
| `MemoryStore implements Store` | Engine tests without SQLite | Arrays and brute-force cosine, about 250 lines. Must pass `storeConformance` |
| `FakeEmbedder` | Deterministic vectors | Hashing trick over word unigrams and bigrams to 256 dims, normalized. Similar text gives similar vectors, so search tests mean something |
| `FakeParser` | Returns fixture artifacts | Keyed by file name |
| `FakeLlm` | Scripted | `(req) => string` function or a table keyed by prompt substring. Records calls |
| `FakeEngine` | Eval tests | `search` returns rankings from a table `{query → itemIds}`. Logs to an in-memory array with the real `KgEvent` types |
| `storeConformance(make)` | Run by `store` (SQLite, `:memory:`) and by `MemoryStore` | Idempotent `putDocumentVersion`; `itemsCiting` and `getItems` both directions; KNN order and build filter; `staleItems` after a doc version swap; immutability (update/delete throws); mappings and derivations round-trip; `readEvents` with `afterSeq` |
| `parserConformance(make)` | Run by `DoclingCliParser` (gated on `KG_SIDECAR=1`) and `FakeParser` | Artifact validates; `sourceSha256` matches the file; recipe ID stable across two calls; stats present |
| `chunkerConformance(make)` | Run by `doclingChunker` | Pure (same input twice gives deep-equal output); no empty chunks; every draft has a section path; `maxChars` respected; golden IDs on the real fixture; edit-insert behaviour |
| `embedderConformance(make)` | Run by `OllamaEmbedder` (gated on `KG_OLLAMA=1`) and `FakeEmbedder` | Dims equal recipe dims; batch equals single; normalized; recipe includes model digest |

**Fixtures** (`core/testing/fixtures/`):
- `artifacts/thermo-plischke-p1-6.json`: a real artifact. Phase 1 creates it by running the sidecar on a page range of ThermoPlischke with OCR off. It is the only fixture that needs docling, and it is committed.
- `artifacts/thermo-plischke-p1-6.chunk-ids.json`: golden chunk IDs for the current chunk recipe. Changing them requires a deliberate fixture update, which signals that the eval set must be regenerated.
- `docling/edit-insert/{before,after}.json`: hand-written minimal DoclingDocuments with three sections. `after` inserts one paragraph near the start of section 1. The expected result is that every chunk ID in sections 2 and 3 is unchanged and only IDs in section 1 from the insertion point on may change.
- `docling/dup-paragraph.json`: identical paragraphs in one section must get distinct IDs (occurrence 0 and 1).
- `eval/mini/`: 12 chunks, 6 questions (2 single-hop, 2 multi-hop, 1 topic, 1 exact-term), and 15 hand-scored answers for judge validation.

**Per-package test entry points.** `store`: conformance on `:memory:`. `ingest`: chunker conformance plus fixtures, with adapters tested against recorded HTTP and child-process outputs. `engine`: `MemoryStore`, `FakeEmbedder`, `FakeParser` and fixture chunks, covering ingest idempotency, stale warnings, step traces and the logging contract. `eval`: `FakeEngine` and `FakeLlm`, covering recall arithmetic on known rankings, condition plumbing and judge parsing. `server`: MCP in-memory transport against a real engine on `:memory:`, plus a viewer endpoint smoke test.

---

## 7. Docling sidecar, artifact format, import path

### 7.1 Sidecar form
The sidecar is a CLI, not a server: `sidecar/` is a uv project exposing `kg-parse`.
```
kg-parse --version                         -> {"docling": "2.140.0", "kgParse": "1"}
kg-parse --settings settings.json --out DIR FILE...   -> writes DIR/<sha16>.<recipeId>.json per file;
                                              prints one JSON line per file: {"file","artifact","ms"} or {"file","error"}
```
`DoclingCliParser` spawns `uv run --project sidecar kg-parse ...` once per batch, so the models load once per batch. It reads the written files and validates them with `validateArtifact`. The parse recipe spec is `{tool: 'docling', doclingVersion, kgParse, pipeline: 'standard', doOcr, doTableStructure, doFormulaEnrichment: false, ...extra}`. The sidecar builds the recipe with the same canonical-JSON-then-hash rule, and the TypeScript side recomputes the hash and rejects a mismatch.

Remote GPU use needs no new code: install `sidecar/` on the server, run `kg-parse` over the PDFs, copy the directory back, then run `kg import <db> DIR/*.json`. A long-running service (docling-serve) can be a second `Parser` implementation later, and nothing else changes.

### 7.2 Artifact format
The artifact is one JSON file, the `ParseArtifact` type from section 3. `document` is docling's `export_to_dict()` output, unchanged. `stats` costs almost nothing to compute and is the hook for a later quality gate (chars per page, formula placeholders, pages that went through OCR). v0 records the stats and decides nothing from them. Inside the database, the artifact is stored gzipped in `parse_artifacts`, keyed by `(sourceSha256, recipeId)`. A second recipe on the same file, such as OCR escalation, is a second row.

### 7.3 Chunker (TS, `ingest/src/chunker`)
The chunker walks `document.body` in reading order and resolves `#/texts/N`, `#/groups/N`, `#/tables/N` and `#/pictures/N`. Its rules:
- `section_header` and `title` push onto a stack by `level`, and the stack becomes the section path. Each header starts a new packing run.
- `text`, `paragraph`, `list_item`, `caption`, `footnote` and `code` are paragraphs. A `formula` becomes the literal `[formula]`. A table becomes a markdown rendering built from the cell grid. `page_header`, `page_footer` and the furniture tree are skipped.
- Paragraphs are packed greedily up to `maxChars`. A paragraph longer than `maxChars` is split at sentence ends. A trailing chunk shorter than `minChars` merges into the previous chunk of the same section.
- The recipe spec is `{ name: 'kg-docling-chunker', version: 1, maxChars: 1200, minChars: 200, formula: '[formula]', table: 'markdown' }`. The 1200 is chosen to match the spike's HybridChunker sizes (median 857, max 1146).

Import path: `Engine.importArtifacts` validates each artifact and stores it unless it is already present. It then chunks, assigns IDs, writes the document version, embeds the missing chunks and seals the build. `ingestFiles` does the same after computing the sha256 and calling `parser.parse` on cache misses only. Both paths share one function after the artifact step, so chunk IDs cannot depend on where parsing ran.

---

## 8. Phase 2 work breakdown

| WP | Directory | Depends on (contract) | Size | Model |
|---|---|---|---|---|
| P1 (Phase 1, not fan-out) | `core/` incl. `core/testing`, workspace, root tests, skeleton wiring in `server` | — | M | strong |
| A | `store/` | core `Store`, schema above, `storeConformance` | M | low-cost (Haiku): the SQL is fully specified |
| B | `sidecar/` | artifact format, CLI spec | S | low-cost |
| C | `ingest/src/adapters/` (`DoclingCliParser`, `OllamaEmbedder`) | core `Parser` and `Embedder`, conformance | S | low-cost |
| D | `ingest/src/chunker/` | core `Chunker`, chunker conformance and fixtures | M | mid (Sonnet): docling JSON edge cases call for judgment |
| E | `engine/` | core `Engine` and `Store`, logging contract, `MemoryStore` | M | mid to strong: the logging contract and build logic are subtle |
| F | `eval/` | core `Engine` and `Llm`, `FakeEngine`, `eval/mini` | L | strong for the prompts (generation, judge), mid for the code |
| G | `server/` (CLI, MCP, viewer) | core `Engine` and read-only `Store` | M | low-cost: MCP tools and CLI are thin; the viewer is one HTML file plus 3 endpoints |

All WPs depend only on P1, so A through G run in parallel. Integration (Phase 3) replaces the fakes in `server` wiring and runs the stat-mech end-to-end test. D freezes before Phase 4 question generation.

Viewer endpoints: `GET /api/sessions`, `GET /api/events?session=&after=` (the page polls every second, which is enough for "live"), `POST /api/notes`, which calls `engine.record(note)`.

MCP tools in v0:
- `search {database, query, k}` returns the `SearchResponse`.
- `get_items {database, ids}`.
- `feedback {database, searchId, overall?, items?, note?}`.
- `list_databases {}`.

The server opens every `*.kg.sqlite` file in the configured directory, one `Engine` per file. One stdio connection is one session, and the server logs `session_start` with the MCP client info.

### Eval (WP F) shape
```ts
export interface EvalQuestion { id: string; type: 'single-hop' | 'multi-hop' | 'topic' | 'exact-term';
  question: string; referenceAnswer: string; goldChunkIds: ChunkId[]; goldText: string[]; sourceDb: string }
export interface EvalSet { id: string /* H(questions) */; name: string; genRecipeId: RecipeId; genRecipe: Recipe;
  sourceDb: string; sourceBuildId: BuildId; questions: EvalQuestion[] }
// eval sets are JSON files in evals/<name>.json, pinned by content hash; gold text is embedded so
// cross-corpus answering (questions from Kardar, index of Plischke) needs no access to the source db.
generate(src: { chunks: Chunk[]; groups: { type: EvalQuestion['type']; chunkIds: ChunkId[] }[] }, llm: Llm, recipe: Recipe): Promise<EvalSet>;
run(set: EvalSet, engine: Engine, llm: Llm, judge: Llm, opts: { k: number[]; conditions: Condition[] }): Promise<RunSummary>;
precheck(runEvents: KgEvent[], set: EvalSet): PrecheckReport;  // recall@k curve 1..100, gold rank distribution,
                                                               // multi-hop all-gold vs single-hop recall, ceiling gaps by type
paraphraseProbe(set: EvalSet, failing: string[], engine: Engine, llm: Llm): Promise<...>;
```
Groups for multi-hop questions come from adjacent chunks in a section and from cross-document embedding neighbours, such as the same topic by the other author. Results are read from events (`eval_*` plus the run's `search_result` events), so analysis has one source of truth.

---

## 9. Traceability

| Requirement | Where |
|---|---|
| Rule 1: derived items cite source chunks | `item_sources` table; `Item.sourceChunkIds` required; `Store.putDerivation` requires a non-empty source list for each item (conformance test); chunks cite themselves |
| Rule 2: derived items immutable | `UPDATE`/`DELETE` triggers on all item tables; content-derived IDs (`derivedItemId`) mean a changed recipe yields a new ID |
| Rule 3: equivalence as mapping | `mappings` table and `build_mappings`; reversal = a new build without that mapping; triggers forbid editing items |
| Rule 4: each derived item records its recipe | `items.recipe_id` NOT NULL for non-chunks (CHECK); `derivations` records recipe and inputs; chunks' recipes on `document_versions` |
| Rule 5: nothing silently orphaned | `Store.staleItems(buildId)` against the current ingest; every search runs it and puts any hit in `warnings` and in the `search_result` event |
| Rule 6: feedback and eval key to chunk IDs; events record build | `FeedbackInput` keyed by searchId, whose result lists `sourceChunkIds`; `EvalQuestion.goldChunkIds`; `buildId` on query, search_result, feedback, eval events (logging contract point 3) |
| v0.1 Ingest and chunk, idempotent, embedded | `sidecar` + `DoclingCliParser` + `doclingChunker` + `Engine.ingestFiles/importArtifacts`; idempotency via artifact cache, `INSERT OR IGNORE`, content-addressed build; `missingEmbeddings` |
| v0.2 One local store | one SQLite file: chunks, embeddings, events, artifacts |
| v0.3 Search with step logging | `Engine.search`, `SearchStep`, `StepTrace` in `search_result`; returns searchId, items with id, kind, text, score, sourceChunkIds |
| v0.4 Event log | `events` table, catalog in section 5, `logged()` wrapper in the single entry point |
| v0.5 Agent feedback | MCP `feedback` tool, `Relevance` 0/1/2 per item or overall plus note; `usage` and `outcome` event types defined |
| v0.6 Eval harness | `@kg/eval`: generation with type tags and a no-echo instruction, multi-hop from linked groups, pinned JSON sets, recall@k, three conditions plus oracle-gold-first, fixed judge validated on `eval/mini` |

Gaps I am aware of:
- Oracle "gold relations supplied" cannot exist until relations do. The condition type is open, so it is added later.
- "Re-ingesting unchanged content is idempotent" holds across docling versions only if docling's output text is unchanged. A docling upgrade is a new parse recipe and may give new chunk IDs. That is correct behaviour under the design, but it invalidates the eval set.

---

## 10. Extension walk-throughs

| Layer | New code | Changes to existing structure | Interface changes |
|---|---|---|---|
| **Relation layer** | `@kg/extract` (deps: core): an `extract` recipe, an LLM prompt, and output parsed into `Relation`s with `derivationId(recipe, [chunkId])`. `Engine.derive(ctx, recipeId, chunkIds)` skips inputs whose derivation exists. The build gains the relation items, and the embed step embeds them (`missingEmbeddings` over build items) | Seal-build logic adds the derived items of each recipe on the current chunks. The search recipe can add `{vector, kinds:['relation']}` and a new `expandSources` step | **Additive**: `Engine.derive`, event types `derive_start/derive_document/derive_end`. `Store.putDerivation` and the tables already exist. `Embedder.embedItems` already takes plain items |
| **Graph walk** | A `ppr` step in `@kg/graph` (deps: core; graphology). Seeds come from nodes of the top relation candidates, PPR runs over the relation_nodes bipartite graph, and items are scored. `detail: {seeds, damping, iterations}` goes in the trace | Registered in `steps`; `StepDeps.graph` is populated by server wiring | **Additive**: `Store.relationNodes(buildId)` (a read method). The `StepTrace.detail` slot already exists |
| **Equivalence** | `@kg/equivalence`: nearest-neighbour proposals with `store.knn`, an LLM judge, then `Mapping`s with `stateRef = buildId`. A new build includes the chosen mapping IDs | **Behavioural change**: the hydration of search results must take active mappings into account. A duplicate's sources join the canonical item's `sourceChunkIds`, and duplicates collapse to one result. This lands as a `canonicalize` step plus a change in the runner's hydrate. Graph walk must merge `same-as` nodes when building its graph | `Store.mappingsFor` already exists. The meaning of `SearchResultItem.sourceChunkIds` widens (a duplicate's sources are included), so the eval recall code and the docs must note it |
| **Reranking** | A `Reranker` interface in core (`score(query, texts) => number[]`) and an implementation. The likely form is a second sidecar command or a small HTTP model server, because Ollama has no native rerank endpoint | A `rerank` step between `vector` and `topk`; `StepDeps.reranker` | **Additive**: a new interface. `StepDeps.reranker` changes from `unknown` to `Reranker`, which is a type-level change only |
| **Query refinement** | A `refine` step using `StepDeps.llm` that rewrites `state.queries`. `vector` already handles several queries (max score per item). Critique loops are a composite step whose `children` traces nest | None | **Additive**. A loop that re-runs retrieval is a composite step, and the `children` slot exists |
| **Community summaries** | `@kg/summaries`: clustering over the graph, an LLM summary per community, and `Summary` items with `item_members` (relations) and `item_sources` (the union of chunks), `stateRef = buildId` | `staleItems` must also flag summaries whose members are not in the build: a SQL change inside `store`. Eval must score `kind: 'summary'` results separately, which is an internal eval change | Method signatures unchanged, but `staleItems` gains a behaviour that its conformance suite must add. A `level` param on the vector step |
| Granularity mixing | A `fuse` composite step that runs several retrieval sub-steps and merges them with weights | None | None (children traces) |

The changes I expect to existing interfaces:
1. Equivalence changes what `sourceChunkIds` means for canonical items.
2. `staleItems` gains summary-member semantics.
3. Each new read on `Store` needs a matching method in `MemoryStore` and a conformance case.

None of these breaks a v0 caller. The `Store` interface is the part most likely to grow. I accept this instead of splitting it into one interface per layer, which would add machinery v0 does not need.

---

## 11. Decisions

A = arbitrary, E = evidence-resolvable, U = needs the user.

| # | Decision | Kind | Rationale, or options and evidence |
|---|---|---|---|
| 1 | Six TS packages; leaf packages depend only on core; a single composition root | A | A finer split (separate embedder, log, viewer and MCP packages) gives the same result with more wiring. A coarser one loses parallel ownership |
| 2 | Viewer lives in `server`, not its own package | A | One HTML file and three endpoints. Splitting it out later is trivial |
| 3 | Logging lives in `Engine`, not in the MCP adapter | U (light, at sign-off) | Options: (a) MCP layer logs, so eval must go through MCP or log separately; (b) Engine logs, and MCP and eval share it. I chose (b) because the design asks for one path for agent and eval events. See Conflicts |
| 4 | Chunker in TypeScript, not docling's HybridChunker in Python | E | Options: HybridChunker (spike-verified round trip, tokenizer-aware) or a TS walker (pure, testable without Python, IDs independent of docling-core version, import-only machines need no Python). Evidence to collect in Phase 1: run both on the 4 PDFs and compare chunk counts and size distributions, and spot-check 20 boundaries. If they are similar, keep TS. If the TS chunks are clearly worse, call HybridChunker through a second sidecar command, keeping ID assignment in TS |
| 5 | Chunk ID = H(docId, sectionPath, normText, occurrence) | E | Options: global index (shifts every later ID on an insertion, per the spike note), section plus ordinal (shifts later IDs in the section), section plus occurrence (only changed text shifts). Settled by construction and by the `edit-insert` fixture. Sensitivity of the section path to docling header detection is the open part (risk, section 12) |
| 6 | Chunk recipe excluded from chunk ID | A | The same text is the same chunk under any chunker. The recipe is recorded on the document version |
| 7 | `docId` = file stem, overridable | A | Any stable user-visible name works. Renames are rare in a static corpus |
| 8 | Sidecar as a batch CLI, not docling-serve or an HTTP wrapper | A | Behind `Parser`, either gives the same artifacts. A CLI has no lifecycle to manage, and remote use is copy-and-import |
| 9 | Artifact = docling JSON in a thin envelope with stats | A | Every needed field is present, and docling's own JSON stays loadable by docling tools |
| 10 | Artifacts stored gzipped inside the SQLite file | A | Keeps the "one file to copy" property. At most about 4 MB here |
| 11 | KNN via the `vec_distance_cosine` scalar function over a plain table, not `vec0` | A | Both are brute force. The scalar form allows any dims per recipe and a JOIN filter by build. Swapping is local to `store.knn` |
| 12 | Embedding model | E | Candidates: `nomic-embed-text` (768d, needs `search_document:`/`search_query:` prefixes), `mxbai-embed-large`, `bge-m3`, `qwen3-embedding:0.6b`. Provisional: `nomic-embed-text`. Phase 1 spike: about 30 hand-written queries over the 337 chunks, recall@10, plus embed throughput. Recipes key embeddings, so switching costs one re-embed |
| 13 | Immutability via SQLite triggers | A | Enforces Rules 2 and 3 and the append-only log at no cost. The alternative (code review) gives the same result with less assurance |
| 14 | Builds content-addressed, sealed automatically after each changing ingest | A | Idempotent re-ingest yields the same build. Named builds can be added later as meta labels |
| 15 | One `search_result` event holding all step traces, not one event per step | A | The same information either way. One row is simpler for the viewer and for diagnosis |
| 16 | Trace candidate cap 100 (`vector.k = 100`) | A | Covers recall@k for every k the pre-checks use. About 337 chunks makes it near-exhaustive anyway |
| 17 | Relevance scale 0/1/2 | A | Aggregates the same as a 1-5 scale. Three levels are easier for agents to apply consistently |
| 18 | `usage` and `outcome` are typed events with no MCP tool in v0 | A | Design item 5 says these "follow when needed". Adding a tool later is additive |
| 19 | Eval sets as JSON files in the repo, with gold text embedded | A | Portable, diffable, and usable across databases. The design's "portable export" item becomes free |
| 20 | Eval LLM provider (generator, answerer, judge) | **U** | Options: (a) Claude via API: better questions and judging, needs a key and has a small per-run cost; (b) local Ollama model: free and offline, but weaker generation and judging, and the judge must still pass validation on `eval/mini`; (c) Claude for generation and judging with a local answerer. Recommendation: (a). It blocks WP F's real runs only. WP F builds against `FakeLlm` meanwhile |
| 21 | Multi-hop groups from adjacency plus cross-document neighbours | E | Phase 2 eval-design review samples questions for whether the answer truly needs all the passages |
| 22 | Phase 4 corpus = stat-mech | fixed (user) | — |
| 23 | No migration framework (`user_version` check only) | A | v0 has one schema version. Additive tables are already present |
| 24 | MCP over stdio only | A | Every target client supports stdio. HTTP transport is additive |

**Needs the user:** #20 (eval LLM provider) and #3 (confirm logging below the MCP layer, raised under Conflicts). Neither blocks Phase 1.

---

## 12. Biggest risk

**Chunk IDs depend on docling's section-header detection.** The section path is an input to the ID. My claim that an insertion stays inside its section assumes that docling assigns headers and levels consistently. Two cases worry me:
- Docling often reports `level=1` for every header in PDFs and occasionally misdetects bold text as a header. Detection may also change between parse recipes. For example, an OCR-on escalation re-parse of one document, or a docling upgrade, could shift headers and so change most chunk IDs in that document even where the text is unchanged. That would invalidate eval questions over it.
- With flat levels the path is only the nearest header, which helps stability. A spurious header, though, splits a section and changes the IDs that follow it.

The same risk applies to any scheme that uses structure as its position component.

Fallback if it bites: drop `sectionPath` from the ID and use `H(docId, normText, occurrence-in-document)`, keeping the section path as metadata only. IDs then depend only on text, and an insertion still changes only the chunks whose text changed. The cost is that position plays almost no part. The spike to settle it:
1. Parse ThermoPlischke with OCR off and on, and compare the overlap of chunk IDs and of chunk texts between the two runs.
2. If texts overlap much more than IDs, headers are the unstable part, so switch to the fallback.

This is cheap (about 2 minutes of parsing) and belongs in Phase 1, before the chunker freezes.

A second risk: the TS chunker's handling of docling JSON (groups, inline groups, tables) is untested. The real fixture is there to catch it early.

---

## 13. Deliberately left out

- **No separate packages** for embedding, logging, viewer, MCP or CLI, recipes or builds, or graph. Graph arrives with its layer.
- **No dependency-injection framework, plugin registry or event bus.** A plain `steps` map and constructor arguments do the job.
- **No ORM and no migration tool.** Hand-written SQL and a `user_version` check.
- **No `vec0` virtual tables or ANN index.** The design defers ANN to Scale and Cost.
- **No sidecar server, job queue or worker pool.** Parsing is a batched child process.
- **No quality gate or automatic parse escalation.** `stats` is recorded and escalation is a second recipe, both ready for a later gate.
- **No sessions table or notes table.** Sessions are derived from events, and notes are events.
- **No server-sent events or websockets for the viewer.** It polls once a second.
- **No named-build management, build diffing or `kg build` commands.** These are analysis tools for a later sprint. Content-addressed builds already give the pinning.
- **No `usage` or `outcome` MCP tools.** The event types exist.
- **No eval tables in SQLite.** Eval sets are files, and results are events.
- **No lexical channel, no reranker interface, no `Deriver` abstraction.** Each arrives with its layer, and section 10 shows each is additive.
- **No garbage collection.** The triggers forbid deletes, and an explicit vacuum or export tool can come later.

---

## Conflicts

1. **"Logging is a property of the MCP tool layer" (design v0.4) versus "agent sessions and eval runs pass through the same search path and write the same events" (Core Concepts).** If eval does not go through MCP, logging inside the MCP adapter would miss eval. I put logging in `Engine`, the layer that MCP tools, the CLI and eval all call. I read "MCP tool layer" as the tool-facing service layer, and logging there is still not an add-on. The user should confirm this at sign-off (decision #3).
2. **"A chunk is never derived from anything else" versus the brief's parse artifact and chunk recipe.** In practice a chunk is produced from an artifact by a chunker. I keep chunks as ground truth (no `recipe_id`, an ID based only on content and position) and record the parse and chunk recipes on `DocumentVersion`. A chunker change produces new chunks rather than "new items under a new recipe", and it invalidates eval questions, as the design says.
3. **"Chunk ID derives from its content and position" versus insertion stability.** I define position as (document, section path, occurrence of identical text). That is weaker than ordinal position. It is a deliberate reading, chosen so that an insertion early in a document leaves unchanged chunks with their IDs.
4. **Rule 5's "current ingest" is undefined in the design.** I define it as the union of chunks over each document's current version.
5. **The design's Tentative Defaults (Python, LanceDB as an option) versus the fixed TypeScript and sqlite-vec.** The design marks these as open, so this is not a real conflict. I note it only so the design doc can be amended.
