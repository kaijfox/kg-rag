# Change proposals from @kg/ingest (WP7)

## 1. Work states that emit no catalog event cannot pass machineMapConformance

The card lists states that do work but emit no event: `preparing` (recipes and space), `parsing` (parser call), `decoding`
(formula decoder), and `committing` (the store transaction). `machineMapConformance` (testkit) requires every work node to
declare a non-empty `logs`, and the catalog has no event for these steps. The card's own state list therefore cannot pass
the suite it names.

What was done: `preparing` is a routing state with a pure guard (embedder model and dims against the space); recipes and
space are written by the service before the machine runs. Parsing and decoding declare `ingest.parsed` and emit it when the
artifact is final (parsing does not emit when decoding follows; decoding emits). `committing` carries the commit and the
announcements (`ingest.completed`, `build.created`), so `announcing` is not a separate state.

Proposed fix (choose one):
(a) Allow a work node with an empty `logs` when its step emits no event, in machineMapConformance and in the card text.
(b) Add a catalog event for preparation (for example `ingest.prepared`) so the state logs something.
Recommendation: (a), because the event log should not gain events only to satisfy a drawing rule.

## 2. machineLogConformance cannot be applied to ingest or eval

`machineLogConformance` (testkit) requires `search.step` events in the run and checks each one's `trace.state` against the
map. Ingest and the eval machines emit no `search.step`, so the suite fails on an empty run. The card asks for it on ingest.

Proposed fix (testkit): generalize the suite so that every event a run emits is declared by a work node's `logs`, with the
`search.step` check kept for search. Until then the ingest package checks the declared logs in its own test
(`test/machine.test.ts`, "every event a run emits is declared by some work state").

## 3. testkit IngestDeps lacks chunkView (contract 0.6.0)

Core 0.6.0 makes `chunkView` an injected collaborator of ingest, but `packages/testkit/src/conformance/ingest.ts` builds the
service with `{ store, parser, chunker, embedder, config, clock, ids }` only. The scenario call `createIngest(d)` therefore
compiles only with `chunkView` optional. Proposed fix (testkit): add `chunkView` to `IngestDeps` and pass `fixtureChunkView`
(an identity view for the mini corpus, which has no formulas), so the wiring the production code uses is the one the suite
checks. The package makes `chunkView` optional for now and says so in its README.

## 4. Eval card names `ingest.started` parse recipe semantics (note only)

The card does not say which parse recipe `ingest.started.parseRecipeId` names when formula decoding is on. The package uses
the plain recipe (the one the parse cache is keyed by). A one-line note in core's `ingest.started` description would settle it.
