> **Archived, 2026-11-06.** This describes the first build, which used seventeen packages, builds, recipes and snapshots. It was replaced by `design/architecture.md`. Kept as history; do not follow it for current work.

# v0 Implementation Roadmap

This plan implements v0 of the design in `260916_initial-roadmap.md`. The goal is a faithful implementation of that design. Implementation will likely turn up things that prove easier than expected, affordances worth including, and choices that cause trouble later. The workflow below gives those findings one route back into the design and scope.

Part 1 describes the workflow, which stays the same every sprint. Part 2 describes the sprints and phases and what each one produces and passes. Anything labelled *e.g.* illustrates scope and does not commit the project to a choice. The people and agents who carry out Phase 0 decide the architecture.

## Part 1: Workflow

### Principles

- **Contracts first, then fan-out.** Parallel agents work independently only to the extent that the interfaces between them allow. Time spent on module boundaries and interfaces pays back in every later phase.
- **Agents propose and leave boundaries in place.** Once the contracts are committed, implementers work inside them. When a contract proves wrong, the implementer files a change proposal and, where possible, keeps working against the current version.
- **Model matches task.** Implementers are Haiku or Sonnet, chosen per package card; reviews and mutation testing are done by a stronger model than the author. The lead session does design, prompt design and every review, and does small edits and drafts directly.
- **Stack: TypeScript.** Docling runs as a Python sidecar behind a parser interface. Phase 0 decides the other tool choices.

### The loop

Each sprint runs through **plan → build → review → retro → design feedback.**

- **Plan.** The sprint goal and work packages come from the design doc plus the accepted feedback from earlier sprints.
- **Build.** Agents work in parallel inside their contracts.
- **Review.** Each phase has its own review criteria (Part 2). The lead session reviews; the author of a package never reviews it.
- **Retro.** A short written look at how the sprint went. Each sprint lists its own guiding questions (Part 2). The common ones concern where agents got stuck or had to read sibling code, which contracts held, and which model assignments worked.
- **Design feedback.** The next section describes it.

### Design feedback

One mechanism handles everything that bears on the design, whichever phase or retro it comes from.

1. **Capture.** Anyone (any agent, in any phase) can add an entry to `scratch/design-feedback.md` at any time, in plain prose. The file's header states what a useful entry contains, so the agent writes what the reader needs and does not classify it:
   - what the agent observed, and the evidence (numbers, a failing case, a file);
   - which part of the design doc the observation bears on;
   - what it might mean: scope that could grow, a capability the project could use, a choice that may cause trouble later, or something that does not work as specified;
   - how sure the agent is, and what would settle the matter.

   The plan sets no cost or latency thresholds in advance. When an agent notices during testing that something runs slowly or uses much memory or money (*e.g.* brute-force similarity, extraction cost), it writes an entry with the numbers it observed. These observations trigger the design doc's Scale and Cost items.
2. **Triage.** At each retro, a reviewer agent reads the new entries, groups related ones, checks the evidence, and recommends for each one of three outcomes, with reasons: *adopt* (change the design or scope), *defer* (hold it for a later sprint), or *reject*. The reviewer triages an entry that reports a blocker right away. Triaged entries move to a resolved section, so the open part of the file stays short enough to scan.
3. **Decide.** The reviewer sorts each triaged entry as the Decisions and autonomy section describes. Adjustments within the committed design (*e.g.* a better tool) count as arbitrary or evidence-resolvable, and the reviewer decides and logs them. Anything that changes a core concept, a rule, or the v0 scope in the design doc goes to the user as an open question.
4. **Apply.** Adopted changes become dated amendments in the design doc, each citing its feedback entry. They feed the next sprint's plan.

The design doc thus remains the target, with a visible history of what changed and why.

### Decisions and autonomy

Agents make many choices while building, and reviews and retros surface more. The work needs rigor, but not every choice deserves deep exploration or the user's attention. Care must balance against complexity creep and against a stream of questions that the user has to answer. Building agents and review and retro triage alike sort each choice into one of three kinds.

- **Arbitrary.** Several reasonable options exist, and the work would reach a qualitatively similar result under any of them. The agent picks one, records a one-line rationale in `scratch/decision-log.md`, and moves on. No exploration is needed.
- **Consequential, resolvable by evidence.** The choice could measurably change what the project builds or concludes, and its correctness is not obvious, but a spike, a measurement or a close reading of the design doc can settle it. The agent or the reviewer runs the check, picks an option, and records the options considered, the evidence and the rationale.
- **Needs the user.** The choice turns on knowledge of how the system will be used, or on priorities that evidence cannot settle, or it changes a core concept, a rule, or the v0 scope in the design doc. Several reasonable options remain, and the difference between them lies in intent and not in correctness.

**Heuristic.** A choice is arbitrary when one sentence can explain why the result would not change qualitatively under a plausible alternative. A choice that fails this test is consequential. A consequential choice that evidence cannot settle needs the user.

**Handling a choice that needs the user.**
- The agent adds the choice to `scratch/open-questions.md`. The entry gives the question, the options, what each option implies for scope, cost and later layers, a recommendation, and what stays blocked until the user decides. The consistent shape serves the user, so that questions can be answered quickly.
- Work continues. When the work can be redone or discarded cheaply, the agent proceeds on the recommended option as a provisional default and marks the work as provisional, so that it can be found if the answer differs. When the work cannot proceed without an answer, the agent pauses only that work and carries on with the unblocked packages.
- The user receives open questions in batches at review and retro boundaries, not one by one. A blocking question reaches the user right away.
- Once the user answers, the decision enters the decision log. A decision that changes the design doc goes through design feedback.

**Escalation points.** Beyond open questions, the user takes part in:
- the Phase 0 architecture sign-off before fan-out;
- disputes in which reviewers disagree and the evidence does not resolve the matter;
- Phase 4 results that leave the first expansion ambiguous.

Review and retro apply the same sorting. A reviewer who checks a package's decisions confirms that the arbitrary choices were honestly arbitrary (the one-sentence test holds) and that the consequential ones show their evidence. The reviewer sends back decisions that received too little examination and notes those that received too much, so that effort goes elsewhere next time.

### Where things live

- `design/` holds the human-owned design documents: the design doc, this roadmap, and the amendments the user has accepted.
- `scratch/` holds everything the agents generate while running. The files split by purpose and stay short enough to scan. Each file opens with a header that states what an entry needs to say, in place of fixed entry types, and entries are plain prose.
  - `scratch/notes/<package or phase>.md` holds an implementer's working notes: what it did, what it assumed, what surprised it, and what it would flag for others. A reviewer or later agent looks here first for context.
  - `scratch/design-feedback.md`, `scratch/decision-log.md` and `scratch/open-questions.md` appear in the sections above.
  - `scratch/sprint-N/` holds the sprint's brief (one page covering the goal, the current state, what is provisional, what waits on the user, and links into the other files), the retro, and the review reports, spike results and change proposals. The reviewer keeps the brief current.
- Code, tests and package READMEs live in the packages they describe.

## Part 2: Sprints and Phases

| Sprint | Phases | Outcome |
|---|---|---|
| 0 | 0 Architecture, 1 Skeleton | Committed contracts, validated by a thin end-to-end slice |
| 1 | 2 Parallel build, 3 Integration | All v0 components working together, including the viewer |
| 2 | 4 Baseline measurement | Eval set, baseline numbers, pre-check data, choice of first expansion |

### Phase 0: Architecture and contracts

A strong model carries out this phase, working with the user. The goal is to commit to a module structure and to interfaces precise enough that implementers can work independently.

**Scope** (what the phase decides, not how):
- Module and package boundaries, and the allowed dependency directions.
- The core data model as machine-checkable types, covering the concepts and rules in the design doc.
- The interfaces between components, including how later layers (*e.g.* reranking, graph walk) could join without changes to existing components.
- The storage layout, including room for derived items, mappings and builds that v0 does not populate.
- The event catalog and the contract by which every interaction reaches the log.
- How components undergo testing in isolation (*e.g.* fakes, fixtures, conformance suites per interface).
- The form of the docling sidecar (*e.g.* docling-serve or a thin wrapper).
- The corpus for Phase 4. `test/corpa/stat-mech/` holds two topics (Foundations, Thermo), each covered by two authors (Kardar, Plischke) with largely overlapping content, and serves as the working candidate. Phase 0 decides whether it suffices for the baseline or whether a larger corpus is necessary.
- The Phase 2 work breakdown: the packages, their dependencies, and which ones suit low-cost models.

**Outputs:** design docs and decision records for each commitment, typed interface definitions, test fixtures, and the change-proposal process.

**Review criteria:**
- *Traceability:* each rule and v0 requirement in the design doc maps to a place in the architecture, and the review names any gap.
- *Extension walk-throughs:* the reviewer traces each planned layer (relation layer, graph walk, equivalence, reranking, community summaries) through the proposed structure and lists what would change. A need to modify existing interfaces counts as a finding to weigh, not as an automatic failure.
- *Independence:* for each proposed package, the reviewer judges whether an agent can implement it from the contract and tests alone, and which hidden coupling would force the agent to read a sibling's code.
- *Decision quality:* each decision falls into one of the three kinds (arbitrary, evidence-resolvable, needs the user). Consequential decisions state the alternatives considered, the evidence and the reason for the choice.
- *Feasibility:* a quick spike tests any choice that depends on an untested assumption (*e.g.* docling output chunking stably) before the choice becomes a commitment. Spike results go to design feedback. The stat-mech PDFs in `test/corpa/` serve as real input for these spikes (*e.g.* docling parse quality, chunk-ID stability on re-ingest).

**Retro questions:** The retro considers whether the assumptions the architecture rests on held, and whether anything proved easier or harder than the design doc implied.

### Phase 1: Walking skeleton

One agent wires stub or fake implementations end to end, from ingest through search, logging, an MCP call and a viewer read. The skeleton tests whether the contracts compose. A phase-1 fix to an interface costs little, while the same fix in Phase 2 costs much more.

**Outputs:** a running skeleton, and a list of contract revisions that land before fan-out.

**Review criteria:**
- Types compile, fakes pass the conformance tests, and the fixtures carry meaning and do not pass trivially.
- The reviewer traces non-trivial logic (*e.g.* ID derivation, search step logging) by hand against the design doc's invariants, using worked examples.
- The skeleton runs end to end, and the reviewer inspects its log to judge whether the log alone can diagnose a failed query.
- Each contract revision states the evidence, the packages and tests it affects, and the in-flight work it invalidates. Revisions arrive in batches unless one blocks progress.

**Retro questions:** The retro considers which contracts needed changes, and what those changes reveal about how well the team understood the problem.

### Phase 2: Parallel build

Each work package has:
- an owned directory and a stated contract;
- tests it must pass, which Phase 0 or 1 wrote and not the implementer;
- no write access outside its package;
- a short README that states assumptions and known gaps.

The illustrative packages are ingest and parsing, chunking, embedding, store, event log, search, MCP tool layer, eval harness and session viewer. Phase 0 sets the real list.

The eval harness builds against fixtures until real ingest and search exist. The chunker freezes before eval question generation in Phase 4, because chunking changes invalidate the eval set.

**Formula-recognition spike.** One agent runs a spike alongside the package builds to find out whether a formula or VLM model runs on Apple GPU (MPS or MLX) with enough accuracy and speed to decode the corpus's formulas locally. The decision rule is fixed in advance: it is worth adopting if it decodes the full corpus in about 30 minutes or less, at about 90% or better normalized exact match on a hand-checked gold set, with no harm in a small retrieval pilot. The spike has to finish before the chunker freezes, because decoded formulas change chunk text and so chunk IDs. Plan: `scratch/sprint-1/spike-formula-vlm.md`.

**Review criteria:**
- *Mechanical:* tests pass, types check, and the package contains all of its own edits.
- *Contract:* a reviewer reads the diff against the contract for behavior beyond the spec, silent deviations, and undocumented assumptions.
- *Design rules:* where relevant, the reviewer audits the six rules in the design doc (*e.g.* whether every derived item cites source chunks, and whether any item undergoes editing or deletion instead of mapping).
- *Eval design:* the reviewer samples the generated questions and reads them for leakage of passage wording, answerability from the gold evidence, and correct type tags. The reviewer validates the judging procedure against a sample scored independently by a stronger model than the judge (about 30 answers, limits stated) before anyone trusts its numbers.
- *Spike:* the reviewer checks the formula spike's gold set, and confirms the recommendation follows from the numbers against the pre-set rule.

**Retro questions:** The retro considers where agents had to read sibling code or request contract changes, and which packages the low-cost models handled well or badly.

### Phase 3: Integration

The packages merge, and the full test suites run against real implementations in place of fakes.

**Review criteria:**
- End-to-end tests run on a real document set, and the reviewer inspects the results and does not stop at green.
- Cross-package review looks for duplicated logic, divergent interpretations of a contract, and gaps in the log.
- The reviewer checks the viewer against a live session and a finished one.

**Retro questions:** The retro considers what integration surfaced that package-level tests could not, and whether v0 forms a sound base for the relation layer.

### Phase 4: Baseline measurement

The phase ingests a real corpus, generates and pins the eval set, runs recall@k and the three answer-quality conditions, and computes the pre-check measurements in the design doc's failure-mode table. The paired-author stat-mech documents allow both own-corpus questions and cross-corpus ones, with questions written from one author's text and answered against the other's index. The baseline uses the undecoded parse recipe (formulas as placeholders). A second build on a decoded-formula parse recipe, run against the same questions where chunk IDs allow and with regenerated questions otherwise, is a required follow-up to the baseline and not optional; its scope is set after the baseline and uses the arXiv corpora's LaTeX references to measure decoding accuracy. The output is the evidence for choosing the first expansion.

**Review criteria:**
- The reviewer re-validates the eval set and the judge on the real corpus, as in Phase 2.
- Anyone can reproduce the reported numbers from the pinned eval set and build.
- The recommendation follows from the pre-check data and states any remaining ambiguity.

**Retro questions:** The retro considers whether the measurements matched expectations, and whether the data agrees with the prioritization in the design doc.
