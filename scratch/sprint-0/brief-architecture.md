# Architecture drafting brief (Sprint 0, Phase 0)

You are one of three agents independently drafting the v0 module architecture for a knowledge-graph retrieval system. Do not look at the other drafts. Write exactly one file, `scratch/sprint-0/drafts/<your-lens>.md`, of at most about 6,000 words, and change nothing else in the repo.

## Read first
- `design/260916_initial-roadmap.md`: the design (Core Concepts, Rules, v0, Planned Layers). This is the target.
- `design/261017_v0-implementation-roadmap.md`: the workflow; the Phase 0 section says what you must decide and the Phase 0 review criteria say how your draft will be judged.
- `scratch/decision-log.md` and `scratch/design-feedback.md`: decisions already made and spike evidence. Treat decisions marked "user decision" as fixed.

## Fixed constraints
- TypeScript (Node 22, pnpm workspaces). Docling runs as a Python sidecar behind a parser interface.
- Store: one SQLite file per database via better-sqlite3 + sqlite-vec (verified working; brute-force KNN is fast enough at this scale). Chunks, embeddings and the event log share it.
- Embeddings: local Ollama model, stored keyed by model and conditioning.
- Parsing must be separable: the parser produces a portable, self-contained artifact (docling JSON, 0.3-1.0 MB per document) keyed by source file hash and parser recipe, so parsing can later run on a GPU server. Chunking runs locally from that artifact and must give identical chunk IDs wherever parsing ran. Parser settings are a recipe (OCR off by default; escalation options such as OCR or formula decoding are future recipes, possibly chosen by a quality check on the output).
- No equation decoding in v0.
- v0 contains no extraction, but the model must leave room for relations, nodes, mappings, recipes and builds, graph walk, equivalence, reranking, query refinement and community summaries without modifying existing interfaces where possible.
- Phase 4 corpus: `test/corpa/stat-mech/` (4 PDFs, 337 chunks).

## What to decide and write down
1. Packages, what each owns, and the allowed dependency directions (a diagram or table).
2. Core data model as TypeScript types (real code blocks): Chunk, Item, Node, Relation, Mapping, Recipe, Build, Event, SearchResult, and ID derivation (including a chunk ID scheme that survives re-ingestion and an insertion early in a document).
3. Interfaces between packages as TypeScript signatures, including the search pipeline's step structure so each step's candidates and ranks are logged and later layers can slot in.
4. SQLite schema, including empty tables for what v0 does not populate.
5. Event catalog and the single contract by which every interaction reaches the log.
6. Testing in isolation: fakes, fixtures, conformance suites per interface.
7. Docling sidecar form, and the parse-artifact format and import path.
8. Phase 2 work breakdown: packages, dependencies, which suit low-cost models.
9. Traceability: a table mapping each of the six Rules and each v0 item (1-6) to where it lives in your architecture.
10. Extension walk-throughs: for relation layer, graph walk, equivalence, reranking and community summaries, state what would change in your structure. Be honest about interface changes.
11. Decisions: label each as arbitrary, evidence-resolvable, or needs the user, per the roadmap's "Decisions and autonomy", with a one-line rationale (arbitrary) or options and reasons (consequential). List the ones that need the user.
12. Your biggest risk: the assumption in your draft you are least sure of.

## Style
Concrete over general. Prefer types and tables to prose. Do not pad. If the brief and design disagree, say so under a heading "Conflicts" rather than silently choosing.

## Your lens
Given in your task message. It sets your priorities when options conflict; it does not excuse ignoring the other criteria.
