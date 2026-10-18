# @kg/eval

Evaluation of retrieval and answers, in two halves that meet at the core types `QuestionDraft` and `JudgeVerdict`.

- Runs (`src/runner`, `src/machines/evalRun.ts`, `src/machines/evalQuestion.ts`, `src/metrics`): an eval set is run against
  a pinned build under a list of conditions. Each question under each condition gets its context (none, the gold text,
  the retrieved items, or the oracle list), an answer, a judgement, a recall, and one persisted result.
- Generation and judging (`src/prompts`, `src/machines/judge.ts`, `src/machines/evalGenerate.ts`): questions are written
  from chunk groups, answers are given from context, and answers are graded against the reference. The prompt files
  under `src/prompts/*.md` are the lead's; the loader reads them and never edits them.

## Layout

- `src/metrics/recall.ts`: `recallAtK`, `allGoldAtK`, `coveredAtK`. Recall counts unique gold chunks covered by the
  sources of the non-summary items in ranks 1..k.
- `src/metrics/summary.ts`: `retrievalMetrics` (per question, overall, by type) and `judgeMeans`.
- `src/runner/run.ts`: `runEval`, the handler behind the internal `eval_run` tool. `src/runner/types.ts`: its dependencies.
- `src/machines/`: the four machines (`evalRun`, `evalQuestion`, `judge`, `evalGenerate`), `settle.ts` (runs a machine
  that is not bracketed by pipeline events to its output).
- `src/prompts/`: `loader.ts` (split at `=== user ===`, fill `{{name}}`, directory digest), `parse.ts` (strict parsers),
  `answer.ts`, `judge.ts` (the judge and its recipe), `generate.ts` (`generateQuestions` and its recipe).
- `src/machines/pins.json` and `docs/*.mmd`: the pinned topologies and prompt digests, and the generated diagrams. The
  tests fail if either drifts.

## Assumptions

- The answering and judging models are `qwen3.5:latest` through the `Llm` port, at temperature 0 (answer 300 tokens,
  judge 200). Generation uses temperature 0.7. The settings are constants in the prompt modules and are written into the
  recipes or the run config, so a rerun can name them.
- `promptDigest` is sha256 over every `.md` file in `src/prompts`, sorted by name, each as name, NUL, content, NUL. The
  README in that directory counts too (it sits in the directory the lead described).
- Judge replies are strict: exactly `{"score": 0 | 0.5 | 1, "rationale": "..."}`. A malformed reply is asked again up to
  the retry budget (two retries); the budget is spent per call, so a budget of 2 allows three replies. A retry resends the
  original messages, then each earlier malformed reply and `RETRY_INSTRUCTION` (`src/machines/retry.ts`), so it never equals
  an earlier request and a temperature-0 replay cache cannot return the same bad reply. The text is not in the prompt digest.
- Generation: one prompt per group; a reply must have the requested type; `uses` are passage numbers, unique and in
  range, at least two for multi-hop and at least `min(3, passages)` for topic. Drafts are dropped when their question
  repeats another question or copies four consecutive words of their own gold passages. Gold chunk IDs are sorted; the
  gold text follows them in the same order.
- The oracle list takes the gold chunks that are members of the pinned build, in gold order, then the retrieved items not
  already present, cut to max k. A gold chunk missing from the build is left out, so its recall stays below 1.
- A condition with a name other than the four standard ones is a retrieved condition only when `searchRecipes` names a
  recipe for it; otherwise it is `invalid_input` before the run starts.
- Recall of a question without gold chunk IDs is undefined: the metrics refuse it, and the runner records no recall for it.
- The run config and `eval.run.started` record the judge (`recipeId(judgeRecipe())`, model) and the answerer (model, sha256 of
  `answer.md`). The judge receives the run context (`makeJudge`), so its calls are logged like the answerer's.
- `runEval` opens its own eval session (the suite requires exactly one per run).

## Known gaps and deviations from the card

- Pure steps are routing states, because a work state must declare a log: `opening`, `checkingBuild` and `summarizing` of
  `eval-run`, `route` (no-context and gold context), `selecting`, `parsing` (judge and generation), `validating`. Parsing failures are routed by guards; the parsed value is set on the
  way out. Generation and judging run without a pipeline bracket: they take no tool context.
- The judge is not validated against hand-scored examples. The judge fixture is scripted; no real-model verdicts were
  checked. Numbers from a real judge are not trusted yet (card: validate first).
- Caching and the Ollama client are not in this package: the composition root passes an `Llm` (for example a `ReplayLlm`
  over a recorded log for reruns).
- Cross-corpus questions (gold chunks of another database) have no recall here; only answers and judgements are scored.
- `search.step` events of the nested retrieval come from the search package; the runner does not log them itself.

## Tests

`pnpm --filter @kg/eval test` (103): the runner suite (`evalRunnerConformance`, 6), metrics against `expected-metrics.json`,
the judge means and ceiling gap, the recall definition and the skip rules (13), the prompt layer with scripted replies
(including retry requests that differ, 20), the four machines (map conformance, pins, diagrams, paths with `drive`,
`withActors` and `scripted`, the whole-run path and its refusals; 51), and the runner's golden run, bracket, recorded judge
and answerer, judge logging, condition inputs and oracle list (13).
