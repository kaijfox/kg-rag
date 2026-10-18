# @kg/eval (WP11a metrics and runner machines: Haiku; WP11b generation and judge machines and parsers: Haiku; the prompt files are written by the lead)

Contract: `@kg/core` CONTRACT_VERSION 0.6.1. You need this card, `core`, `@kg/pipeline` (README and `src`), `testkit`, and
`.claude/skills/xstate/SKILL.md` (XState v5 only); nothing else. Do not read `packages/app/src/skeleton`.
Two owned subdirectories: `src/metrics` + `src/runner` (11a) and `src/prompts` (11b). Their boundary is the
core types `QuestionDraft` and `JudgeVerdict`.

## The machines (`src/machines/`; kit helpers from `@kg/pipeline`)
Evaluation pipelines are state machines like search and ingest (read the search card's machine rules: `setup()`, `loggedActor` for work states, routing states with only `always`
moves and `meta: { routing: true }`, two final states `done` and `failed` with `failed` carrying id `failed` and keeping the `KgError`, no direct `xstate` import,
`meta.logs` and `meta.step` on every work state). Run `eval-run` with `runPipeline` around the whole run inside the tool handler (pipeline kind `eval-run`). Generation and judging take no tool context: they are not pipeline runs (the kind `eval-generate` stays unused until a generation tool exists), but their LLM calls are logged. Pure steps are routing states; a work state declares the events it causes, which may be emitted by a wrapped port (`loggedLlm`).
- `eval-run` (parent): `opening` -> `checkingBuild` (unknown build -> `failed` `not_found`; stale and not allowed -> `failed` `precondition`) -> `pinning` (`repo.putRun`, emits
  `eval.run.started` with the judge `{recipeId, model}` and the answerer `{model, promptDigest}`, also kept in the run config) -> `nextQuestion` (routing) <-> `question` (invokes the child per question and condition) -> `summarizing` (orphaned gold, summary) ->
  `completing` (emits `eval.run.completed`) -> `done`. An unknown condition name is `invalid_input` before the run starts.
- `eval-question` (child per question and condition): `route` (routing by condition kind) -> `contextNone` | `contextGold` | `contextRetrieved` (calls `api.search`: a nested tool call) |
  `contextOracle` -> `answering` (the answerer through `loggedLlm`) -> `judging` (the judge) -> `scoring` (emits `eval.question.scored`, `repo.putResult`) -> `done`.
- `judge`: `calling` -> `parsing` -> (malformed and tries left -> `calling` with a corrective request: the earlier malformed replies and a fixed instruction are appended, so a retry never repeats a request; else `failed`) -> `done`. Settings typed: model, temperature, retry budget.
- `eval-generate` (question generation): `selecting` -> `generating` -> `parsing` -> (malformed and tries left -> `generating`, else `failed`) -> `validating` (dedupe, no reuse of the
  passage wording) -> `done`. Settings typed: model, temperature, question-type mix, retry budget.
Recipes for `judge` and `eval-generate` are machine name + version + typed settings + topology + `promptDigest` (sha256 over their prompt files, computed by the machine's recipe builder,
so editing a prompt changes the recipe id). Tests per machine: `machineMapConformance`, `machineLogConformance` on real runs, path tests with `drive`/`withActors`/`scripted`
(a malformed judge output twice then a valid one with a retry budget of 2 visits calling, parsing three times and ends in `done`; with a budget of 1 it ends in `failed`),
a pin test (`machines/pins.json` holds topology and prompt digest per machine and version) and a regenerate-and-compare Mermaid diagram test (`docs/*.mmd`), and one golden run per machine.
Eval comparisons across conditions may name a search recipe per condition: `EvalRunInput.searchRecipes` (optional map condition -> recipe id, see core `evalTool.ts`); a condition not in the map uses the build's default.

## 11a: metrics and runner
- `recallAtK(q: EvalQuestion, ranked: {kind; sourceChunkIds}[], k, o?: {withSummaries?: boolean}): number`,
  `allGoldAtK(...)`, and aggregation overall and by question type. Definition (fixtures/eval/README.md):
  C_k = union of sourceChunkIds of the items at ranks 1..k whose kind is not `summary` (unless
  withSummaries); recall@k = |gold ∩ C_k| / |gold|. Per unique gold chunk, never per item.
- `runEval: RunEval` (type in `@kg/testkit/conformance` `evalRunner.ts`):
  `runEval(d: { rt; api: KgApi; store: Pick<CorpusStore, 'getBuild'|'staleCheck'|'getItems'>; answerer: Llm; judge: (q, answer, condition, ctx) => Promise<JudgeVerdict>; repo: EvalRepo }, set, o: { conditions; ks; buildId?; allowStale? }): Promise<EvalRunOutput>`.
  The store read gives staleness, gold text and membership; KgApi has no staleness read.
  1. Open one session of kind `eval`; build = `o.buildId ?? rt.currentBuild()`; then everything inside one
     `runTool(rt, EVAL_RUN_TOOL, session, input, handler)` (core `evalTool.ts`).
  2. Unknown build -> `not_found`; `store.staleCheck(build).stale && !o.allowStale` -> `precondition`.
  3. `repo.putRun`, emit `eval.run.started {runId, buildId, ...}` - **every eval.* emit passes `{ buildId }`
     explicitly** (the ctx default is the current build, which is wrong for a pinned run); the payload
     buildId must equal the envelope's.
  4. Per question, per condition: `no-context` (no context), `gold` (the question's `goldText` as context),
     `retrieved` (`api.search(session, { query: q.question, k: max(ks), buildId })`, a nested tool call that
     runTool parents to eval_run; context = the result texts), `oracle-gold-first` (**defined**: the gold
     chunks, as items fetched from the store in `goldChunkIds` order, placed at ranks 1..|G|, followed by the
     retrieved items not already present, cut to max(ks); recall is computed on that list, so it is 1 at k >= |G|
     when every gold chunk is in the build). Answer with `loggedLlm(answerer, ctx)`, judge, emit
     `eval.question.scored` with `{ buildId, searchId }` (searchId only for conditions that searched),
     `repo.putResult`.
  5. `summary.orphaned = orphanedGold(set, store, build)` (core): questions whose gold chunks are not in the
     build. Their recall is reported, but the summary must name them (after re-chunking, regenerate them). An
     identical-text duplicate of a gold chunk under another ID counts as a miss (review L8).
  6. Emit `eval.run.completed {runId, summary}`; return `{ runId, summary }`.
- Tests you must pass:
```ts
import { evalRunnerConformance, registerSuite } from '@kg/testkit/conformance';
import { runEval } from '../src/index';
registerSuite(evalRunnerConformance(runEval)); // event order, Rule 6 on a pinned build, stale refusal, orphaned gold, recall, persistence
```
  plus `expected-metrics.json` exactly (tolerance 1e-9) from `mini-set.json` + `retrievals.json`, and judge means
  by condition from `judge-verdicts.jsonl`.

## 11b: generation, answering and judging (prompt files are written by the lead, not by you)
- `generateQuestions(llm, chunks, groups, recipe, { ctx? }): Promise<QuestionDraft[]>` (`generateQuestionsDetailed` also returns `dropped: {group, reason, question}[]` and `genRecipeId`; with `ctx` the model calls are logged as `llm.called`) (single-hop from one chunk,
  multi-hop from linked chunks requiring all of them, topic from a section; instruct the model not to reuse
  passage wording), `answer(llm, question, context)`, `judge(llm, question, reference, answer): JudgeVerdict` (the runner passes `loggedLlm` of the judge's llm, via `makeJudge`, so judge calls are logged).
  The prompt files under `src/prompts/` (`generate-*.md`, `answer.md`, `judge.md`) are supplied by the lead: read them, load them at run time or build time, hash them for `promptDigest`, never edit them.
  Your part: the loaders, the output parsers (strict, with clear `invalid_input` errors on malformed model output) and the machines above.
- Parsers for model output are tested on scripted outputs (ScriptedLlm). The judge is validated against
  hand-scored examples before any number is trusted (roadmap Phase 2 eval-design review).
- The runner imports the single `answer()` function from `src/prompts` (accepted; no port).
- Provider: local Ollama for every LLM call for now; `qwen3.5:latest` is installed. Do not
  pull models. Keep replay caching (`ReplayLlm`) so reruns are free and reproducible.

## package.json
Already created (core, pipeline, testkit). Do not run `pnpm install` and do not add dependencies.
Command: `pnpm --filter @kg/eval test`.

## Fixtures you may read
`testkit/fixtures/eval/*`, `testkit/fixtures/mini-corpus/*`, `testkit/fixtures/log/session-eval.jsonl`.

## Forbidden imports
Any `@kg/*` other than core and pipeline (testkit in tests). No direct `xstate` import. Never call `EventLog.append`.

## Decisions already made
Eval sets are canonical JSON files `evals/<setId>.json` with gold text embedded; runs and results in
SQLite via `EvalRepo`; condition names are open strings; summaries scored separately.

## Open questions (note, do not decide)
- The judge is a weak local model: validation against hand-scored examples carries more weight than usual.
- Cross-corpus questions (Kardar questions against a Plischke index) have no gold chunk IDs in the target
  database: recall is undefined there, only answer quality applies.
