# Sprint 3 retro review: brief

**Goal:** a whole-codebase architectural and conceptual review, followed by a retro. It answers three things: what turned out harder than the design doc implied; where we built things that a dependency would do more robustly, or that need engineering concepts we could drop; and whether the overall concept should change to keep the tool simple but usable.

**Status:** started 2026-10-28. Read-only review. No code, design-doc, or contract edits in this sprint.

## Scope

The whole codebase, including the eval harness and viewer, which have not had an architectural review. Vendored code (`packages/viewer/vendor/`) and the Python sidecar's `.venv` are out of scope for reading, but their dependency choices are in scope.

## Inputs (every reviewer reads these first)

- `design/260916_initial-roadmap.md` (the design, including amendments) and `design/261017_v0-implementation-roadmap.md`.
- `scratch/sprint-0/brief.md`, `scratch/sprint-1/brief.md`, `scratch/sprint-2/brief.md`, and the retros in `sprint-0/retro.md` and `sprint-1/retro.md`.
- `scratch/decision-log.md`, `scratch/open-questions.md`, `scratch/design-feedback.md`.
- `scratch/notes/` (implementers' working notes, which say what they assumed and what surprised them).
- `scratch/sprint-3/dependency-inventory.md` (snapshot, not maintained).

## Split by what each reviewer reads

Each reviewer applies every lens below to their own slice. Each reads the source and the package cards for their packages, and the tests that pin those packages.

- **Reviewer A: data and contracts.** `packages/core`, `packages/store`, `packages/eventlog`, `packages/api`, plus `design/`, `scratch/sprint-0/architecture-proposal.md` and `scratch/sprint-1/contract-0.6.1.md`.
- **Reviewer B: processing.** `packages/parse`, `packages/parse-sidecar/src`, `packages/chunk`, `packages/ingest`, `packages/embed`, `packages/search`, `packages/pipeline`, `packages/eval`.
- **Reviewer C: surfaces and tooling.** `packages/mcp`, `packages/viewer` (`src` and `web`, not `vendor`), `packages/app`, `packages/testkit`, plus the root configuration (`package.json`, `.dependency-cruiser.cjs`, `tsconfig.base.json`).

## Lenses (each reviewer applies all of them)

1. **Traceability and rules.** Does the code still satisfy the six rules and the v0 requirements? Name anything built but unused, and anything specified but missing.
2. **Simplicity and concepts.** List each engineering concept a user or implementer must hold to use this area (for example, recipes, fingerprints, mappings, state machine topology, PROV-style lineage). For each, say whether it is needed now, needed later, or only exists to serve a concept that is not yet used. Propose what could be dropped or deferred, and what the smallest working version looks like.
3. **Hand-rolled versus depended-on.** For each substantial piece of own code (for example the chunker, the ID derivation, the sqlite schema migration if any, the event log, the viewer's renderer, the eval metrics and judge plumbing, the MCP wiring), say whether a maintained library or standard tool does the job. Give the candidate, what it would replace, and what it would cost (a dependency, lost control, a migration). Do not recommend a dependency that adds a concept the tool does not need.
4. **Friction.** Where did the process itself slow the work: tests that are hard to run, interfaces that forced workarounds, and the review loop (mutation rounds, judge validation, question review)? Cite the evidence.
5. **Things that were harder than the design doc implied.** Check the claims in the sprint briefs and retros against the code and the records. Do not rely on memory of the sprints.

## Method

- Every finding cites a file and line, or a record in `scratch/`, or a number from a run.
- Mark each finding as one of the three kinds in the workflow: **arbitrary** (one sentence says the result would not change under a plausible alternative), **consequential and resolvable by evidence** (say what check settles it, and run it if cheap), or **needs the user** (it changes a core concept, a rule, or the v0 scope).
- Do not edit `design/`. Do not edit code. Write only to your own report file.
- Use the plain-language line (below) for every finding. The lead will report back to stakeholders from these lines, so they must be intelligible to someone who has skimmed the design doc and knows what the tool is for, but not how it works inside.

## Output

Each reviewer writes one report: `scratch/sprint-3/review/<reviewer-letter>-<area>.md`, with:

- A short summary (under 150 words).
- Findings, most severe first. Each has: **Finding** (one sentence), **Where** (file or record), **Evidence**, **Lens**, **Kind** (arbitrary / evidence-resolvable / needs the user), **Proposed direction** (one to three sentences), and **Plain-language line** (what a user of the tool would notice, or what it would cost them, in terms of what they want to do with it).
- A list of the concepts in the area, with their status (needed now / needed later / unused), which feeds the concept count.
- A list of hand-rolled pieces with the candidate replacement, or "none found".
- A list of anything that surprised you, even if it is not a finding.

The lead then merges the three reports, triages them into design feedback and open questions, and writes the retro and the stakeholder summary.

## Questions the review must answer

1. What was harder than the design doc implied, and was the difficulty in the concept, the tooling, or the process?
2. Which engineering concepts in the design are load-bearing for the first expansion, and which could be dropped or deferred without losing a rule?
3. Which hand-rolled pieces should be replaced by a dependency, and which dependencies should be removed in favour of a simpler own solution?
4. Is the overall shape (chunks, items, relations, builds, mappings, event log, state machines) the right size for a tool meant to be simple but usable? What is the smallest version that satisfies the rules?
5. What in the eval harness and viewer has never been reviewed, and what does it reveal?

## Not in this sprint

Implementing any change. Changing the design doc. Building the decoded-formula build (Q13 follow-up) or the Q15 arXiv corpus. Those wait for Q16 and Q17, and the outcome of this review may change them.
