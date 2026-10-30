# Comparison with nano-graphrag (sprint 3, companion to the retro review)

Status: read-only analysis. Nothing in `design/`, code or contracts was edited. Anything that changes a core concept or the v0 scope is marked **needs the user**.

Sources: `design/260916_initial-roadmap.md`, `design/261017_v0-implementation-roadmap.md`, the three sprint 3 reviews (`review/A`, `B`, `C`), `scratch/sprint-2/results.md`, the package cards and `schema.sql`; and nano-graphrag's README, `_op.py` and `graphrag.py` (read through a page fetcher that summarised them, not a full clone; the community-detection code lives in the graph-storage module, which I did not read). Line counts for our code are from `wc -l` over `packages/*/src`.

## Bottom line

The hypothesis is half right, and the wrong half matters.

- **What we built is not a nano-graphrag variant.** v0 has no graph at all: no extraction, no nodes in use, no walk, no summaries. It is chunk similarity search wrapped in provenance (recipes, builds, content-addressed IDs), a step-level event log, and an eval harness. nano-graphrag has none of those three things and all of the graph. The two overlap only in "chunks in, retrieval out".
- **The design is the thing nano-graphrag lacks.** The design's rules (every derived item cites chunks, immutability, equivalence as mappings, per-item recipes, step-level logs, eval pinned to chunk IDs) are exactly what a nano-graphrag-style system would need to become auditable and to handle revision. Its re-insert path is the clearest example: descriptions are deduplicated, sorted, joined and re-summarised, so nothing records which statement is current, and the sort throws away even arrival order. That is the failure the design was written to avoid.
- **Your diagnosis of the implementation is right.** nano-graphrag is about 1,100 lines because its extension points are *functions and storage classes passed into one dataclass*. Ours is about 8,000 lines excluding testkit (12,500 with it) because we drew *package boundaries with contracts, an import rule and a conformance suite* around everything, including steps nobody swaps. We built a framework for a pipeline, where it needed to be a kernel with a few seams. Reviews A, B and C reach the same place from three directions (see "What the reviews already say").

Recommendation in one line: keep the kernel (chunks, items with sources, builds, event log, eval), keep the rules, and make everything that produces items (parsers, extractors, resolvers, search steps) a plain function with a typed signature registered by name, not a machine, a package and a contract version each.

## Side by side

| | nano-graphrag | This project, as built (v0) | This project, as designed |
|---|---|---|---|
| Size | about 1,100 lines | about 8,000 lines, plus 4,500 in testkit | n/a |
| Retrieval unit | entity, pairwise relation, text unit, community report | chunk only | chunk, relation (n-ary, free text), later summary |
| Graph | networkx; node per entity name | none used (`nodes`, `relation_nodes`, `summary_members`, `mappings` tables are empty) | relations joined through shared nodes |
| Extraction | LLM, tuple-delimited records, gleaning loop, malformed records silently dropped | pilot only (`extractPilot.ts`); 60% of sampled relations clean | free-text self-contained relation with qualifiers |
| Entity identity | upper-cased name; same name merges | n/a | normalised-name handle, merges recorded as reversible mappings |
| Merging | descriptions deduplicated, sorted, joined; re-summarised by LLM over a token threshold; weights summed | n/a | mappings; originals never edited |
| Change over time | none. Re-insert merges into existing nodes, re-adds edge weight, **drops all community reports and regenerates them**, can overwrite an entity's type | document versions, content-addressed chunks, builds, stale check; no supersession yet | supersession links between relations |
| Provenance | `source_id` string of chunk IDs on nodes and edges; order not deterministic | `item_sources` table, both directions indexed, Rule 1 holds on real data (SQL audit, zero violations) | same |
| Retrieval modes | local (entity KNN, then communities, text units via 1-hop neighbours, relations), global (map-reduce over reports), naive | one machine: `similarity` | similarity, graph walk (PPR), rerank, decomposition |
| Diagnostics | none beyond `only_need_context=True` | 26 event types; every search step logs candidates and ranks (about 33 KB per search) | same, used for failure-mode attribution |
| Evaluation | none in the package | question generator, judge (kappa 0.74), recall@k, three answer conditions, pre-checks | same |
| Extension seam | `GraphRAG` dataclass fields: `chunk_func`, `entity_extraction_func`, three storage classes, best and cheap LLM, embedding function, `PROMPTS` dict | packages with ports in `@kg/core`, a topology fingerprint per machine, a recipe per derivation | per-database config plus recipes |
| Caching | LLM response cache on by default | deferred (AM-9) | "cached for replay" |
| Incremental cost | every insert reclusters and regenerates every report | unchanged chunks keep items; new chunks only | local derivations incremental, set-level recorded with their state |

## What nano-graphrag has that we should take

1. **Seams as functions, not packages.** Its whole extension story is: a chunker is `(docs, size, overlap) -> chunks`, an extractor is an async function, storage is one of three small abstract classes (`BaseKVStorage`, `BaseVectorStorage`, `BaseGraphStorage`), and a config object picks them. A new use case replaces one callable. Our equivalent would be a `step` registry, which `@kg/search` already half-has (`vectorKnn`, `truncate` are plain functions) before the XState machine wraps them. Review B F1 and F9 propose exactly this reduction.
2. **A cheap model and a best model as two named slots.** Extraction and summarisation run on the cheap one; answers on the best one. We already settled on local Ollama for everything, but the slot split is free and the relation layer will want it.
3. **Context assembly for graph retrieval.** The local query is a worked example of the step we have not designed: take entity hits, collect their `source_id` chunks and those of one-hop neighbours, rank chunks by how many of the hit's edges lead to neighbours that also cite them, then fill a token budget. This is "expand a relation hit to its source chunks" from our Granularity controls, with a concrete ranking. It transfers directly. The ranking and budget code is also where nano-graphrag has two visible bugs (a never-firing `None` check, a possible `KeyError` for a missing report), a reminder to unit-test context assembly rather than read it.
4. **A naive mode in the same object.** `enable_naive_rag` gives a baseline in the same system, which is our v0 baseline expressed as one flag. Ours is better measured, not better placed.
5. **The extraction prompt and gleaning loop** as a starting point for the relation prompt. Our relations are free text with qualifiers, so the output format differs, but the "did you miss anything? yes/no" continuation is cheap and our pilot found 83% fact coverage, so a second pass is the documented remedy for "not extracted".
6. **A JSON-repair hook** (`convert_response_to_json_func`). Our local qwen3.5 extractor will have the same instability the README warns about.
7. **LLM response cache on by default.** We deferred this (AM-9) on storage cost. nano-graphrag's experience (a hashing KV store, persisted after each query) says the cost is small next to repeated 25-minute eval runs, and Review B F3 shows a single failed call currently loses a whole run. Worth reopening, as a cache of *eval and extraction* calls only.

## What nano-graphrag does that we should avoid (and our rules already forbid)

- Silent skipping of malformed extraction records. We would log the skip and the chunk.
- Placeholder `UNKNOWN` nodes created from edge endpoints. Under our design a node is only a handle, so this is harmless to copy; the *typed* placeholder is not.
- `source_id` as a delimiter-joined string whose order depends on set iteration. Ours is a table.
- Early return in `ainsert` after extraction returns nothing, which skips the commit of documents and chunks so the next run re-ingests them. Our ingest is idempotent by content ID and records a build per change.
- Weight accumulation on re-insert, so re-adding identical content raises edge weight. Content addressing prevents this.
- Whole-graph recomputation per insert. The design already scopes community summaries as set-level and poor for fast-changing project databases; nano-graphrag is the existence proof.

## What is different on purpose

These are not accidents and are not in nano-graphrag, so they should stay, in the smallest form that satisfies the rules:

| Capability | Why nano-graphrag cannot supply it | Smallest form |
|---|---|---|
| Supersession and "what is current" | merges descriptions into one string | a `mappings` row (kind, from, to, producer); the table already exists |
| Qualified, n-ary facts | pairwise edge description | free-text relation item connected to any number of nodes (`relation_nodes` already exists) |
| Stage-level diagnosis | end-to-end only | the `search.step` log plus eval pinned to chunk IDs; this is the project's main reason to exist |
| Reversible merges | overwrites on write | mappings, never edits |
| Per-item recipe | one global config | recipe id on each derived item |

## Where the extensible-base goal is not met

The aim is a base that several use cases (a physics corpus, a project history) plug into. The shape that would give it is a small kernel plus plug-ins, and the code has the kernel but wraps it in more ceremony than the plug-ins need.

**Kernel (keep).** Chunk and item with sources (Rule 1); document versions and builds (Rules 5, 6); event log and `runTool`; eval harness; recipe id on derived items; mappings (table only).

**Plug-in points (what a use case supplies).**
1. an ingest adapter (document or event stream to parse artifact; for a project history: commits, decisions, revisions);
2. a deriver (chunk to items; for example the relation extractor with its prompt and guidance);
3. a resolver (items to mappings; duplicate, refinement, supersession);
4. search steps (candidates to candidates; similarity, PPR, rerank), composed in a list.

Each is a typed function plus a name and version in a registry. A recipe is `{ name, version, settings }`. That is nano-graphrag's seam with our provenance attached.

**Where the current code departs** (finding numbers from the sprint 3 reviews):

| Cost | Evidence | Reduction |
|---|---|---|
| Every pipeline is an XState machine that only orders a few calls; the topology fingerprint guards un-bumped edits | B F1, B F8, B F9, C F2 (5.5 MB mermaid and about 180 lines of path-matching to draw a 4-node machine) | steps as a list of functions; keep step-level logging, which is what the design needs; drop topology pins. **Needs the user**: the machine amendment (2026-10-18) is in the design |
| Formula decoding carried by five packages for a build nobody has run | B F4 | one parse option |
| Schema carries layers not scheduled | A F4 (a quarter of the schema, 12 triggers on unused tables) | acceptable once migrations exist (A F1); then add tables when a layer lands |
| `@kg/api` is 115 lines, store and eventlog duplicate plumbing | A F7 | `@kg/sqlite` (AM-10) already addresses it |
| Contract churn and test scaffolding outweigh the code protected; every type written twice | A F8, A F10, C F4 (testkit 4,514 lines, exists mainly because of the import rule) | relax the import rule, generate one side of type and zod |
| The tool cannot be pointed at a new corpus without a script | C F1 | `./kg` CLI (AM-12; `packages/app/src/cli.ts` is in progress) |
| No first-class way to run the same stage over different inputs for different use cases | design "Database" concept (per-corpus config) has no code | a database config file naming the registered ingest adapter, deriver, resolver and search steps |

Note the asymmetry. Modularity at the *package* level has not delivered modularity at the *use case* level, because the package seams are along our implementation (parse, chunk, embed, store) rather than along what varies between use cases (what to ingest, what to derive, how to resolve, how to search).

## What would be lost by going further toward nano-graphrag

Collapsing to a nano-graphrag-style single module would lose precisely what makes it auditable: step events, recipe-keyed items, builds. The recommendation is to reduce ceremony *around* those, not to remove them. The test for each proposed deletion: does it remove a rule, or only a mechanism for enforcing the rule that a test or a table constraint could enforce more cheaply? Insert-only triggers and the SQL audit queries enforce Rules 1, 5, 6 on real data already; that is the cheap form, and it worked (zero violations on both baseline databases).

## Reframe: v0 as a module base, with machines as compositions

The goal restated: new use cases and new ways of answering requests should come from *wiring existing modules into a new state machine*, not from editing or forking the pipeline. nano-graphrag is the reference for what "modular" looks like in a small system, and an instructive counter-example for what it does not do.

### Three layers

1. **Kernel (fixed).** Store (chunks, items and sources, nodes, mappings, embeddings, builds), event log, machine runner, eval harness. Modules never write to storage; they return results and the kernel writes them. That is where Rules 1, 2, 4 and 6 are enforced: an item without source chunks is refused, rows are insert-only, the runner stamps the recipe and the build on everything a module produces.
2. **Modules (many).** Typed functions with a name, version, settings schema, declared reads and writes, and a scope.
3. **Machines (one per way of responding).** A wiring of module instances with routes. Loops are moves back to an earlier state. A recipe is the machine, the module versions and the settings. Two families: *build machines* (what to do when data arrives) and *request machines* (what to do when an agent asks); each request machine is exposed as an MCP tool.

### Module kinds

| Kind | Transforms | Examples |
|---|---|---|
| Ingest | source to documents | docling PDF, git log, decision records |
| Segment | document to chunks | current chunker; one chunk per decision |
| Derive | chunks to items | relation extractor, summariser, contextual embedder |
| Resolve | items to mappings | duplicate, refinement and supersession judge |
| Search step | search state to search state | KNN, PPR walk, rerank, adjacent expansion, decompose, critique |
| Respond | results to answer | answerer, judge |

### What v0 already has, and what it lacks

The module idea exists once, for search: `SearchStep` in `packages/core/src/ports/search.ts:116-122` is `{ type, run(state, env) -> { state, trace } }`, over a shared `SearchState` (queries, candidates, seeds, pools, notes). `vectorKnn` and `truncate` are such steps; `truncate` is 40 lines. `@kg/pipeline` is 258 lines and is the runner. So the search side is most of the way to a module base. Gaps against the framing:

| Gap | Evidence |
|---|---|
| No common module type across kinds. Ingest, eval, judge and generate each have their own steps and their own `pins.json`. | `ingest/src/steps.ts`, `ingest/src/machines/`, `eval/src/machines/` (seven machine files), three `pins.json` |
| No derive or resolve module interface, so the first relation extractor has nothing to implement. | `extractPilot.ts` is a script; `derivation_runs` and `mappings` tables exist but no code writes them (Review A F2) |
| A step declares nothing about what it reads or writes, so wiring errors surface at run time, and fixed fields like `seeds` and `pools` are reserved for layers that do not exist. | `SearchState` comments "reserved for graph walk; [] in v0" |
| Every step must hand-build its own trace (`considered`, `output`, params). That is the diagnosis the design needs, but it is a tax on every module author and `truncate` spends most of its lines on it. | `search/src/steps/truncate.ts:14-36` |
| `StepEnv` is a fixed bag (`store`, `embedder`, `space`, `llm`) that "later layers add fields to". | `ports/search.ts:106-111` |
| Wiring is guarded by a hand-pinned topology fingerprint instead of by checking the wiring. | `search/src/machines/pins.json`, `service.ts` step 2 |
| No set-level versus local marker on a module, though the design depends on that distinction. | design Core Concepts, "Local and set-level derivations" |

### A module descriptor that closes the gaps (sketch, not a contract)

```ts
interface Module<In, Out, Settings> {
  name: string;  version: string;  kind: ModuleKind;
  settings: ZodType<Settings>;
  reads: Slot[];  writes: Slot[];            // checked when a machine loads; replaces the pinned fingerprint
  scope: 'local' | 'set';                    // local: incremental, early cutoff; set: recomputed, records the state it saw
  run(input: In, env: ModuleEnv): Promise<{ out: Out; details?: Json }>;
}
```

- **Runner-derived traces.** For search steps the runner records candidates before and after, so a module returns only what the diff cannot show (the 100-candidate pool a retrieval scored before its cut) plus `details`. A `truncate` becomes about 5 lines. Stage attribution (was the gold chunk in the candidates before this module, and after?) is then generic across every machine and every module, which is the design's central diagnostic.
- **Reads and writes by name.** A machine fails to load if a state reads a slot no earlier state writes. This is the check the topology pin only approximates.
- **Derive modules return drafts.** `{ text, sourceChunks, nodes }`; the kernel assigns the id from recipe and inputs, writes the sources, refuses an empty source list. Resolve modules return mapping drafts the same way.
- **Scope drives the runner.** A `local` module runs only on new chunks (early cutoff). A `set` module is rerun on demand and its output records the build it saw. This is the one place the design's local versus set-level distinction becomes executable.

### Machines for the two use cases and for nano-graphrag's three modes

| Machine | Modules in order | Modules used elsewhere |
|---|---|---|
| Physics `search` | embed query, KNN chunks and relations, PPR walk, rerank, cut | KNN, cut |
| Project `current_state(X)` | embed query, KNN relations, follow supersession mappings, keep newest, expand to source chunks, cut | KNN, expand, cut |
| Project build | decision-record ingest, segment per record, embed, extract relations, resolve supersession | embed |
| Physics build | PDF ingest, chunk, embed, extract relations, resolve duplicates | ingest/embed/extract |
| nano `naive` | KNN chunks, token budget, answer | KNN, budget, answer |
| nano `local` | KNN entities, expand to one-hop neighbours, collect chunks by neighbour-citation count, collect relations by degree, select community reports, token budget, answer | KNN, expand, budget, answer |
| nano `global` | select communities by occurrence and rating, map (LLM per report group), filter by score, reduce (LLM), answer | map-reduce is its own pair of modules |
| nano roadmap `global_local` | rewrite query, then `local` | rewrite + the whole `local` machine |

Reading across: the same five or six modules (KNN, expand, budget, cut, answer, embed) cover the three nano modes and both of our use cases. A fourth nano mode is a list in our design and a new function in theirs.

## Further examinations of nano-graphrag under this framing

Additional files read: `base.py`, `_storage/gdb_networkx.py`, `docs/ROADMAP.md`, `docs/FAQ.md` (through the page fetcher, so summaries again).

### Where nano-graphrag spends its modularity

Its seams are at the *infrastructure* level. Three storage interfaces (vector: 2 abstract methods; key-value: 6; graph: 19), plus the LLM function, the embedding function, the chunker and the extractor. All are chosen in one dataclass at construction time, and wrappers (rate limit, response cache, best versus cheap model) are applied there as middleware (`graphrag.py` `__post_init__`). Swapping the vector database or the model is a few lines.

At the *algorithm* level it has no seams. The three query modes are three module-level functions selected by an `if mode ==` chain in `aquery`, each a monolith of helper functions plus an assembly step. The roadmap's own "global_local" item is a new function. The insert path is a fixed ten-step sequence, with set-level work (clustering, all reports) always run.

For us the budget should be spent the other way. We have fixed the infrastructure (SQLite and sqlite-vec, an Ollama model client) and the Scale and Cost list defers swapping it, so storage need not be abstracted further. The variation we need is in the algorithms: which steps, in which order.

### Four ways its modularity breaks, each a design requirement for ours

1. **Hidden attribute contract.** `clustering` writes a JSON `clusters` attribute on each node; `community_schema` reads `clusters` and `source_id`; `embed_nodes` needs an `id` that `upsert_node` never sets. Nothing declares or checks these. Our reads and writes declarations are the explicit version.
2. **Algorithm welded to storage.** Clustering and community construction live in `BaseGraphStorage` (`clustering`, `community_schema`, `embed_nodes`), call graspologic on `nx.Graph` objects and mutate `self._graph` directly. A Neo4j backend must reimplement them, and the dependency on networkx and graspologic comes with it. Graph algorithms must be modules over a read interface (a node, its relations, its sources), not methods on the store.
3. **Silent coupling through constants and config.** Storage classes read `max_graph_cluster_size`, `graph_cluster_seed` and `node2vec_params` from the global config and import the field separator from the prompt module. A module's settings should be its own and part of its recipe.
4. **Interfaces that nothing enforces.** None of the base classes uses `ABC`, so a missing method fails at call time; `embed_nodes` is declared and documented as unused; a type annotation is wrong on `node_degrees_batch`. A load-time check of declared reads and writes catches the equivalent for modules.

Related, and visible in the code: a ten-step insert whose early return (extraction produced nothing) skips committing documents and chunks. Under our model each insert step is a module with a scope; the runner, not the step, owns the commit and the early-cutoff decision.

### What its modularity does well that we should keep

- **Wrapping as middleware.** Cache, concurrency limit and model choice wrap a function once, outside the code that uses it. Our logged model wrapper is the same idea; the response cache (AM-9) would be a second wrapper, not a feature in each caller.
- **Small interfaces.** Vector storage is two methods. If we ever need a second vector or graph backend, the interface should be that small, with algorithms kept out of it.
- **Cheap to write a module.** A custom extractor is one async function following a prompt format. Our step is heavier because of the trace; runner-derived traces bring it back.
- **The context-only switch.** `only_need_context=True` returns the assembled context without an answer. In ours, a request machine that ends before the respond module is the same thing, and it is what an agent tool wants.

### What nano-graphrag shows about change and set-level work

Its ten-step insert wipes `community_reports` and regenerates all of them on every insert, with the code comment that incremental community updates are not supported. This is the exact failure the `scope: 'set'` marker exists to make visible: a set-level module must say so, so the runner can decide between recompute and maintain, and a build can record the state it saw. nano-graphrag has no such record, so a reader cannot tell whether a stored report matches the current graph.

### Cost of adding a module, measured two ways

- **nano-graphrag:** a new extractor, one function with the prompt's tuple format (the FAQ's first advice for failures is to fix the model's output format); a new query mode, a new function plus an edit to `aquery`.
- **v0 today:** a new search step is about 40 lines plus a machine edit, a version bump and a regenerated pin; a new derive or resolve module has no interface; a new ingest source is a new machine plus a new `pins.json` entry.
- **Target:** a new module is one file and one conformance test against its kind; a new machine is a list of module names plus settings; neither touches the kernel. The measure for the design is that the project-history use case lands with zero kernel changes.

## Questions for the user

1. **Seam shape (needs the user).** Is the extension point a registry of named functions (nano-graphrag style) with recipes as `{name, version, settings}`, replacing machine topology pins? This amends the 2026-10-18 state-machine amendment. It is consistent with B F1 and C F2; I recommend yes, retaining `search.step` logging.
2. **Project-history use case (needs the user).** Do we design the ingest-adapter and resolver seams now, with one stub adapter, or wait for Q17 and the first relation build? Recommendation: define them as types and registry entries when the relation layer lands, so the first real deriver sets the shape instead of a guess.
3. **Reopen the response cache (arbitrary or evidence-resolvable).** nano-graphrag defaults it on. A check: size of the eval and extraction call log for sprint 2 against the cost of the 25-minute rerun in B F3. Recommendation: cache only eval and extraction calls.
4. **Borrow versus re-derive.** The local-query chunk-ranking step (item 3 above) is a candidate for the first graph-walk context assembler alongside PPR. Recommendation: use it as the non-PPR baseline for graph retrieval, so the walk is measured against something.
5. **Module descriptor (needs the user).** Adopt the sketch under "A module descriptor that closes the gaps": declared reads and writes checked at machine load, a `local` or `set` scope, runner-derived traces, and kernel-assigned ids for derive and resolve output? This amends Core Concepts "Recipe and build" and the machine amendment. Recommendation: yes for search and the first derive module; extend to ingest and eval only when they gain a second implementation.
6. **Machine family names (arbitrary).** "Build machine" and "request machine" versus the design's existing pipeline kinds (search, ingest, evaluation run, question generation, judging). Recommendation: keep the existing kinds and add the two names as a description only.
7. **Algorithm placement (decided 2026-10-30: modules over a read-only view; logged in `decision-log.md`).** Graph algorithms (PPR now, clustering later) as modules over a read-only graph view, never as store methods. Check: whether `CorpusStore` can expose `relationsOfNode`, `nodesOfRelation` and `itemsBySourceChunk` (the last exists already in `StepEnv`) and nothing more. Recommendation: yes, and treat any wish for a wider interface as evidence the module boundary is wrong.

## What the reviews already say (cross-reference)

Reviews A, B and C independently reached the over-build conclusion: A (finding 4, 8, 10, 11) on schema, contract churn and vocabulary; B (finding 1, 4, 8, 9) on machines and decoding; C (finding 2, 3, 4) on viewer, retired oracle and testkit. This comparison adds the outside reference point: a working system one seventh the size shows which seams actually matter for extension, and it shows by its re-insert behaviour why the kernel is worth keeping.

## Caveats

- The sections "Reframe" and "Further examinations" add reads of nano-graphrag's `base.py`, `_storage/gdb_networkx.py`, `docs/ROADMAP.md` and `docs/FAQ.md`, again through the summarising fetcher. The FAQ page was thin on customisation; claims about custom chunking and prompts rest on `graphrag.py`'s config fields, not on documentation.
- The module descriptor is a sketch typed against the existing `SearchStep`; it is not checked against ingest or eval code, and the table of machines is illustrative, not tested.

- nano-graphrag details come from a summarised fetch of two source files and the README, not a clone and run. The merge, extraction, local and global query behaviours above are as that summary reported them; verify against the repository before quoting in design feedback.
- Line counts are approximate: our figure sums `wc -l` over `packages/*/src/*.ts` and includes generated and golden files nowhere, but I did not strip comments or blank lines; nano-graphrag's 1,100 is its own README claim and excludes prompts and tests.
- nano-graphrag's community detection (Leiden through its graph storage, hierarchical, max cluster size 10 by config default) was read from config fields only.
- Our results (kappa 0.74, 83% extraction coverage, topic-level gap n = 11) are the small-sample numbers from `scratch/sprint-2/results.md` and carry its caveats.
