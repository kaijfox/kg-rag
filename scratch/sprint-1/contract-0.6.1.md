# Contract 0.6.1 (core + testkit wave)

`scratch/sprint-0/contract-revisions.md` is the Phase 1 log and has no entries for 0.5/0.6, so the 0.6.1 revision is recorded here (design/ untouched).

## Revision
- core text: `ingest.started.parseRecipeId` is the plain parse recipe the cache is keyed by (also for imports and for decoding runs). `pipeline.finished.state` may name a work state that logged no step.
- core additive: `eval.run.started` gains optional `judge: {recipeId, model}` and `answerer: {model, promptDigest}` (schemas `evalJudgeSchema`, `evalAnswererSchema` in schemas.ts; types `EvalJudgeInfo`, `EvalAnswererInfo`, `EvalRunConfig` in evalTool.ts). Optional to parse, always written; the same two objects go under the same keys into `EvalRunRecord.config`. No id changes (golden ids.json unchanged; the JSON schema files cover parse artifacts/recipes only, so unchanged).
- core: `recipesEqual(a, b)` in ids.ts (canonicalJson equality).
- testkit: `machineLogConformance(map, events, { steps })` (default true) with a new case "every non-envelope event type is declared in the logs of some work node". Envelope types excluded: `session.*`, `tool.*`, `pipeline.*`, `query`, and also `search.result` (written by the service after `pipeline.finished`, no state owns it; a small addition to the list in the task). `machineMapConformance` unchanged (work nodes still need logs).
- testkit: `IngestDeps.chunkView` required; scenario "embedded texts pass through chunkView" (renders == embedded texts, none for unchanged chunks). Broken variant: `EagerIngestService(d)` ignores the view (`new EagerIngestService(d, true)` applies it).
- testkit: `evalRunnerConformance` checks relative order (`expectEvalRunOrder`, exported) for bracketed and plain shapes; a new Rule 4 case requires `judge` and `answerer` on `eval.run.started` and equal values in `repo.getRun(runId).config`. Fixtures: `session-eval.jsonl` run.started line carries `REFERENCE_JUDGE`/`REFERENCE_ANSWERER` (src/fixtures.ts).
- Version stamps: CONTRACT_VERSION, core package.json and README, `CONTRACT_VERSION` line of every package CARD.md.

## Checks
core test+typecheck, testkit test+typecheck, `pnpm depcruise` pass. `pnpm -r typecheck` shows no errors anywhere (the ingest/eval types are structurally compatible).

## To-do for the next agents (failing tests, with cause)
- eval (`packages/eval/test/conformance.test.ts`): (1) "event order" fails: the runner puts the pipeline bracket per question/part of the run, not around the run as the relative-order check requires (pipeline.started before eval.run.started, pipeline.finished after eval.run.completed, if present; or none of eval-run). Re-run to read the exact message. (2) "Rule 4" fails: runner must write `judge` ({recipeId(judgeRecipe()), model}) and `answerer` ({model, promptDigest of the answer prompt}) into `eval.run.started` and `config` (see review should-fix 2). `RunEval`'s `judge` signature still takes no ctx (review should-fix 1, not part of this wave).
- app (`packages/app/test/skeleton.test.ts`): ingestScenarios "embedded texts pass through chunkView" fails and, with it, "EagerIngestService fails, the skeleton passes": the skeleton's ingest deps are built without `chunkView` (or do not apply it) in the suite's `make(d)`; the new `d.chunkView` must be passed through and used when rendering embedded text. (Not inspected: skeleton is off limits for this task.)
- ingest (`packages/ingest`): passes today, but `IngestDeps.chunkView` must become required (`deps.ts`, optional now) and its tests/service wiring updated; the suite's `make(d)` already supplies `chunkView`.
- Seen failing in a full `pnpm -r test` but unrelated to this change (core/testkit untouched by them; likely other work in progress or timing): api (feedback item outside the result), embed (ollama request shape), and in one run chunk (split edge) and store (locking). Re-check before blaming 0.6.1.
