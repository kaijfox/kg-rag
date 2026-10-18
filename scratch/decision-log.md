# Decision log

One entry per decision: date, the choice, its kind (arbitrary / evidence-resolvable / user), and a one-line rationale. Evidence-resolvable and user decisions also list options considered and the evidence.

## 2026-10-17: No equation decoding in Sprint 0
Kind: user decision. Docling formula enrichment is skipped (formulas stay as placeholders or images). Reason: CPU decoding is correct but slow (194s for 3 pages), and MPS is unsupported; see design-feedback entry of the same date. Revisit later with a GPU server.

## 2026-10-17: Parsing must be separable from the rest of the pipeline (architecture constraint)
Kind: user decision. v0 should later be usable with parsing run on a GPU server and the processed/chunked output transferred back easily. Phase 0 treats this as a constraint: the parser's output is a self-contained, portable artifact keyed by source file hash and parser recipe (docling version and options), and ingest can consume such an artifact without running docling locally. The sidecar's deployment form (local process or remote service) must stay a configuration choice behind the parser interface.

## 2026-10-17: Store is better-sqlite3 + sqlite-vec (one SQLite file per database)
Kind: evidence-resolvable. Options: sqlite-vec, LanceDB. Evidence: both install on Node 22 / arm64; sqlite-vec loads into better-sqlite3 (SQLite 3.53.4, vec 0.1.9) and brute-force KNN over 20,000 x 384 vectors takes 1.7 ms/query; the stat-mech corpus parsed to 337 chunks in total. Chunks, embeddings and the event log share one file, matching design v0 item 2, and one file is easy to copy to or from a server. LanceDB was only installed, not benchmarked, because nothing here needs it. Revisit under Scale and Cost if latency becomes an issue.

## 2026-10-17: Parse with do_ocr=False by default
Kind: evidence-resolvable. Options: OCR on (docling default), OCR off. Evidence: all four PDFs have a text layer; on ThermoPlischke OCR off parses in 5-6s against 90s and removes the garbled text OCR produced ("ideal gas law" passage now clean). OCR becomes a per-document parser option recorded in the parse recipe, for genuinely scanned sources.

## 2026-10-17: Embeddings come from a local Ollama model
Kind: user decision. Specific model is an open sub-choice for Phase 0 (spike: quality and speed on stat-mech chunks via Ollama's HTTP API). Embeddings are stored keyed by model and conditioning, per the design doc.

## 2026-10-17: Phase 4 corpus is the stat-mech set (two topics x two authors)
Kind: user decision. The roadmap's "does it suffice" question is answered: it does for the baseline. 337 chunks in total.

## 2026-10-17: Phase 0 uses distributed drafting, with review and synthesis done by the lead
Kind: user decision. Amends the roadmap's Phase 0, which has one author. Three agents draft module architectures independently from a shared brief (`scratch/sprint-0/brief-architecture.md`), each under a different lens. The lead agent (not separate reviewers) runs the Phase 0 review criteria across the drafts, synthesizes one proposal, and takes it to the user for sign-off. To be recorded as a dated amendment in the roadmap by the user.

## 2026-10-17: Section path stays in the chunk ID; the parse recipe is frozen with the chunker
Kind: evidence-resolvable. Options: ID = H(doc, sectionPath, text, occurrence) or the path-free H(doc, text, occurrence) fallback two drafts proposed. Evidence: OCR on vs off over ThermoPlischke and FoundationsKardar (design-feedback entry of this date) shows the headings are stable and the text is what changes, so the fallback gains nothing. Keep the section path; it also keeps identical text in different sections distinct.

## 2026-10-17: Architecture signed off (user), with answers to Q1-Q3
Kind: user decision. Q1: builds are in v0 (content-addressed, created by every changing ingest). Q2: logging lives in the shared tool contract (`KgApi`/`runTool`), MCP is a thin adapter; this amends the design sentence "logging is a property of the MCP tool layer" (to be recorded as a dated amendment by the user). Q3: every LLM call (eval question generation, judging, answering) uses a local cheap Ollama model for now, to move to a GPU server soon after v0. Consequence: the `Llm` port stays provider-neutral; the judge must be validated against hand-scored examples with extra care because the model is weak; replay caching is kept so reruns are free and reproducible. Basis: `scratch/sprint-0/architecture-proposal.md`.

## 2026-10-17: Autonomy while the user is away (user instruction)
Kind: user decision. The lead decides the remaining Sprint 0 choices without waiting. Be reserved where unsure: park anything that changes a core concept, a rule or the v0 scope in open-questions.md and proceed only on the recommended provisional default if it is cheap to redo. Where the choice is between a computationally expensive route and a cheap one, take the cheap one for Sprint 0.

## 2026-10-17 (Phase 1): TS chunker section-pack/1 kept; HybridChunker fallback not needed
Kind: evidence-resolvable. Options: TS section-pack/1 (provisional in the proposal), docling HybridChunker via a
second sidecar command. Evidence (design-feedback spike 5a): on the four OCR-off parses TS gives 312 chunks vs 336,
median 855 vs 822 chars, under-200 chunks 3 vs 8, mid-sentence ends 30 vs 56, the same section paths, and all 20
spot-checked boundaries at block or sentence ends; the shared weakness (a "where ..." continuation cut from its
formula) occurs in both. Rationale: not worse on any measure, and import-only machines need no Python.
The chunker is still frozen only before Phase 4.

## 2026-10-17 (Phase 1): chunk ID scheme confirmed on real edits
Kind: evidence-resolvable (closes the open "insertion test" item). Evidence: design-feedback spike 5b: 100% of
chunks outside touched sections keep their IDs; an index scheme lost 19 of 39 when an insertion added a chunk.

## 2026-10-17 (Phase 1): embeddinggemma:latest with its retrieval prompts is the provisional embedding space
Kind: evidence-resolvable, partially (only one model was available). Options: the proposal's candidates
(nomic-embed-text, mxbai-embed-large, bge-m3), none installed; embeddinggemma installed. Evidence: spike 5c: 768
dims, 39 chunks/s, recall@10 0.81 with templates vs 0.68 without on 31 hand queries. Rationale: adequate for the
baseline; spaces are keyed by model and templates, so switching costs one re-embed. Comparison pending Q4.

## 2026-10-17 (Phase 1): tooling versions
Kind: arbitrary. TypeScript 5.9.3 (not 7.0: dependency-cruiser and tsx rely on the JS compiler API), zod 4.1.12
(built-in JSON Schema export for the sidecar), vitest 3.2.4, dependency-cruiser 17.4.3, tsx 4.21.0, pnpm 10.29,
Node 22.17; packages export TypeScript sources directly (no build step). Any recent versions give the same result.

## 2026-10-17 (Phase 1): skeleton uses the in-memory store and log from testkit
Kind: arbitrary. A thin SQLite store would have been a second, untested implementation of the Phase 2 store;
the in-memory fakes pass the same conformance suites. schema.sql is still exercised against real SQLite in core's tests.

## 2026-10-17 (Phase 1): ingest is all-or-nothing per call
Kind: arbitrary. Doc versions, embeddings, pointers and the build are written in one transaction after every
document is parsed, chunked and embedded; parsed artifacts are stored immediately. Per-document commits would also
satisfy the rules; one transaction makes "no half-written document version" trivially true.

## 2026-10-17 (Phase 1): small contract choices
Kind: arbitrary, one line each. normName keeps brackets (R-01; the testable draft's own example needs it).
title headings are level 0 (any value below section headers gives the same paths). The search fixture's
HashEmbedder uses 4096 dims (fewer bucket collisions, so rankings are explainable by word overlap).
Feedback carries overall and per-item relevance in one call (R-06; same events, fewer MCP calls). Build labels
are insert-only (R-04; the design's "named, pinned manifest").

## 2026-10-17: Q4 resolved: embeddinggemma for Sprint 0 and the baseline; more embedding models only after the Phase 4 baseline
Kind: arbitrary under the user's standing instruction (cheap option for Sprint 0). The embedding space is keyed by model and templates, so a later switch re-embeds about 312 chunks and changes no chunk ID or eval question. Comparison runs against the pinned eval set, not against 31 hand queries.

## 2026-10-17: Phase 1 verified by the lead; independent review (stronger model) requested
Lead re-ran `pnpm check` (221 tests passing: core 17, testkit 126, app 78) and `pnpm skeleton --hash`; the log for one search reads query -> step 0 vector-knn -> step 1 truncate -> result -> feedback, and a feedback call on an unknown search fails with `not_found` and leaves `tool.failed`. P-1/P-2/P-3 (contract-revisions.md) are held until the independent review reports.

## 2026-10-17: Phase 1 review outcome and contract decisions (lead, autonomous)
Basis: `scratch/sprint-0/review-phase1.md` (independent reviewer, strongest model; no BLOCKER, 7 SHOULD-FIX, 38 mutants of which 25 caught). Kind: evidence-resolvable; the review contains the evidence.
- Adopt before fan-out, in `core` 0.2.0 and testkit: S1 (hash item IDs into the build ID), S2 (every build item must have an embedding in each manifest space, else `precondition`), S3 (`getItems` with `buildId` returns members only; `buildId` on `eval.run.started` with envelope equality; build tags tested on usage/outcome/step/result), S4 (eval card gets a store/staleness read, a defined `oracle-gold-first`, and `orphanedGold`), S5 (pack by `normText` length), S6 (viewer gets `itemInfo -> {label, text}`), `queryId` on `RankedRef`, P-3 via `AsyncLocalStorage` in `runTool`, P-2(b) merge-on-retrieve, plus the survivors' missing tests (M03, M08-M10, M16, M17, M20-M23, M31, N4).
- Defer: P-1 named pools (no consumer yet; revisit when decomposition is scheduled by evidence; the weaker option of allowing one entry per (itemId, queryId) between retrieval and fuse steps is recorded as the first thing to try), P-2(a) `done` skipping and P-2(c) `searched` (no consumer or test; contract text no test enforces invites drift), L1-L8 (design-feedback).
- S7 (skeleton duplicates five Phase 2 packages): parked in open-questions.md as Q5; provisional default is to leave it under `app/src/skeleton`, hidden from implementers.
- Not pulling forward: promoting skeleton code into packages, re-opening the package split, or folding eventlog into store.

## 2026-10-17 (Phase 1 fixes, contract 0.2.0): choices made while applying the review
Kind: arbitrary unless noted, one line each.
- S2 is enforced in `putBuild` (one place) and satisfied by ingest embedding the other current documents' missing
  chunks; the alternative (ingest fails with precondition after a space switch) would make switching spaces need a
  full re-ingest. Consequential but resolved by the design text ("switching embedding model" is sanctioned).
- Merge-on-retrieve does not cut to the pool: each variant contributes at most `pool`, the union is logged whole.
- Hard cuts take the shortest prefix of normalized length M, so single-spaced fixtures split exactly as before.
- The eval-runner suite builds its own environment from fixtures (scripted retrievals keyed by question text), so
  recall must equal expected-metrics.json; its control is a test-only reference runner, not shipped code.
- The MCP suite takes a `connect(api)` adapter so it runs without the SDK in testkit; app runs it on `mcpCall`.

## 2026-10-18: Sprint 1 additions and Rule 4 reading (user decisions)
Kind: user decision. (1) Adopt P-1 (named candidate pools in SearchState, `pools: {}` in v0; `vector-knn` gets an optional `into` param; fuse step deferred) as part of Sprint 1, a core 0.3.0 contract bump before fan-out. Rationale: cheap while no package is built; keeps decomposition expressible with per-subquery traces. (2) Rule 4 amendment wording: chunks are derived from source documents by a parse recipe and a chunk recipe recorded on the document version; they are the base layer that all later items cite, and are immutable; a different parser or chunker produces new chunks. "Ground truth" is dropped. (3) Sprint 1 task: a reviewer maps the provenance model onto W3C PROV and Nix/Bazel/DVC vocabulary to check for missed established ideas. (4) Keep a small agent-scored sample (about 30 answers) to validate the judge; no human scoring. (5) Q5 option (b). Amendments 1, 2 and 4 (builds, logging below MCP, "current ingest") approved for recording in design/ as a dated block, pending final wording sign-off.

## 2026-10-18: P-1 pool details (Sprint 1, Wave 0)
Kind: arbitrary. (1) `into` with a `{queryId}` placeholder expands per query variant, otherwise one pool fuses all variants by max; chosen so per-subquery pools (the motivating case) need no extra param. (2) An `into` retrieval merges into its pool (fuseMax) rather than replacing it, mirroring P-2b idempotence. (3) `StepTrace.pools` lists the pools the step read or wrote, after the step. (4) Fuse contract: RRF with rrfK 60 default, replaces `candidates` unless `keepExisting`. Rationale: smallest precise semantics; all unbuilt parts are documented only. See scratch/notes/pools.md.

## 2026-10-18: Contract 0.4.0 choices (R-34)
Kind: arbitrary. (1) `EmbeddingSpaceSpec.digest` is required (it must enter the SpaceId); test spaces use fake digests. (2) `ingest.completed.previousDocVersionId` and `build.created.revert` are optional zod fields that ingest always sets: additive, no schemaVersion change, old logs validate; chosen over a new `build.current` event. (3) `putDocVersion` compares the ordered chunk list. (4) No SCHEMA_VERSION bump for the mapping CHECK rename (no database exists). See scratch/notes/contract-0.4.md.

## 2026-10-18: Formula-VLM spike: no formula decoding in the default v0 parse recipe (provisional, spike agent)
Kind: evidence-resolvable. Options: (a) add Apple-GPU formula decoding (GLM-OCR 4-bit MLX) to the default recipe; (b) keep the Sprint 0 choice (placeholders); (c) offer decoding as an optional post-pass recipe later. Evidence: speed is fine (605 formulas in 4.3 min on MLX, against about 4.1 h for docling's CPU CodeFormula), but best gold-set exact match is 82% (rule asked for about 90%) and the retrieval pilot shows a small regression (31 hand queries MRR 0.671 to 0.598; chunks 312 to 440). Choice: (b) now, (c) as the route if the user wants it; revisit with the Phase 4 eval set. The user can overrule; see open-questions Q6. Details: scratch/sprint-1/spike-formula-vlm/results.md.

## 2026-10-18: Formula-VLM spike: model downloads kept to about 3.5 GB, Qwen3-VL-2B not pulled
Kind: arbitrary. Pulled GLM-OCR-4bit, PaddleOCR-VL-1.6-4bit, Granite-Docling-258M-mlx, texify and pix2tex weights into `~/.cache/kgrag-spike-formula` (outside the repo), plus docling layout models for one integration test; the installed Ollama qwen3.5 served as the general VLM instead of pulling a small Qwen-VL (1.8 GB more would pass about 5 GB). Skipped for size: olmOCR 7B, dots.ocr, Nougat, Qwen2.5-VL-3B; UniMERNet is gated. See open-questions Q7.

## 2026-10-18: Formula-VLM spike: scoring conventions
Kind: arbitrary. Gold references are hand-corrected docling CPU CodeFormulaV2 output with neighbouring prose, equation numbers and alignment markers removed; the metric is exact match of normalized token sequences (braces, `\left/\right`, spacing and style wrappers ignored; the crossed d is its own token), reported "lenient" (candidate `\text` fragments dropped) and "strict". The primary comparison uses docling's default crop (page at 1.67 scale, bbox expanded 18%); a 4% margin is reported alongside. Render-equivalence via pdflatex was computed but is too brittle to use.

## 2026-10-18: State-machine spike choices (Sprint 1)
Kind: arbitrary unless noted, one line each.
- Search verdict: keep the runner; the pre-set rule fails on "shorter or clearly easier" (104 vs 15 lines); recommend one data construct, `repeat`, instead of machines (proposal CP-SM-1). Kind: evidence-resolvable, resolved by the rule the user set.
- Ingest verdict: the rule is met; adopting is the user's call because it needs storage additions (Q8).
- Machine recipes were hashed as `{machine, settings, topology}` with a fingerprint of the machine config; kept out of core (spike only).
- A "crash" in the spike is a hard actor stop plus a dead-process flag; restart is a new service over the same store. No SQLite, no real kill.
- Libraries stayed inside `scratch/sprint-1/spike-state-machine/`; the core 0.4.0 baseline (not 0.3.0) was used because it changed while the spike ran.

## 2026-10-18: Contract 0.5.0 (state machines), core-only wave
Kind: arbitrary unless noted, one line each.
- `pipeline.started` and `pipeline.finished` both carry a `pipeline` field (the plan's `pipeline.finished` had none), so the envelope rule (search needs build and search id, eval-run needs build, ingest and eval-generate need neither) can be checked from one event alone. Kind: resolves the plan's open envelope rule.
- The rule lives in a payload-dependent check in `events.ts`, not in `BUILD_REQUIRED` (that set is by event type only).
- `DEFAULT_SEARCH_RECIPE.spec.topology` is a provisional literal (`69bc55d30db24c90`, a hash of a description of the similarity wiring), because the machine does not exist yet; the search package replaces it with the real fingerprint, which moves the default recipe id and every build id once more.
- `MachineMap` carries `machine`, `version`, `topology` and `initial` besides nodes and edges, so a map is self-describing; `validateMachineMap` checks structure only (unique ids, edges and parents resolve, finals have no moves, other nodes have one).
- `pipeline` enum is `search | ingest | eval-run | eval-generate` as in the plan; the judge and per-question machines run inside `eval-run` and are not bracketed on their own.
- Cards for packages needing no content change got the 0.5.0 stamp; search, ingest, eval and viewer cards keep 0.4.0 until their waves rewrite them.
- Testkit minimum for Wave 1: log fixtures gained `state` on each step (retrieve for vector-knn, cut for truncate), `V1_SEARCH_RECIPE` uses the new shape, `done` dropped from step-state literals; no `pipeline.*` events in fixtures or fakes yet.

## 2026-10-18: Contract 0.6.0 (formulas in v0), core wave
Kind: arbitrary unless noted, one line each.
- `formulaView` is a required field of the space spec (not optional), default `placeholder` in `DEFAULT_SPACE`; the default space's `es_` changes once. Kind: follows the plan (the view must be in the space id).
- `formulaDecoding` is an optional object under the parse recipe's `spec` (beside `options`, not inside it, because `options` maps 1:1 onto docling's options). Absent leaves recipe ids unchanged; `do_formula_enrichment` stays literally `false` (docling's own stage is not used).
- `cropMargin` is a fraction of the box size added per side, 0 to 1; docling's default crop (the one the spike's best GLM-OCR result used) is 0.18, so that is the value to record for "docling's default".
- `ChunkViewRenderer` lives in core `ports/parse.ts` next to `Chunker`; its input is block refs, which cannot name a piece of a split block. Recorded as an open question on the chunk card instead of changing the signature. Kind: evidence-resolvable by the chunk implementer; may need a contract change.
- Ingest gets two injected collaborators, `chunkView` and an optional `formulaDecoder`; the embed package is unchanged.
- Chunker measuring formula blocks at placeholder length is marked recommended, to verify, on the chunk card.
- Cards stamped 0.6.0: api, chunk, embed, eventlog, ingest, mcp, parse, store. Search, eval and viewer cards stay 0.4.0 until their waves rewrite them.
- Testkit minimum: `formulaView: 'placeholder'` on the two space literals; golden `ids.json` regenerated by `oracle.py`; new golden recipe vector `PARSE_RECIPE_WITH_FORMULA_DECODING`.

## 2026-10-18: chunk view renderer takes the stored chunk text
A chunk's block references name a block, not which piece of a long split block it holds, so a renderer working from references alone could not rebuild the text of such chunks. Options: record a piece index with the references, or pass the stored chunk text. Chosen: pass the text; the placeholder view finds each formula block's text in it positionally (formula blocks are never split). No new stored data, and the renderer no longer needs the splitting rules. Contract 0.6.0 type and chunk card changed accordingly.

## 2026-10-18: @kg/viewer build (WP12 card)
Kind: arbitrary unless noted, one line each.
- Mermaid vendored at 12.1.0, the newest npm release more than two weeks old (2026-10-02); the npm package's `dist/mermaid.min.js` is self-contained, so no chunks are needed. Kind: follows the card.
- Pure page functions (`renderTimeline`, `mermaidOf`, `pathOverlay`, `nextOf`, `diagramOf`, `runsOf`) live in `web/render.js` as plain JS with JSDoc, so the browser and the tests run the same code; `tsconfig` sets `allowJs`. Kind: needed because the page has no build step and TS cannot be served.
- Running overlay state is a successor set `nextOf` (done and always edges through routing states, error edges excluded). Kind: the card says "the successor"; a work state with a loop has two successors.
- Routing states on a traversed path count as reached in the diagram (dashed or grey would hide the path). Kind: arbitrary.
- A run is the events from `pipeline.started` to `pipeline.finished`; the page draws the latest run and lets the user pick another. Kind: arbitrary.
- `port` makes `createViewerServer` listen on 127.0.0.1 at once; otherwise the caller listens. Kind: arbitrary (the card does not say who listens).
- Item IDs inside JSON rows (tool input, summary) are replaced by labels too, so the timeline shows no raw item IDs when `itemInfo` knows them. Kind: follows the card's "labels, not raw IDs".
- Click-through for the state's search steps is a button per state beside the diagram, not a click on the SVG node (no dependence on rendered SVG identity, as the card asks). Kind: follows the card.
- The live overlay needs `pipeline.started`; the cut-off search in `session-live-partial` has none, so it is shown flat. The fixture was not edited (testkit is out of scope); see the change proposal and the open question.

## 2026-10-18: Q10 resolved by the lead: live fixture gains `pipeline.started`
Kind: arbitrary (matches the contract rule that every search writes it right after `query`). `session-live-partial` now has 13 events (`pipeline.started` at seq 12); viewer tests updated and a live overlay case runs on the real fixture. Option (a) of Q10.

## 2026-10-18: Q10 resolved by the lead: live fixture gains `pipeline.started`
Kind: arbitrary (matches the contract rule that every search writes it right after `query`). `session-live-partial` now has 13 events (`pipeline.started` at seq 12); viewer tests updated and a live overlay case runs on the real fixture. Option (a) of Q10.

## 2026-10-18: Ingest machine shapes (WP7)
Kind: arbitrary unless noted, one line each.
- Preparation (recipes and space) runs in the service before the machine: a work state would have to log an event, and none fits. Kind: follows the map rule (change proposal ingest 1).
- The commit and the announcements are one state (`committing`): the transaction is silent, so it has to carry the events after it. Kind: follows the map rule (change proposal ingest 1).
- Parsing and decoding log `ingest.parsed` only when the artifact is final, so a decoding run logs it once. Kind: arbitrary.
- Formula decoding parses under the plain recipe and caches the decoded artifact under the full one. Kind: arbitrary (the card's two readings disagree).
- Imported artifacts must be under the database recipe or its plain form, else `precondition`. Kind: arbitrary.
- `chunkView` is optional in `IngestDeps` (the testkit does not supply one). Kind: follows the testkit (change proposal ingest 3).
- Duplicate docKeys are detected after identify or import, as the card orders the states. Kind: arbitrary.

## 2026-10-18: Eval machine shapes (WP11a, WP11b)
Kind: arbitrary unless noted, one line each.
- `runEval` opens the eval session and bracket-checks the question loop only; pinning and completion sit outside the bracket, because the runner suite fixes the event order (change proposal eval 1). Kind: follows the suite.
- Silent steps (question route, generation selecting and validating, judge and generation parsing) are routing states with guarded always-moves; the map rule requires work states to log (change proposal eval 2). Kind: follows the map rule.
- Retry budget N allows N retries after the first reply, for judge and generation. Kind: arbitrary (the card's example, budget 2 with two malformed replies, fixes it).
- Judge replies are strict JSON with exactly score and rationale; generation replies are strict per type. Kind: arbitrary.
- Prompt digest = sha256 over every `.md` in `src/prompts` (README included), sorted by name, name and content each NUL-terminated. Kind: arbitrary (the README says "the files in this directory").
- Oracle list = gold chunks that are members of the pinned build, in gold order, then retrieved items not present; cut to max k. Kind: arbitrary (the card leaves membership open).
- A non-standard condition name is a retrieved condition only with a search recipe for it; otherwise invalid_input before the run. Kind: arbitrary.
- Answer and judge settings are constants (qwen3.5 at temperature 0); generation uses temperature 0.7 and a 1200-token cap. Kind: arbitrary.

## 2026-10-18: Sprint 1 review triage (lead, autonomous; reports in scratch/sprint-1/review-*.md)
Kind: evidence-resolvable unless noted. None changes a core concept, rule or v0 scope.
- chunk: sentence cut and hard cut follow the skeleton's reading (piece ends at the period inside the window; hard cut falls back to the longest prefix <= M). Evidence: oracle diff (116/2000 and 313/2000 blocks differ) and the mini-corpus README; a chunk longer than maxChars breaks the size invariant. Chunker is not frozen, so ids may still move. Formulas inside inline groups render as part of the group (fixes the `renderChunkView` throw). Block offsets in chunk text: deferred (no id change).
- ingest: imported artifacts with another parse recipe are accepted and the build is flagged `mixedRecipes` (design: a manifest that mixes recipe versions is recorded as such). `chunkView` becomes required. Extras use the version's block refs. Recipes and space are written only after the embedder check.
- testkit: `machineLogConformance` generalised to non-search machines; `machineMapConformance` keeps requiring logs on work nodes, pure steps stay routing states (house pattern, eval proposal 2 rejected); `IngestDeps.chunkView` added; `evalRunnerConformance` checks relative event order so the full-run bracket is allowed.
- core text: `ingest.started.parseRecipeId` is the plain recipe the parse cache is keyed by; a failed work state may log no step. Eval run records judge and answerer recipes (Rule 4): additive field on `eval.run.started` and the run config, contract 0.6.1.
- store: relation node order keeps rowid order with a test; the `position` column is deferred (not blocking). Summary storage deferred to the relation-layer sprint (port says `not_implemented`). eventlog/store transactions become immediate, opening for read must not need the write lock, WAL set explicitly.
- search: truncate trace records the effective `k`. embed: request sets `truncate:false`.
- parse-sidecar: adopt proposals 1, 2, 3, 5, 6. Proposal 4: the sidecar stores bare LaTeX (delimiters and `\tag` stripped) so decoded text is decided in one place before any decoded artifact exists. Kind: arbitrary, with the chunker as the other candidate place.
- eval: generation and judging are not pipeline runs (no tool context); judge LLM calls get logged through the same wrapper as the answerer; a judge retry resends a corrective request so the cache cannot return the same bad reply.
- viewer: POST /api/notes checks Origin and Host (loopback only); numeric payload fields escaped. Uniqueness of event types across map nodes rejected (first-wins documented).
- deferred: `failTo` helper in `@kg/pipeline` for the repeated `onError` assign (nit); `topologyOf` blind spots documented in the pipeline README rather than fixed.

## 2026-10-18: parse and parse-sidecar review fixes
- Decoded text is bare LaTeX: `\tag{..}` is removed wherever it occurs, then one `$$` or `$` pair, then trim. Kind: arbitrary; the chunker was the other candidate place.
- `stats.undecodedFormulas` uses one rule in both commands (formula items with empty text); `parse` counts every formula because no decoder runs. Kind: arbitrary.
- `decode-formulas` sets `producedAt` to the decode time and keeps `producedOn`; no host is added. Kind: arbitrary.
- `charsPerPage` has one entry per page in `document.pages`, zeros included. Kind: arbitrary.
- The recipe-hash cross-check vector is a constructed recipe hashed by core's `canonicalJson`, because the testkit golden stores only tagged `rc_` ids. Kind: arbitrary.

## 2026-10-18: store, eventlog, api, mcp review fixes
- Lock timeouts (SQLITE_BUSY, SQLITE_LOCKED) map to `KgError('upstream')`: no `unavailable` code exists, `conflict` is taken by key clashes, and `internal` means a bug; the caller may retry. Kind: arbitrary.
- `busy_timeout` is 5000 ms, set as an explicit pragma in `openDatabase` and the eventlog constructor. Kind: arbitrary.
- "Schema is current" means `db_meta.schema_version` equals core's `SCHEMA_VERSION`; then no DDL and no INSERT run, and `foreign_keys` is set per connection. Kind: arbitrary.
- A relation listing the same (nodeId, surface) twice is `invalid_input`; the same node with different surfaces stays allowed (the table key is item, node, surface). Kind: arbitrary.
- The multi-process test spawns children through the workspace `tsx`; the child script lives in `eventlog/test/support/`. Kind: arbitrary.
- Survivor tests live in each package's own test directory, not testkit conformance (testkit is not editable here). Kind: arbitrary.

## 2026-10-18: chunk, embed, search review fixes
- chunk: inline-group formula children are measured at placeholder length when the group fits in maxChars that way; a group that does not fit is split on its real text. Kind: arbitrary (the card was silent; keeps decoded and undecoded boundaries equal in the common case).
- chunk: the renderer finds an inline formula as a whitespace-delimited item scanning forward, and skips it when absent (a split group keeps all refs on every piece). A prose word equal to the formula earlier in the same group is taken for it. Kind: arbitrary, documented in the README.
- chunk: no recipe version bump, per the card (version '1' is provisional until the freeze). Goldens unchanged.
- embed: a context-length refusal is `upstream` (not `invalid_input`), as the review proposed. Kind: arbitrary.

## 2026-10-18: ingest and viewer review fixes
- ingest: recipes and space are written by an action on the `preparing` transition (after the embedder check) rather than by a pre-step, so a refusal still has its pipeline bracket; this changes the ingest topology pin. Kind: arbitrary.
- ingest: other documents' chunks are drawn again with the chunker from the version's artifact (the store exposes no per-version block refs). Kind: arbitrary; a store getter is the alternative.
- viewer: Host check allows `127.0.0.1`, `localhost` and `[::1]` with any port; POST /api/notes requires an absent or loopback Origin and `application/json`. Kind: arbitrary.

## 2026-10-18: eval review fixes
- Judge retry: the request is the original messages followed by every earlier malformed reply (assistant) and one fixed corrective user message (`RETRY_INSTRUCTION`), so each retry differs from the first and from the earlier ones. The constant is not in the prompt digest (the card says the digest covers prompt files). The same helper serves the generation machine. Kind: arbitrary.
- Judge logging: `RunDeps.judge` takes the run `ctx` as a fourth argument; `makeJudge(llm)` wraps the llm with `loggedLlm(llm, ctx)`. Kind: arbitrary (a wrapped Llm in the signature was the alternative).
- Run config and `eval.run.started` record `judge {recipeId(judgeRecipe()), model}` and `answerer {model, sha256 of answer.md}`. Kind: arbitrary (the answerer digest is over the answer prompt file only).
- `eval-run` bracket covers the whole run; the pipeline start tag names the build only if the store knows it. Kind: arbitrary.

## 2026-10-18: integration composition
- `packages/app/src/compose.ts` is the composition root; the parser is a `CachedParser` (artifact directory first, sidecar only when `sidecar` is set and the cache reports `not_found`). Kind: arbitrary (a parse package class for this is the alternative).
- The Ollama chat client lives in `packages/app/src/ollamaLlm.ts` (think off, 5 minute timeout, JSON format when asked), because no package owns an `Llm` adapter. Kind: arbitrary.
- `packages/app/tsconfig.json` sets `allowJs` because `@kg/viewer` re-exports a plain JavaScript module without declarations (see the integration change proposals). Kind: arbitrary.
- The integration database and run outputs are kept in `scratch/integration/` (the `.kg.sqlite` file is ignored by git). Kind: arbitrary.

## 2026-10-18: integration fixes
- `pipeline.finished.state` for a failed run is the last non-final state the pipeline kit saw; a refusal that happens in routing states before any work state (nothing observable) still reports `failed`. Kind: arbitrary.
- `generateQuestions` keeps its return type (the app script calls it); the dropped drafts and recipe id come from the new `generateQuestionsDetailed`. Kind: arbitrary.
- Session list order is by `startedAt` desc, ties by ID desc, plus no redraw while the pointer is over the list. Kind: arbitrary.
- Search tool `k` default is `DEFAULT_K = 10` in core api.ts. Kind: arbitrary.

## 2026-10-18: End-of-Sprint-1 triage (reviewer)
Basis: `design-feedback.md` (22 entries triaged, originals archived in `sprint-1/design-feedback-triaged-originals.md`), `sprint-1/proposed-amendments.md`, `open-questions.md`.
- Recorded after the fact (user decisions that had no log entry): machines for every pipeline, no pause/resume (plan `sprint-1/state-machine-revision.md`, Decided 1-3); this overrides the spike's recommendation to keep the runner for search and answers Q8 (no) and Q9 (moot). Formula handling in v0 as an optional parse stage plus an embedding view (Decided, section 13) answers Q6 as option (b) with an undecoded default. Q7 was carried out by the follow-up spike without a logged permission. Kind: user.
- Q10 (viewer fixture) was logged twice and open-questions had two entries numbered Q10; the judge-validation one is renumbered Q11. Kind: arbitrary.
- PROV: keep the SQLite model, do not adopt PROV natively, export PROV-JSON by hand only when a consumer exists (`prov-followup.md`). Kind: evidence-resolvable.
- Log size: record the failing state (done in `pipeline/src/run.ts`); delta-encode `considered` only if the Phase 4 run shows the size matters. Kind: evidence-resolvable.
- Flat heading levels are not improved for the baseline; empty headings are dropped (L2, skeleton reading); `pool < k` becomes a settings check. Kind: arbitrary.
- Judge acceptance thresholds (kappa >= 0.6 with bootstrap lower bound > 0.4, per-condition bias <= 0.15, no ref 0 / judge 1, at most 1 parse failure of 30) from `judge-validation/plan.md` are adopted as pre-registered before any scoring. Kind: evidence-resolvable.
