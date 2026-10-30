# Sprint 4 brief (plan, not started): re-cut v0 as a module base

Status: proposed 2026-10-30, awaiting the user's approval of Phase 0. Nothing here is applied to `design/`, code or contracts.

**Goal.** Make "add a module, then wire modules into a state machine" the way a new use case or a new kind of request is built, instead of editing or forking pipeline code. Inputs: `scratch/sprint-3/nano-graphrag-comparison.md` (the reframe and the module sketch), the three reviews in `scratch/sprint-3/review/`, `scratch/sprint-3/proposed-amendments.md`, and the decision of 2026-10-30 (graph algorithms are modules over a read-only graph view).

**What does not change.** The six rules. The frozen chunker and chunk ids (the pinned eval sets stay valid). SQLite plus sqlite-vec, local Ollama. XState stays as the way machines are written (the 2026-10-18 decision); what changes is what the states call. This sprint builds no new retrieval layer; it makes the first one cheap to add.

**Definition of done (measurable).**
1. Baseline parity: search on the frozen Kardar and Plischke databases returns the same ranked chunk ids as before for the 63 pinned questions, and recall@k is identical.
2. Trace parity: the step events a runner-derived trace produces match the hand-built ones recorded in the baseline logs (ranks and candidates identical).
3. Zero-kernel-change test: a project-history use case (adapter, segmenter, rule-based supersession resolver, "current state" request machine) runs end to end on this repo's `scratch/decision-log.md`, with no edits to kernel packages. Count kernel files touched and report.
4. Cost of a module is measured for each new module (lines, files touched) and compared with the sprint 3 numbers.
5. The rules audit (the SQL audits from sprint 3) is clean on every database made this sprint.

## Phases

### Phase 0: Decide and close sprint 3 (lead, with the user; no agents)
- Commit the sprint 3 working tree (80 changed files, including the CLI and the shared SQLite package) once the user says so; start this sprint from a clean state.
- User decides: AM-9 to AM-13 (already drafted); the seam shape (named functions with `{name, version, settings}` recipes; topology pins replaced by a load-time check of declared reads and writes); the module descriptor; whether to run this sprint before the first-expansion decision (see risks).
- Lead drafts the amendment text for the module concept, the descriptor, and the machine amendment edit; the user approves before `design/` is edited.
- Gate: no Phase 1 contract work before approval.

### Phase 1: Module contract and spike (lead, strong model)
- Types in core: module descriptor (name, version, kind, settings, declared reads and writes, local or set scope), slot vocabulary (queries, candidates, seeds, pools, notes, drafts), module environment, derive and resolve draft types with kernel-assigned ids and refusal of empty source lists, and the read-only graph view (`relationsOfNode`, `nodesOfRelation`, `itemsBySourceChunk`).
- Runner change: derive each search step's trace from the state before and after; a module supplies only what the diff cannot show.
- Load-time wiring check; remove the hand-pinned fingerprint (keep a derived one in the recipe so Rule 4 still identifies exactly what changed).
- Spike: port `vectorKnn` and `truncate` and run the Kardar baseline questions. Compare against the stored baseline logs (done-criteria 1 and 2). If parity fails, the contract is wrong; fix it before fan-out.
- Output: contract version bump, one conformance suite per module kind, a change-proposal list. Review by a separate strong-model reviewer.

### Phase 2: Parallel re-cut (Sonnet or Haiku per package card; lead writes the cards)
| Work package | Content | Model |
|---|---|---|
| A. Search modules | Move search steps onto the descriptor; delete `pins.json` for search; machine loads validate wiring | Sonnet |
| B. Derive and resolve | Interfaces plus the relation extractor from the pilot as the first derive module (fake model for tests, no quality work); kernel writes items, sources, mappings | Sonnet |
| C. Graph view | The three reads on the store; conformance test; no algorithm yet | Haiku |
| D. Registry and database config | Name registry in code; a config file names the ingest adapter, build machine and request machines for a database; request machines become MCP tools; `./kg` reads it | Sonnet |
| E. Ceremony cuts from the reviews | Only items that touch what A to D touch: one side of each type generated from the other (core types and zod), the dead search-state fields, stale package cards | Haiku |

Deferred to a later sprint on purpose: moving ingest and eval onto the descriptor (wait for a second implementation), package consolidation (15 packages to about 4; revisit after the contract settles because the import rule and testkit depend on it), formula decoding clean-up.
Each package: owned directory, tests written before the build, no writes outside it, README of assumptions.

### Phase 3: Prove it with a second use case (lead, small agents)
- Project-history adapter: reads `scratch/decision-log.md` and the dated amendments as documents, one chunk per decision entry.
- Rule-based resolver: records supersession mappings from the "supersedes" and "replaces" wording and dates (no model, so it is cheap and exact).
- Request machine `current_state`: KNN over relations or chunks, follow supersession mappings, keep the newest, expand to source chunks, cut.
- Fixture questions: about 10 hand-written ones ("what is the store?", "is the replay cache in place?") with known answers from the log's own history. Not a quality claim; it tests that the seams hold.
- Report: kernel files touched (target zero), lines per module, anything the descriptor could not express.

### Phase 4: Review and retro
- Reviewers read the diff against the contract; audit the six rules by SQL on the baseline databases and the new project-history database; check parity (done-criteria 1 and 2); read the Phase 3 report critically.
- Retro questions: did the descriptor survive the second use case? which fields were never used? where did an agent have to read a sibling module? did runner-derived traces lose anything the old traces had? is the derived fingerprint enough for Rule 4?
- Design feedback entries for anything that bears on the design; amendments go to the user.

## Decisions that need the user
1. Approve the module concept, descriptor and machine amendment (sprint 3 questions 1 and 5), and AM-9 to AM-13.
2. Sequencing against the first-expansion decision (Q17) and the stronger question generator (Q16). Recommendation: run this sprint first. The relation layer needs a derive interface and a graph view that do not exist yet, and the next expansion becomes cheaper afterwards. Cost: one sprint before any retrieval gain.
3. Commit of the sprint 3 state.

## Risks
- Shared state typed across very different modules is the hard part. Mitigation: a small slot vocabulary; add slots only when a second module needs one.
- Search-recipe ids change when the recipe shape changes, so builds get new ids. Chunk ids do not, and eval is pinned to chunk ids. Mitigation: confirm in the Phase 1 spike and record it in the decision log.
- Over-generalising. Mitigation: no plugin discovery, a registry in code only, and Phase 3 as the measure.
- Runner-derived traces could drop detail the diagnosis needs. Mitigation: trace parity against the logged baseline.
- Churn: contract changes invalidate in-flight work. Mitigation: contract first and reviewed before fan-out, as in sprint 0.

## Models and cost
Lead (this session) does Phases 0, 1, 3 and every review. Implementers are Sonnet or Haiku per card. All model calls in tests use fakes; Phase 3 needs no model. No new heavy computation (no re-extraction, no new eval runs beyond re-reading the stored baselines).

## Files
`scratch/sprint-4/` holds this brief, the Phase 1 contract and spike notes, review reports and the Phase 3 report. Decisions go to `scratch/decision-log.md`, open items to `scratch/open-questions.md`.
