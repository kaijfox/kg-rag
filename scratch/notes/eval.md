# @kg/eval notes

## What was done
- Runner: `runEval` (handler, one eval session, one `eval_run` tool call), machines `eval-run` (question loop) and
  `eval-question` (per question and condition). Metrics: recall, allGold, withSummaries, by type, judge means.
- 11b: `judge` (machine and function, strict parser, retries), `generateQuestions` (machine, strict parser, dedupe and
  wording check), `answer`; recipes for judge and generation with topology and prompt digest.
- Suite results: `evalRunnerConformance` 5 of 5; `expected-metrics.json` exact (tolerance 1e-9); judge means and ceiling gap
  match; package tests 79 of 79.
- Pins: `eval-run@1` c0dea17dce5a75e6, `eval-question@1` 36952482b4154804, `judge@1` eeb1fa466badd952,
  `eval-generate@1` 51c6bbb60c0b3203; prompt digest 576f82d45e4dd2937984364c9cbe4795323d60497738ab9a7914b4ae74376458.

## Assumed
- The prompt digest covers every `.md` in `src/prompts`, README included.
- Oracle list = build members of the gold chunks, then the retrieved items.
- A retry budget of N allows N retries after the first reply.
- `answer()` lives in 11b and the runner imports it (boundary: the types are the contract; this is one function).

## Surprised by
- The runner suite fixes event indices (`eval.run.started` third, `eval.run.completed` second to last). `runPipeline`
  puts `pipeline.started` and `pipeline.finished` around the machine, so the bracket covers the question loop only.
- The same silent-state conflict as ingest: judge parsing, generation selecting and validating emit nothing; they are
  routing states now.
- `drive` repeats the initial routing state (start snapshot and microstep); tests collapse consecutive repeats.
- The judge fixture scripts verdicts for three conditions; the oracle and variant conditions get a neutral verdict in tests.

## Would flag
- The judge is unvalidated against hand-scored examples (card requires it; open question 10).
- `machineLogConformance` is search-only (same as ingest).

## 2026-10-18: review fixes
- `eval-run` is the card's machine again (opening, checkingBuild, pinning, nextQuestion, question, summarizing, completing, done/failed) and the whole run is inside `runPipeline`. Pure steps (opening, checkingBuild, summarizing) are routing states. Pin `eval-run@1` is now 09ca17561b4971b3.
- The judge's calls are logged (`llm.called`, purpose `eval-judge`); the judge and answerer are recorded in the config and in `eval.run.started` (contract 0.6.1).
- A malformed-reply retry (judge and generation) resends the original messages plus the earlier replies and `RETRY_INSTRUCTION`.
- Mutation survivors of the review are killed by tests (checked by flipping each mutation by hand): recall at k+1, unique gold, summary-free retrieval skip, unknown build, oracle membership and dedupe, gold condition with several texts, per-condition search recipe, wording phrase length, repeated `uses`.
- agreement.py (judge validation) reads scores in {0, 0.5, 1} as the verdict parser accepts; consistent. A failed judge call fails the question and the run, so the "share needing a retry" is read from the count of `llm.called` with purpose `eval-judge` against results.
