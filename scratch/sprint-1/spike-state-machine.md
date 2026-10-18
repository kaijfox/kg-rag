# Spike: explicit state machines (XState v5) for search and ingest (Sprint 1, before the search and ingest packages are built)

Proposed 2026-10-18 by the user. Owner: one agent on a strong model (the question is architectural; the answer may change a core contract). Works in `scratch/sprint-1/spike-state-machine/` and `scratch/notes/spike-state-machine.md`. Touches no package and does not change `core`. Must conclude before the `search` and `ingest` packages are handed to implementers.

## Why
The roadmap's search is a recipe-driven pipeline: a recipe lists steps, a runner passes a small state (queries, ranked candidate list, `done`) through them, and each step is logged. Ingest is a fixed sequence of stages per document. Both are mostly linear state machines. The user's hypothesis: writing them as explicit machines (actors, typed state, logged transitions) would clarify how state moves, make iteration (critique loops, decomposition) natural, and give resumable ingest. Counter-concerns: the design keeps recipes as data so a recipe can reorder steps without code changes; existing logging (runTool, envelope fields, Rule 6 build tagging, `AsyncLocalStorage` nesting from R-27) may not compose with an actor system; a library adds a dependency to `core`-adjacent code. This is a consequential choice that evidence can settle (roadmap: decisions and autonomy).

## Question
Does expressing search and ingest as XState v5 machines make the system simpler and clearer than the current step-runner design, without breaking logging, recipe identity, or modularity? If yes, in what form: a machine per pipeline kind in code with settings as data, or something else?

## Method
Work from the hidden skeleton (`packages/app/src/skeleton`) and the contracts in `core` 0.2.0 as a read-only baseline. Do not edit them.

1. **Search as a machine.** Re-express the skeleton's `vector-knn` + final truncation search as a machine. Then express the two examples from `scratch/sprint-0/pipeline-recipes.md`: (a) decomposition with per-subquery pools and fusion (assume P-1 named pools as adopted), and (b) the critique loop as a real bounded loop with a guard, not unrolled. Steps stay plain state-in/state-out functions invoked as actors.
2. **Logging.** Show that every `search.step` event (candidates considered, ranks, scores, step recipe, build tag, search ID) can be emitted from the machine, and that nested tool calls still link (R-27, `AsyncLocalStorage` through actor scheduling and invoked promises). State plainly if context is lost anywhere. Compare with how the current runner logs: where does logging live in each design, and which is harder to forget?
3. **Recipe identity.** Define a recipe as machine name + version + settings. Check that the recipe hash is stable and that changing a setting or the machine version changes it. Show what would catch a machine whose behaviour changed without a version bump (golden test, conformance run).
4. **Modularity.** Add a new step (e.g. a reranker) to a pipeline in both designs. Count the files and lines touched, and say what a step implementer must know about the library.
5. **Ingest as per-document actors.** Sketch stages (identified, parsed | cached | imported, chunked, embedded, built, committed) with persisted snapshots; interrupt mid-ingest and resume. Check that snapshots are JSON-serializable, that the events stay compatible with `ingest.*` in the catalog, and whether the R-24 rule (no build with unembedded items) becomes a machine guard.
6. **Size and cost.** Lines of code for the machine design vs the skeleton runner for the same behaviours, added dependency size, and the learning burden for a cheap model implementing a step from its card.

## Decision rule (set now)
Adopt for search if all hold: logging and nesting work unchanged; recipe identity is at least as strong as today; adding a step costs about the same as today; and the machine definition is shorter or clearly easier to read than the runner plus the unrolled-loop workaround. Adopt for ingest if resumable per-document stages work with persisted snapshots and the event catalog is unchanged. Search and ingest are judged separately. Anything that requires changing a contract in `core` is reported as a contract-revision proposal with affected packages and tests; the user decides.

## Output
- `scratch/sprint-1/spike-state-machine/results.md`: the findings per method step above, with code snippets and numbers, and a recommendation for each of search and ingest (adopt, adopt in modified form, or keep current).
- A design-feedback entry, and decision-log entries for cheap choices. Contract changes go to `contract-revisions.md` as proposals; changes to the design doc go to `open-questions.md`.

## Constraints
- XState v5 is the named candidate; the agent may also check one lighter library (e.g. robot3) and must verify current versions and APIs from documentation, not memory. Keep new dependencies out of `core` during the spike.
- The spike is allowed to conclude "keep the current design". That is a result.
- Does not block any package except `search` and `ingest`.
