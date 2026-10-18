# Proposed design amendments (drafts, not applied)

Written 2026-10-18 at the end of Sprint 1. Nothing in `design/` has been edited. Each draft follows the form of the Amendments block at the end of `design/260916_initial-roadmap.md` (dated bold title, citation, text) and names where it would go. The four amendments already approved by the user (builds in v0, logging in the tool contract, Rule 4 for chunks, definition of "current ingest") are recorded there and are not repeated. Approve, edit or reject each; open question Q12 asks for the answer.

Which Sprint 1 decisions needed an amendment, and which did not:
- Need one: state machines as pipeline structure (AM-1), formulas in v0 (AM-2), producer digests and the Rule 4 reading (AM-3), run records of judge and answerer recipes (AM-4), pointer moves as events (AM-5), the settled stack (AM-6).
- Hold for a later sprint: derived item identity (AM-7).
- Roadmap wording (human-owned file): AM-8.
- No amendment needed: P-1 named pools (an interface detail inside "Query refinement"); mapping kinds renamed `superseded-by` and `refined-by` (the design names no kinds); Q10 viewer fixture; chunk length rule wording; Mermaid vendoring; lock-timeout error mapping; `build.created.revert` (an event field inside the Builds amendment).

---

**AM-1 · 2026-10-18. Pipelines are explicit state machines; a recipe names its machine.** (design-feedback "explicit state machines" and "decomposition and critique against the linear step contract"; decision log 2026-10-18; `scratch/sprint-1/state-machine-revision.md`)
Placement: Core Concepts, "Recipe and build", after the first sentence; v0 item 3 gets the last sentence.
Text: Every multi-step process (search, ingest, an evaluation run, question generation, judging) is an explicit state machine, written in code, one machine per kind. Each state does one piece of work by calling an ordinary module; the machine only orders the work and chooses the route. A recipe for such a process is the machine's name, its version, its typed settings, and a fingerprint of its topology (states and allowed moves, so editing the wiring without a version bump is refused). Changing the shape of a process means a new machine or version; tuning means changing settings. Loops (for example a critique pass that retrieves again) are moves back to an earlier state and need no special construct. Each run logs `pipeline.started` and `pipeline.finished` and each search step logs the state it came from, so a logged run maps back onto the machine and can be drawn. v0 contains one search machine (similarity); decomposition and critique are Planned Layers and are not built.
Implication: "Search ... records what each step considered and ranked" is unchanged. The Tentative Defaults sentence on technology is replaced by AM-6.

**AM-2 · 2026-10-18. Formula handling in v0: an optional decoding stage and an embedding view.** (design-feedback "formula decoding on the Apple GPU", "formula decoders compared by LLM-judged meaning", "Kardar PDFs' text layer turns inline math into glyph names"; decision log 2026-10-18; contract 0.6.0)
Placement: v0 item 1, and Core Concepts "Embeddings".
Text: A parse recipe may include a formula-decoding stage that replaces the formula placeholders docling leaves with LaTeX, recorded in the recipe. The default recipe has none; whether decoding becomes the default is decided from the evaluation on formula-dependent questions. A chunk stores its text as parsed. The text actually embedded is a view of the chunk, and the view setting (`placeholder`: formulas as `[formula]`, or `full`) is part of the embedding space, so spaces differ by view as they differ by templates. Chunk boundaries are measured with formulas at placeholder length, so a decoded and an undecoded parse of the same document cut at the same places. Because the stored text differs, a decoded parse produces new chunk IDs and invalidates eval questions on those documents; the parse recipe is therefore chosen before the chunker freeze.

**AM-3 · 2026-10-18. Every producer a recipe depends on is pinned or guarded.** (design-feedback "input-addressed rows are first-writer-wins"; `scratch/sprint-1/prov-review.md` A1, A2, A3; contract 0.4.0)
Placement: Rule 4 reading; Core Concepts "Embeddings".
Text: Rule 4 requires a recipe to identify exactly what to regenerate, so a recipe covers everything that changes its output. An embedding space records the model's digest, not only its tag, and checks it when embedding. A chunk recipe's `version` is bumped on any change to the chunker's output. Immutable rows are guarded: writing a document version that exists under a different chunk list is an `immutable_violation`. Terms used in the documentation: content-addressed (the ID hashes the output: chunks, builds), input-addressed (the ID hashes recipe and inputs: parse artifacts, document versions), derivation (a recipe applied to specific inputs), plan (the recipe), early cutoff (unchanged output stops downstream work).

**AM-4 · 2026-10-18. Evaluation runs record their judge and answerer.** (`scratch/sprint-1/review-ingest-eval-viewer.md` should-fix 2; contract 0.6.1)
Placement: v0 item 6, after "A fixed judging procedure scores answers against the reference."
Text: A score is a derived record, so Rule 4 applies to it. Each evaluation run records the judge's recipe (prompt digest, model) and the answerer's model and prompt digest, in the run record and in the run's first event. Every judge and answerer model call goes through the logged model wrapper. Before any evaluation number is reported, the judge is validated on a sample of about 30 answers scored independently by a stronger model than the judge, and the agreement is reported with the numbers (plan: `scratch/sprint-1/judge-validation/plan.md`). The agreement measures the judge against a model, not a person.

**AM-5 · 2026-10-18. Pointer moves are events; build lineage lives in the log.** (`scratch/sprint-1/prov-review.md` A5, A6; `scratch/sprint-1/lifecycle.md` section 4; contract 0.4.0)
Placement: addendum to the "Builds are part of v0" amendment.
Text: The two mutable rows in the store (a document's current version and the current build) change only through events that carry the old and the new value (`ingest.completed.previousDocVersionId`, `build.created.parentId`, and `revert` when an ingest returns to an existing build). A build's stored parent is the first one seen; because a build is identified by its content, the history of how the database reached it is read from the log, not from the stored parent.

**AM-6 · 2026-10-18. Stack settled.** (decision log 2026-10-17, "Store is better-sqlite3 + sqlite-vec", "tooling versions", "Embeddings come from a local Ollama model", Q3; roadmap Principles)
Placement: replaces Tentative Defaults.
Text: TypeScript throughout, with docling run in a Python sidecar behind a parser interface that also accepts parse artifacts produced elsewhere. One SQLite file per database holds chunks, embeddings (sqlite-vec), builds and the event log. Embeddings and every model call (question generation, answering, judging) use local Ollama models for now; the model client is provider-neutral and results are cached for replay. The viewer is a static page served locally. These remain open to change under Scale and Cost.

**AM-7 · 2026-10-18. (Hold for the relation-layer sprint) Derived item identity.** (design-feedback "derived item IDs vs nondeterministic producers"; `scratch/sprint-1/prov-review.md` A1)
Placement: Core Concepts "Recipe and build", the sentence on derived item IDs.
Text: A derived item's ID derives from its recipe, its input chunk IDs and its index among the producer's outputs. The hash of the item's text is stored beside the ID as its output digest. A rerun of a nondeterministic producer with the same recipe and inputs yields an item with the same ID and a different digest; this is reported and not merged, and a deliberate resample needs a recipe bump. Not for approval now: v0 writes no derived text items.

**AM-8 · Roadmap note (human-owned file, for the user to apply or ignore). Model assignment and judge validation wording.** (`brief.md` Sprint 1 decisions; retro)
Placement: roadmap Principles, "Model matches task", and Phase 2 "Eval design".
Text: replace "All sub-agents run on Haiku" with the rule actually used: implementers are Haiku or Sonnet, chosen per package card; reviews and mutation testing are done by a stronger model than the author; and replace "hand-scored examples" with "a sample scored independently by a stronger model than the judge, with the limits stated".
