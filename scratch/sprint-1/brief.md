# Sprint 1 brief and plan (written 2026-10-18, before execution)

**Goal:** all v0 components built by cheap models from their package cards and working together, including the viewer (roadmap Phases 2 and 3). Phase 4 (baseline measurement) is Sprint 2.
**Starting point:** end of Sprint 0, see `../sprint-0/brief.md`. `core` 0.2.0, `testkit`, 12 package cards, 278 tests passing, hidden skeleton in `packages/app/src/skeleton`. Nothing is committed to git yet.

## Decided since Sprint 0 (decision log 2026-10-18)
- Amendments recorded in `design/260916_initial-roadmap.md`: builds in v0, logging below MCP, chunk reading of Rule 4 (chunks derived by parse + chunk recipes, no "ground truth"), definition of "current ingest".
- Roadmap Phase 2 now names the formula spike and its review criterion.
- Q5: skeleton stays hidden; implementers must not read `packages/app/src/skeleton`; after each of the five duplicated packages (chunk, ingest, search, api, embed) is built, diff it against the skeleton as an oracle.
- Adopt P-1 (named candidate pools) as core 0.3.0.
- Keep a small agent-scored sample (about 30 answers) to validate the judge; no human scoring.
- Judge, answerer and question writer are local Ollama models until the GPU server is ready (expected before Phase 4).

## Work, in order

### Wave 0: contract and design tasks (before any package is handed out)
1. **Commit the repo** (nothing is in git). Ask the user first; one commit of Sprint 0's state is enough.
2. **Pools (P-1), core 0.3.0.** `pools: Record<string, Candidate[]>` on `SearchState` (`{}` in v0), an optional `pools` summary on `StepTrace`, `vector-knn` gets an optional `into` param (default unchanged), and the contract text for a fuse step (not built). Update the search step conformance suite, the viewer and search cards, golden vectors or fixtures if they change, and `contract-revisions.md` (new entry). `pnpm check` must pass. No v0 behaviour changes. Do this before the state-machine spike so the spike works against 0.3.0.
3. **Lifecycle document** (`scratch/sprint-1/lifecycle.md`): the ingest sequence (identify, parse|cache|import, chunk, embed, build, commit pointers) with which pointer moves when and what each event records; the search state and step rules (`done` skip, merge-on-retrieve); the invariants as one-line checks, each with the test that enforces it. Becomes an acceptance check for store, ingest and search.

### Wave 1: spikes (run in parallel with Wave 2, no package changes)
4. **State-machine spike** (`spike-state-machine.md`). Strong model. **Blocks only `search` and `ingest`.** Result decides whether those two packages are built as step runner (current cards) or as machines; contract changes come back as proposals.
5. **Formula spike** (`spike-formula-vlm.md`). Must finish before the chunker freezes (before Phase 4 question generation), not before the chunk package is built.
6. **PROV / Nix review.** One reviewer maps the provenance model (recipes, builds, content-addressed items, event log) onto W3C PROV and Nix/Bazel/DVC vocabulary; reports ideas we missed or terms we should adopt in docs. Output: `scratch/sprint-1/prov-review.md`. Blocks nothing.

### Wave 2: package builds (parallel, cheap models, each from its card + core + testkit only)
Model assignments from the cards: `parse-sidecar` (Sonnet), `parse` (Haiku), `chunk` (Sonnet), `embed` (Haiku), `store` (Sonnet), `eventlog` (Haiku), `api` (Sonnet), `mcp` (Haiku), `eval` 11a metrics and runner (Haiku) and 11b prompts (Opus for prompts, Haiku for parsers), `viewer` (Haiku/Sonnet). Each package: owned directory only, README with assumptions and known gaps, a notes file in `scratch/notes/<package>.md`, and changes to contracts only via a change proposal.
- `store` is the riskiest (no SQLite implementation exists). Add a fake-vs-SQLite cross-check, run `knnFixtureSuite`, and confirm the S2 build rule against SQLite.
- `mcp` must be run against the real MCP SDK; zod 4 schema handling is a known trap (card).
- `chunk` freezes before Phase 4; it must still pass the golden vectors.
- `eval` judge and prompts: validated in Wave 3 review, not by the author.

### Wave 3: `search` and `ingest` (after the state-machine spike)
Built either from the current cards (Haiku for steps and tests, Sonnet for the runner; Sonnet for ingest) or from machine-based cards written after the spike. If the spike changes contracts, revise cards and conformance first (Wave 0 style), then build.

### Phase 3: integration
Merge the packages and run the full suites with real implementations. Ingest the stat-mech corpus end to end, run searches and a small eval, and inspect the results and the log (not just green). Check the viewer against a live and a finished session. Cross-package review for duplicated logic, divergent contract readings and log gaps.

## Review (stronger model than the implementers; not the author)
- Mechanical per package: tests, types, dependency-cruiser, owns only its directory.
- Contract: diff against the card for behaviour beyond spec and silent deviations.
- Design rules: audit the six rules, with mutation testing on contract-bearing packages (it found 12 weak spots in Sprint 0).
- Oracle diff: compare the five packages with skeleton equivalents.
- Eval design: sample generated questions for leakage, answerability and tag correctness; validate the judge against the 30-answer agent-scored sample before trusting any number.
- Spike reviews as in the roadmap.

## Retro questions (in addition to the standing ones)
- Where did cheap models need sibling code or contract changes? Which models handled which packages well?
- Did the lifecycle document and invariants catch anything the package tests did not?
- Did the state-machine decision hold up once applied?
- Is v0 a sound base for the relation layer?

## Open / provisional
- Embedding model stays embeddinggemma until after the Phase 4 baseline (Q4).
- P-2(a)/(c) deferred; P-1 adopted this sprint.
- Parser quality gate and Kardar glyph-name cleanup not built; depends on the formula spike and measurement.
- GPU-server parsing and equation decoding: not needed this sprint.

## Waiting on the user
- Approval to commit the repo (Wave 0, step 1).
- Any contract change the state-machine spike proposes.
- Design-doc changes arising from reviews (amendments need approval).
