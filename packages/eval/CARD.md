# @kg/eval (WP11a metrics and runner: Haiku; WP11b prompts: Opus for prompts, Haiku for parsers)

Contract: `@kg/core` CONTRACT_VERSION 0.2.0. You need this card, `core`, and `testkit`; nothing else.
Two owned subdirectories: `src/metrics` + `src/runner` (11a) and `src/prompts` (11b). Their boundary is the
core types `QuestionDraft` and `JudgeVerdict`.

## 11a: metrics and runner
- `recallAtK(q: EvalQuestion, ranked: {kind; sourceChunkIds}[], k, o?: {withSummaries?: boolean}): number`,
  `allGoldAtK(...)`, and aggregation overall and by question type. Definition (fixtures/eval/README.md):
  C_k = union of sourceChunkIds of the items at ranks 1..k whose kind is not `summary` (unless
  withSummaries); recall@k = |gold ∩ C_k| / |gold|. Per unique gold chunk, never per item.
- `runEval: RunEval` (type in `@kg/testkit/conformance` `evalRunner.ts`):
  `runEval(d: { rt; api: KgApi; store: Pick<CorpusStore, 'getBuild'|'staleCheck'|'getItems'>; answerer: Llm; judge: (q, answer, condition) => Promise<JudgeVerdict>; repo: EvalRepo }, set, o: { conditions; ks; buildId?; allowStale? }): Promise<EvalRunOutput>`.
  The store read (S4) gives staleness, gold text and membership; KgApi has no staleness read.
  1. Open one session of kind `eval`; build = `o.buildId ?? rt.currentBuild()`; then everything inside one
     `runTool(rt, EVAL_RUN_TOOL, session, input, handler)` (core `evalTool.ts`).
  2. Unknown build -> `not_found`; `store.staleCheck(build).stale && !o.allowStale` -> `precondition`.
  3. `repo.putRun`, emit `eval.run.started {runId, buildId, ...}` - **every eval.* emit passes `{ buildId }`
     explicitly** (the ctx default is the current build, which is wrong for a pinned run; R-29); the payload
     buildId must equal the envelope's.
  4. Per question, per condition: `no-context` (no context), `gold` (the question's `goldText` as context),
     `retrieved` (`api.search(session, { query: q.question, k: max(ks), buildId })`, a nested tool call that
     runTool parents to eval_run (P-3); context = the result texts), `oracle-gold-first` (**defined**: the gold
     chunks, as items fetched from the store in `goldChunkIds` order, placed at ranks 1..|G|, followed by the
     retrieved items not already present, cut to max(ks); recall is computed on that list, so it is 1 at k >= |G|
     when every gold chunk is in the build). Answer with `loggedLlm(answerer, ctx)`, judge, emit
     `eval.question.scored` with `{ buildId, searchId }` (searchId only for conditions that searched),
     `repo.putResult`.
  5. `summary.orphaned = orphanedGold(set, store, build)` (core, R-28): questions whose gold chunks are not in the
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

## 11b: prompts (question generation, answering, judging)
- `generateQuestions(llm, chunks, groups, recipe): Promise<QuestionDraft[]>` (single-hop from one chunk,
  multi-hop from linked chunks requiring all of them, topic from a section; instruct the model not to reuse
  passage wording), `answer(llm, question, context)`, `judge(llm, question, reference, answer): JudgeVerdict`.
  Prompts as files under `src/prompts/`, each a recipe (`eval-generate`, `eval-judge` kinds).
- Parsers for model output are tested on scripted outputs (ScriptedLlm). The judge is validated against
  hand-scored examples before any number is trusted (roadmap Phase 2 eval-design review).
- Provider: local Ollama for every LLM call for now (user decision Q3); `qwen3.5:latest` is installed. Do not
  pull models. Keep replay caching (`ReplayLlm`) so reruns are free and reproducible.

## package.json to create
dependencies `@kg/core: workspace:*`; devDependencies `@kg/testkit: workspace:*`.
Command: `pnpm --filter @kg/eval test`.

## Fixtures you may read
`testkit/fixtures/eval/*`, `testkit/fixtures/mini-corpus/*`, `testkit/fixtures/log/session-eval.jsonl`.

## Forbidden imports
Any `@kg/*` other than core (testkit in tests). Never call `EventLog.append`.

## Decisions already made
Eval sets are canonical JSON files `evals/<setId>.json` with gold text embedded; runs and results in
SQLite via `EvalRepo`; condition names are open strings; summaries scored separately.

## Open questions (note, do not decide)
- The judge is a weak local model: validation against hand-scored examples carries more weight than usual.
- Cross-corpus questions (Kardar questions against a Plischke index) have no gold chunk IDs in the target
  database: recall is undefined there, only answer quality applies.
