> **Archived, 2026-11-06.** This describes the first build, which used seventeen packages, builds, recipes and snapshots. It was replaced by `design/architecture.md`. Kept as history; do not follow it for current work.

# Design: Knowledge-Graph Retrieval

## Purpose

The system retrieves information from document corpora and project histories on behalf of coding and research agents, exposed through MCP tools. The baseline is similarity search over chunks. The target is a knowledge graph built over that baseline, able to answer questions that no single passage answers directly but whose requisite information is present in the corpus.

Two ideas shape everything below:

- **Everything traces to chunks.** Chunks are the ground truth. Every derived object points back to the chunks it came from, and chunk IDs are the common currency for retrieval scoring, evaluation, and feedback. Any derived layer can therefore be added, rebuilt, or discarded without disturbing the rest.
- **Measurement selects the work.** An eval harness and agent feedback localize where retrieval fails. Measurement, not intuition, decides what gets built next and whether a layer earns its place.

## Core Concepts

**Chunk.** A verbatim span of a source document. Its ID derives from its content and position, so unchanged content keeps its ID across re-ingestion, and changed content receives a new ID. A chunk is never derived from anything else.

**Item.** Anything a search returns: a chunk, a relation, or later a summary. An item has an ID, a kind, text, and the IDs of its source chunks. Source links are many-to-many, and both lookup directions are indexed. Kinds differ in granularity: relations are finer than chunks, and summaries are coarser. Following source links moves between granularities, for example by expanding a relation to its chunks.

**Node and relation.** A *node* is a shared handle for something named in the corpus: an entity, concept, quantity, or similar. Its ID derives from its normalized name. It carries no content of its own and requires no type. A *relation* is an item whose text is a self-contained free-text description, with qualifiers such as species, conditions, scope, or time stated in the text. A relation connects any number of nodes. The *graph* is the set of relations joined through their shared nodes.

Example: from "In rats, lesions of dorsolateral striatum (DLS) kept responding sensitive to outcome devaluation after extended training," extraction yields one relation with that self-contained description, connecting the nodes *rat*, *dorsolateral striatum*, *outcome devaluation*, and *extended training*.

Relations are free text instead of typed edges because no relation taxonomy is needed to begin, descriptions carry qualifiers that a type label would drop, and descriptions suit comparison and merging. A per-database configuration can add structure (relation types, qualifier fields) where a database type benefits from it. The core treats the description as authoritative.

**Equivalence.** Different names for one thing, duplicate relations, and relations that refine or supersede one another are all recorded as *mappings*: separate records, each noting what produced it, that link items without editing or deleting them. A wrong merge is reversible, and the original surface forms stay recoverable. Node resolution, relation deduplication, and temporal supersession are the same mechanism applied to different items.

**Database.** One corpus or project, with its own configuration: embedding model, extraction guidance, and any optional relation structure.

**Recipe and build.** A *recipe* is the full specification of how derived items are produced: models, prompts, configuration, and version. Derived items are immutable, and each item's ID derives from its recipe and its input chunk IDs. A *build* is a named, pinned manifest listing which items are current under which recipes, together with the state of the mappings. A build copies no data. The consequences are:

- New or changed documents run recipes only on their own chunks and append to the manifest. Unchanged chunks keep their items.
- Changing a recipe re-derives only what the change touches. Re-extracting only the chunks that failed eval is the same operation.
- A manifest that mixes recipe versions is recorded as such, so comparisons stay interpretable.
- Two builds run against the same eval set show whether a change helps. The winning build becomes current.
- Full rebuild is the simplest way to produce a build, not a requirement of the model.

**Local and set-level derivations.** A *local* derivation depends on one chunk or a few: embeddings, relation extraction, node handles. It is exactly reproducible and updates incrementally by construction. A *set-level* derivation depends on a whole collection of items: equivalence mappings, clusters, community summaries. It cannot be a pure function of the chunks, particularly when maintained incrementally, where results depend on the order in which items arrived. Set-level derivations are therefore recorded with their producer and the state they were computed from, are never silently edited, and are either recomputed or incrementally maintained. An eval pins the state it ran against.

**Embeddings.** Embeddings are stored apart from the items they embed, keyed by model and conditioning, so several variants coexist. Item identity does not depend on any embedding scheme, which leaves node navigation free to change.

**Event log and eval.** Every interaction is an event in an append-only log. Agent sessions and eval runs pass through the same search path and write the same events, so one analysis path serves both.

## Rules

Every layer and iteration preserves these:

1. Every derived item cites source chunks.
2. Derived items are immutable. Changes produce new items under a new recipe.
3. Equivalence is recorded as a mapping. No item is edited or deleted to merge it.
4. Each derived item records its recipe, so a change to a producer identifies exactly what to regenerate.
5. Nothing is silently orphaned. A build that references a chunk ID absent from the current ingest is flagged as stale.
6. Feedback and eval questions key to chunk IDs, and logged events that reference derived items also record the build.

## v0

v0 establishes the baseline and the measurement. It contains no extraction. The relation layer is the first expansion, and everything in v0 exists to make that expansion and its successors testable.

**1. Ingest and chunk.** Documents are parsed into structured text (docling) and chunked. Re-ingesting unchanged content is idempotent. Each chunk is embedded and stored.

**2. Store.** Chunks, embeddings, and the event log share one local store organized as described under Core Concepts.

**3. Search.** A search takes a database, a query, and a count, and returns items. Each item carries an ID, a kind, text, a score, and source chunk IDs. A search also returns a search ID and records in the log what each step considered and ranked (candidates and ranks at each step, and later the seeds of any graph walk), so later diagnosis does not depend on what was thought to matter in advance. v0 search is top-$k$ cosine similarity over chunks.

Source chunk IDs make chunk-level recall comparable across search methods and databases. Chunk recall is a proxy, not a complete measure. Summaries cite the union of their members' chunks, which inflates recall, so they are scored separately. A relation can supply valid evidence from a chunk other than the gold one, so recall is read together with answer quality.

**4. Event log.** Every event is recorded with a session, a timestamp, a type, and a payload. Types include ingest, query, search result, feedback, usage, and outcome. Logging is a property of the MCP tool layer, not an add-on.

**5. Agent feedback.** A tool keyed by search ID records relevance, per item or overall, with a free-text note. Relevance is the one structured field, so that it can be aggregated. Reports of how the information entered the solution, and whether the solution worked, follow when needed; the log schema already accommodates them. Usage reports are the agent's post hoc account and may not match what influenced the answer. They are evidence to be calibrated against the eval set, not ground truth.

**6. Eval harness.** An LLM reads a chunk or section and writes a question, a reference answer, and gold evidence (the supporting passages). Each question is tagged with its type (single-hop, multi-hop, topic-level, exact-term, and so on). Questions are generated with instructions to avoid reusing the passage's wording, because questions that echo a chunk favor similarity search and understate the room for improvement. Multi-hop questions come from prompting the generator with several linked passages and requiring the answer to depend on all of them. The eval set is pinned to chunk IDs. A change to chunking requires regenerating the questions for the affected chunks.

Two measurements are taken:

- *Retrieval recall@k* of the gold chunks. This applies when questions come from the database's own corpus.
- *Answer quality* under three conditions: no context, gold evidence supplied (the ceiling), and retrieved context. A fixed judging procedure scores answers against the reference. This also works when the question-generating corpus is a different, related one, since the gold evidence then lives outside the database. The attainable score is bounded by how well that corpus overlaps the indexed one.

Configurations are compared by running the identical question set through each. Oracle variants of the conditions (gold items placed first, gold relations supplied) bound the benefit of a proposed layer before it is built.

## Companion Tools

These read the event log and eval results. They are useful from the start but are not needed to test the first expansion.

- **Session viewer.** A single-page, read-only view of the log, covering both past and ongoing sessions. Events appear as they are logged, so a running session can be watched live, and finished sessions can be reviewed afterward. Each session renders as a timeline of events (query, retrieved items, feedback, ingest progress), like a chat transcript showing only the system side. Notes can be attached to a session. The viewer reads the store directly and holds no state of its own, which keeps maintenance near zero. It shows what the system is doing, because the MCP return alone does not.
- **Analysis tools.** Callable tools used by coding sessions that are working to improve the system: listing failures grouped by question type, diagnosing a single question step by step, and diffing two builds. They depend on the log capturing the step-level detail described in v0 item 3.

## Failure Modes and Remedies

Each failure mode has an observable signature in the eval results and logs, so that an agent or a script can run diagnosis without improvising definitions. Each remedy that adds a layer has a **pre-check**: a measurement taken before building, from existing machinery, an oracle version of the layer, or a small pilot on a sample, that shows how much the baseline leaves to gain. A layer is dropped or deferred only when its pre-check shows little to gain. Where a row lists no pre-check, the remedy starts when the failure is observed.

| Failure | Signature | Remedy | Pre-check |
|---|---|---|---|
| Evidence split across chunks | Fails with retrieved context, passes with gold evidence, and the gold spans several adjacent chunks | Chunking revision; expansion to adjacent chunks | |
| Not extracted | A gold chunk has no relation covering the gold fact | Prompt revision, few-shot examples drawn from missed cases, a second extraction pass | Pilot extraction on a sample of chunks: how many gold facts become relations, and whether those relations are retrieved |
| Extracted but not retrieved | The covering relation exists but never appears among candidates at any step | Contextual embeddings; revised relation text; query refinement | |
| Retrieved but ranked low | Gold items appear in candidates but fall outside the top $k$ | Reranking | Rank distribution of gold items under the baseline. If recall at small $k$ is close to recall at large $k$, little is left to gain |
| Multi-hop failure | Recall of all gold chunks is well below single-hop recall, and answer quality sits well below the ceiling | Graph walk; query decomposition | Recall of all gold chunks on multi-hop questions against single-hop recall, and the gap to the ceiling on that subset |
| Topic-level failure | Topic-level questions sit well below the ceiling while single-hop questions do not | Clustering and community summaries | Gap to the ceiling on topic-level questions |
| Conflation | Retrieved items concern a similarly named but different node | Contextual node embeddings (see below) | |
| Fragmentation | Several nodes or relations for one object, and the walk fails to connect gold chunks | Node resolution and relation deduplication | Duplicate rate on a sample of extracted nodes and relations |
| Conflicting relations | Relations that contradict or supersede one another | Supersession links | Conflict rate on a sample of extracted relations |
| Phrasing failure | Recall is high for some paraphrases of a query and low for the original | Query refinement | For failing queries, recall of the original against the best of several LLM paraphrases. If paraphrasing does not help, the failure lies in the corpus or the index |
| Corpus gap | Recall stays low even at large $k$, and agent relevance ratings are low | Add sources; no retrieval remedy | |

*Contextual node embeddings.* A node is embedded together with context drawn from the corpus (its relations and source chunks), which separates entities such as DLS and the wider striatum that a bare name would collapse. Information internal to the corpus is preferred over anything external. Surface forms are retained, and merges stay verified and reversible.

## Planned Layers

These are intended to be built, in an order set by the Prioritization section.

- **Relation layer.** An LLM extracts relations and their nodes from chunks, guided by few-shot examples and per-database guidance. The purpose is a retrieval unit finer than a chunk, with context resolved so it embeds sharply, and a graph structure for walking. The relation text must stand alone, since it is both what is embedded and what a reader sees. Everything that walks, merges, or summarizes relations depends on it.
- **Graph walk.** Personalized PageRank over the graph of nodes and relations, seeded by query similarity, targets questions whose answer is spread across passages. Seeding, damping, and hub handling are tuned when the layer is built.
- **Equivalence.** Graphs accumulate duplicate nodes and relations, which fragments the walk. Proposals come from embedding similarity and are verified by an LLM: a new item is compared with its nearest existing neighbors, and the judge rules the pair a duplicate, a refinement, a supersession, or unrelated. Each outcome is recorded as a mapping. A duplicate adds its sources to the canonical item's view. A refinement or supersession is a link between the two. The relation layer and graph walk work without this layer. The exact process depends on which other layers exist when it is built. Because mappings are set-level, they record the state they were computed from.
- **Reranking.** A cross-encoder reorders retrieved candidates.
- **Query refinement.** Queries are rewritten or decomposed before retrieval, and critique of the retrieved results or of a candidate answer can trigger further queries. Decomposition competes with graph walk as a route to multi-hop answers.
- **Community summaries.** Hierarchical clustering of nodes and relations yields communities, and a summary of each becomes a retrievable item that answers whole-topic questions no local neighborhood answers. Summaries are set-level and versioned. They record their source relations, so staleness is detectable. They suit static corpora well and fast-changing project databases poorly.

**Granularity controls** arrive with the layers that need them: expanding a relation hit to its source chunks, weighting or mixing item kinds in one result list, the walk's damping and neighborhood size, and community level.

## Scale and Cost

Each of these waits for a measurement (latency, memory, extraction cost) to cross a threshold set at the time.

- An approximate-nearest-neighbor index in place of brute-force similarity.
- A graph store in place of an in-memory graph library.
- Incremental maintenance of set-level derivations, where recomputation becomes too costly. Local derivations update incrementally already.
- Batched or cached extraction.

## Use-Case-Triggered Work

These start when the corresponding use case begins, independent of failure rates.

- **Project databases:** temporal supersession between relations, and ingestion adapters for code, commits, and decisions.
- **Outcome tracking:** joining outcome reports to the evidence retrieved, to estimate which sources lead to working solutions.
- **Second-corpus test generators:** question sets written from a related corpus, usable whenever one exists.
- **Portable export** of the eval set and feedback labels.

## Prioritization

Work triggered by measurement is ordered by evidence. Observed failures are queued by frequency times fix cost, as the analysis tools report. Planned layers are ordered by the size of their measured pre-check gain, then by dependency (the relation layer precedes everything that walks or merges it). Scale work starts when a threshold is crossed, and use-case work starts when its project begins.

## Far Future

- Improvement flows directed by the user, with the analysis tools driven from an interface.
- A lexical retrieval channel for exact terms. Contextual node embeddings are the preferred answer to exact-term failures, so a lexical channel is considered only if they prove insufficient.

## Tentative Defaults

Superseded by the amendment "Stack settled" (2026-10-18) below.

## Amendments

**2026-10-18. Builds are part of v0.** (decision log 2026-10-17, open question Q1)
Rules 5 and 6 require events to record the data version they ran against and a warning when a pinned version cites chunks no longer current. Neither can be satisfied without builds, so v0 includes them. A build is a content-addressed manifest of the items in play and the recipes that produced them. Every ingest that changes the data creates one, and an unchanged re-ingest yields the same build. A build copies no data. Search runs against the current build unless another is pinned. Build names are insert-only labels.

**2026-10-18. Logging lives in the tool contract, not in MCP.** (decision log 2026-10-17, Q2)
The sentence "Logging is a property of the MCP tool layer" in v0 item 4 is replaced by: every interaction is logged by the shared tool layer (`KgApi`, via `runTool`). MCP is a thin adapter over that layer and eval runs call it directly, so agent sessions and eval runs write identical events through one path.

**2026-10-18. Rule 4 for chunks.** (architecture proposal, Rule 4 reading; user decision 2026-10-18)
Chunks are derived from source documents by a parse recipe and a chunk recipe, both recorded on the document version. They are the base layer: every later derived item cites chunks, and chunk IDs are the shared currency for evaluation and feedback. Chunks are immutable. A different parser or chunker produces new chunks, never edits old ones. This replaces the statement in Core Concepts that a chunk "is never derived from anything else", and "ground truth" is dropped.

**2026-10-18. Definition of "current ingest" for Rule 5.** (architecture proposal)
The current ingest is the union of the chunks of the current version of each document. A build is stale when it cites a chunk outside that set. A new document version that only adds chunks does not make earlier builds stale.

**2026-10-18. Pipelines are explicit state machines; a recipe names its machine.** (design-feedback "explicit state machines" and "decomposition and critique against the linear step contract"; decision log 2026-10-18; `scratch/sprint-1/state-machine-revision.md`; placement: Core Concepts, "Recipe and build", after the first sentence; v0 item 3 gets the last sentence.)
Every multi-step process (search, ingest, an evaluation run, question generation, judging) is an explicit state machine, written in code, one machine per kind. Each state does one piece of work by calling an ordinary module; the machine only orders the work and chooses the route. A recipe for such a process is the machine's name, its version, its typed settings, and a fingerprint of its topology (states and allowed moves, so editing the wiring without a version bump is refused). Changing the shape of a process means a new machine or version; tuning means changing settings. Loops (for example a critique pass that retrieves again) are moves back to an earlier state and need no special construct. Each run logs `pipeline.started` and `pipeline.finished` and each search step logs the state it came from, so a logged run maps back onto the machine and can be drawn. v0 contains one search machine (similarity); decomposition and critique are Planned Layers and are not built.

**2026-10-18. Formula handling in v0: an optional decoding stage and an embedding view.** (design-feedback "formula decoding on the Apple GPU", "formula decoders compared by LLM-judged meaning", "Kardar PDFs' text layer turns inline math into glyph names"; decision log 2026-10-18; contract 0.6.0; placement: v0 item 1, and Core Concepts "Embeddings".)
A parse recipe may include a formula-decoding stage that replaces the formula placeholders docling leaves with LaTeX, recorded in the recipe. The default recipe has none; whether decoding becomes the default is decided from the evaluation on formula-dependent questions. A chunk stores its text as parsed. The text actually embedded is a view of the chunk, and the view setting (`placeholder`: formulas as `[formula]`, or `full`) is part of the embedding space, so spaces differ by view as they differ by templates. Chunk boundaries are measured with formulas at placeholder length, so a decoded and an undecoded parse of the same document cut at the same places. Because the stored text differs, a decoded parse produces new chunk IDs and invalidates eval questions on those documents; the parse recipe is therefore chosen before the chunker freeze.

**2026-10-18. Every producer a recipe depends on is pinned or guarded.** (design-feedback "input-addressed rows are first-writer-wins"; `scratch/sprint-1/prov-review.md` A1, A2, A3; contract 0.4.0; placement: Rule 4 reading; Core Concepts "Embeddings".)
Rule 4 requires a recipe to identify exactly what to regenerate, so a recipe covers everything that changes its output. An embedding space records the model's digest, not only its tag, and checks it when embedding. A chunk recipe's `version` is bumped on any change to the chunker's output. Immutable rows are guarded: writing a document version that exists under a different chunk list is an `immutable_violation`. Terms used in the documentation: content-addressed (the ID hashes the output: chunks, builds), input-addressed (the ID hashes recipe and inputs: parse artifacts, document versions), derivation (a recipe applied to specific inputs), plan (the recipe), early cutoff (unchanged output stops downstream work).

**2026-10-18. Evaluation runs record their judge and answerer.** (`scratch/sprint-1/review-ingest-eval-viewer.md` should-fix 2; contract 0.6.1; placement: v0 item 6, after "A fixed judging procedure scores answers against the reference.")
A score is a derived record, so Rule 4 applies to it. Each evaluation run records the judge's recipe (prompt digest, model) and the answerer's model and prompt digest, in the run record and in the run's first event. Every judge and answerer model call goes through the logged model wrapper. Before any evaluation number is reported, the judge is validated on a sample of about 30 answers scored independently by a stronger model than the judge, and the agreement is reported with the numbers (plan: `scratch/sprint-1/judge-validation/plan.md`). The agreement measures the judge against a model, not a person.

**2026-10-18. Pointer moves are events; build lineage lives in the log.** (`scratch/sprint-1/prov-review.md` A5, A6; `scratch/sprint-1/lifecycle.md` section 4; contract 0.4.0; placement: addendum to the "Builds are part of v0" amendment.)
The two mutable rows in the store (a document's current version and the current build) change only through events that carry the old and the new value (`ingest.completed.previousDocVersionId`, `build.created.parentId`, and `revert` when an ingest returns to an existing build). A build's stored parent is the first one seen; because a build is identified by its content, the history of how the database reached it is read from the log, not from the stored parent.

**2026-10-18. Stack settled.** (decision log 2026-10-17, "Store is better-sqlite3 + sqlite-vec", "tooling versions", "Embeddings come from a local Ollama model", Q3; roadmap Principles; placement: replaces Tentative Defaults.)
TypeScript throughout, with docling run in a Python sidecar behind a parser interface that also accepts parse artifacts produced elsewhere. One SQLite file per database holds chunks, embeddings (sqlite-vec), builds and the event log. Embeddings and every model call (question generation, answering, judging) use local Ollama models for now; the model client is provider-neutral and results are cached for replay. The viewer is a static page served locally. These remain open to change under Scale and Cost.

**2026-11-06. Gold evidence can be a source span; chunk gold is derived from it.** (arXiv paired-corpus scoping; placement: Eval harness (v0 item 6), after "The eval set is pinned to chunk IDs.", and Search, after the paragraph on source chunk IDs.)
A question's gold evidence may be recorded as one or more source spans in addition to chunk IDs. A span names a document, an anchor that does not depend on chunking (a section path plus paragraph or equation label for sources with structure, otherwise a character range of the normalised source text), and the exact span text. When the same document is ingested by two routes (for example its TeX source and its PDF), a span is mapped to the chunks of each build by aligning the span text against the build's chunks; the chunks that overlap the span are that build's gold chunks. A span that cannot be aligned to any chunk is reported as an ingestion loss for that build and is not silently dropped. Questions are still generated on the fly, from a span instead of a chunk where the corpus has a structured source. An eval set that records only chunk IDs stays valid (a chunk is a span in its own build), and recall@k, the three answer conditions and the judge are unchanged. For a cross-corpus question, gold is a span in each document the answer needs; the citing sentence of a review fixes the first span and the supporting passage in the cited work, found and checked during question review, fixes the second.
The statement "A change to chunking requires regenerating the questions for the affected chunks" then applies only to chunk-pinned sets; span-pinned sets are re-mapped, not regenerated.
