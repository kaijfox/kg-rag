# Design feedback

Open entries are at the top; triaged entries move to "Resolved". An entry is plain prose and says:
- what was observed, with evidence (numbers, a failing case, a file);
- which part of the design doc it bears on;
- what it might mean (scope that could grow, a useful capability, a choice that may cause trouble later, or something that does not work as specified);
- how sure the author is, and what would settle it.

## Open

(none; all 22 entries were triaged at the end of Sprint 1. Original texts, with their evidence, are kept in `scratch/sprint-1/design-feedback-triaged-originals.md`.)

## Resolved

Triage of 2026-10-18 (end of Sprint 1, reviewer). Entries are grouped. Outcome is adopt / defer / reject; Kind is arbitrary (A), evidence-resolvable (E) or needs the user (U). "Amendment AM-n" refers to `scratch/sprint-1/proposed-amendments.md` (drafts, not applied to `design/`); "Q n" to `scratch/open-questions.md`.

### T1. Search log size and the lost failing state
Entries: 2026-10-18 "the search log is large and cannot say where a failed search stopped"; 2026-10-17 "can the log alone diagnose a failed query?".
Evidence checked: the integration report agrees with the entry (28 KB of events per search, 3.3 MB database, log larger than the 312 vectors). `packages/pipeline/src/run.ts` now keeps `lastActive` and writes it as the failing state, so part (a) is fixed in code; I found no test that asserts it (add one). The earlier diagnosis entry stands: the log alone gave rank at every step, variants, and build; it could not give reasons for scores, which the item and build reads supply.
- (a) Record the work state that threw: adopt, done in code, add a test. Kind: E.
- (b) Delta-encode `considered` after the first step: defer until the Phase 4 baseline run shows the log size at real scale (the entry's own settling test). Cheap interim if it hurts earlier: let `truncate` log `considered` as a reference to the previous step's output. Kind: E. Does not change a rule: Rule 6 and item 3 require the information be recoverable, not stored twice. Revisit before the relation layer, which adds steps.
- Also from the integration report, `eventsBySearch` omits `tool.failed`, and `query` records no embedder: defect list in `change-proposals/integration.md`, engineering items, no design effect.

### T2. Formula decoding: speed solved, retrieval benefit not shown
Entries: 2026-10-18 formula-VLM spike; 2026-10-18 decoders compared by LLM-judged meaning; 2026-10-17 docling formula enrichment does not support MPS; 2026-10-17 docling slow and formulas poor; 2026-10-17 Kardar glyph names; 2026-10-18 arXiv-LaTeX Phase 4 idea.
Evidence checked: the numbers are consistent with the decision log (GLM-OCR 82% exact on 33 crops against a pre-set 90% rule; MRR 0.671 to 0.598; 312 to 440 chunks). The rule was fixed in advance on exact match, so the 94% meaning-judged rate (a later metric, n=33, one 9.7B judge, two decoders audited) does not retroactively pass it; it supports "good enough for a model to read" only. The spike met speed, missed accuracy, and did not show retrieval benefit.
- Formula decoding is an optional parse-recipe stage with a view setting in the embedding space (built in contract 0.6.0 after the user's decision recorded in `state-machine-revision.md`, section 13); the default recipe stays placeholder. Adopt as the standing arrangement; whether decoding becomes the default waits for Phase 4 evidence on formula-dependent questions. Kind: U (it touches the parse recipe and embedding concept; AM-2, Q13).
- MPS limit and CPU cost: closed by the spike (a GPU server is not needed for decoding speed). Kind: E.
- Glyph-name text in Kardar chunks: defer. Impact unmeasured; Sprint 2 prep measures the share of affected chunks (a script, minutes) and the retrieval misses they explain before any cleanup recipe is considered. A cleanup recipe changes chunk IDs, so if wanted it must precede the freeze. Kind: E.
- arXiv-with-LaTeX idea: adopt as a Phase 4 extension, first step is to look at the two papers and check the cited works are obtainable. Tagging formula questions and a decode-only-gold oracle are cheap and join the baseline plan. Using these papers as a second corpus is a scope question: Q15. Kind: U for the corpus, E for the check.

### T3. State machines, runner and loops
Entries: 2026-10-18 "explicit state machines: not worth it for search, rule met for ingest resume"; 2026-10-17 "decomposition and critique against the linear step contract".
Evidence checked: the spike's code size comparison (104 against 15 lines) and ingest crash-point results are in `spike-state-machine/results.md`. The spike recommended keeping the runner; the user then decided otherwise (machines everywhere, no pause/resume), recorded in `state-machine-revision.md` "Decided", and the code was built that way (contract 0.5.0, `@kg/pipeline`). The decision log had no entry for this decision; one is added by this triage.
- Machines for every pipeline: adopted by the user. Needs a design amendment: AM-1 (recipe = machine + version + settings + topology). Kind: U, already decided; the amendment waits for approval.
- Resumable ingest (Q8): resolved as "no" by the same decision (no snapshots). The spike's incidental finding on `revert` after a post-commit crash is moot but is already covered by the `build.created.revert` field. Kind: U, done.
- `repeat` and `fuse.from` patterns (Q9): moot; machines loop natively, decompose-fuse and critique-loop are not built in v0, and named pools (0.3.0) are the only provision. The linear-contract entry (decomposition cannot be expressed) is closed by pools plus machines; P-2(a)/(c) are dropped, not deferred. Caveat: loops and fan-out are the reason machines were chosen, and no machine in v0 uses one, so the claim is untested until query refinement is built.

### T4. Producer drift and recipe coverage
Entry: 2026-10-18 "input-addressed rows are first-writer-wins, so producer drift is silent".
Evidence checked: applied in contract 0.4.0 (`EmbeddingSpaceSpec.digest` required; `putDocVersion` compares the chunk list, invariant S-7 with a testkit case; chunk card says any output change bumps `version`). The drift itself was never observed. Outcome: adopt, done. Kind: E. Design text: AM-3 (Rule 4 reading and the space definition). Remaining gap: the same applies to every LLM named in a recipe (judge, answerer, generation): the digest is not recorded for them; fold into Sprint 2 prep (record the Ollama digest in the run record).

### T5. Chunker, IDs and heading structure
Entries: 2026-10-17 section-pack/1 vs HybridChunker (5a); chunk IDs under insertion and edit (5b); chunk IDs identical across two runs; changing the parse recipe changes chunk text; docling heading detection is flat; Phase 1 review findings L1-L8.
Evidence checked: 5a/5b outcomes are in the decision log and the oracle diff reproduces the package against the skeleton on the mini corpus and three real slices. Chunk test count went from 29 to 57, which suggests the freeze-critical boundary tests were added; the unit "survivors" list in the review should be re-run before the freeze.
- Keep TS chunker and ID scheme; parse recipe frozen together with the chunker before question generation: adopt, already in the roadmap (Phase 2) and decision log. Kind: E. The two sentence-cut and hard-cut divergences were resolved toward the skeleton reading; ids may still move until the freeze.
- Flat heading levels: reject for the baseline. Inferring levels from numbering changes IDs and has no measured benefit; revisit only if Phase 4 shows heading-related misses. Kind: A.
- L1 (greedy packing renumbers a section after an insertion): defer to the project-database use case; the Chunk concept's "unchanged content keeps its ID" holds for static corpora and across sections, as 5b measured. Kind: E.
- L2 (`[]` and `[""]` hash identically; the oracle diff found the package and skeleton differ on an empty heading): decide before the freeze, either reading is fine; adopt "empty headings are dropped" (skeleton). Kind: A.
- L3 (docKey defaults to file stem, a second `a/foo.pdf` replaces the first): defer, document; same-request duplicates are already `invalid_input`. L4 (`derivedItemId` throws): defer to the relation layer. L5 (`parseArtifactSchema` top level only): defer. L6 (`pool < k` returns fewer silently): adopt as a settings check in search (cheap). L7 (throwing `finish()` masks error) and L8 (identical-text duplicate counts as miss): adopt as one-line card notes. Kinds: A.

### T6. Embedding space
Entry: 2026-10-17 embeddinggemma through Ollama (5c).
Outcome: adopt (done). Conditioning stays in the space ID; model comparison only after the Phase 4 baseline (Q4, resolved). The numbers are a smoke test written by the author, so they are not baseline numbers. Kind: A under the user's cheap-option instruction.

### T7. Parsing: portability, cost, quality gate
Entries: remote parsing and portable parse artifacts; parse speed depends on the PDF and saved JSON round-trips; parser settings need a quality gate.
- Portable artifacts and import: adopt, done (decision log; `origin: imported`, `ArtifactDirParser`, `mixedRecipes`). Kind: U, decided.
- OCR off by default and the parse cache by (sha256, recipe): adopt, done. Kind: E.
- Quality gate with escalation: defer. All four PDFs have text layers; the sidecar already takes OCR as a per-recipe option, so the gate is new scope and no corpus needs it yet. Trigger: the first scanned or garbled input. Pilot (heuristic on four PDFs plus one scanned file) is the settling test. Kind: E; no scope change adopted.

### T8. Derived item IDs and nondeterministic producers
Entry: 2026-10-17 derived item IDs vs nondeterministic producers.
Outcome: defer to the relation-layer sprint. The PROV/Nix review (A1) sharpens the choice: ID is input-addressed, with the output text hash stored beside it as an output digest, so a rerun that differs is detectable. A draft sentence is in AM-7, marked hold. Nothing in v0 writes derived text items. Kind: U when it comes up (changes a core concept).

### Reading the groups together
Needing the user: T2 (default decoding, corpus scope), T3 (amendment AM-1), T4 (AM-3), T8 later. Everything else was arbitrary or settled by evidence and is logged in `scratch/decision-log.md`.
