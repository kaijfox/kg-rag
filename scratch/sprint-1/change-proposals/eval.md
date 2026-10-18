# Change proposals from @kg/eval (WP11a, WP11b)

## 1. The runner suite's event order conflicts with a pipeline bracket around the whole run

The card says `eval-run` runs through `runPipeline` inside the tool handler. `evalRunnerConformance` checks that the session
reads: `session.started`, `tool.called` (eval_run), then `eval.run.started` at index 2, and that `eval.run.completed` is
second to last, before `tool.returned`. A bracket around the whole run puts `pipeline.started` at index 2 and
`pipeline.finished` between `eval.run.completed` and `tool.returned`. Both cannot hold.

What was done: `runEval` checks and pins the run, emits `eval.run.started`, then runs the machine (the question loop) inside
`runPipeline`, then summarizes and emits `eval.run.completed` after the bracket. The machine has no `opening`, `checkingBuild`,
`pinning`, `summarizing` or `completing` states.

Proposed fix (testkit): check the order of `eval.run.started` before the first `eval.question.scored` and of
`eval.run.completed` after the last one, and not the fixed indices. Then the card's machine (with the bracket around all of it)
can be built. Alternatively drop the bracket for eval-run and say so in the card.

## 2. Pure steps cannot satisfy machineMapConformance

Same rule as the ingest proposal 1: every work node must declare a non-empty `logs`. Several steps of the card are pure (no
event, no I/O): the question route (no-context and gold context), `selecting` and `validating` of generation, and `parsing` of
judge and generation. They are routing states now; parsing is a set of guards on the raw reply, and the parsed value is set
on the way out. Proposed fix: allow a work node with no logs when its step emits nothing (the same change as ingest 1), or
accept the routing form as the house pattern and say so in the card.

## 3. Generation and judging have no tool context, so no pipeline bracket

The card says the eval-generate machine runs with `runPipeline` inside the tool handler. There is no tool for generation, and
`generateQuestions(llm, chunks, groups, recipe)` takes no context, so nothing can emit `pipeline.started`. The machine is run
with a plain actor (`settle`). Proposed: either a tool for question generation (then the bracket applies), or the card
states that generation and judging are not pipeline runs.

## 4. machineLogConformance is search-only

Same as ingest proposal 2: it requires `search.step` events and cannot pass for eval machines. Not applied; the eval test checks
that every eval event a run emits is declared by a work state (`test/runner.test.ts`).

## 5. Declared logs on states whose events come from outside the machine

`judging` (the judge function) and `answering` declare `llm.called`, which is emitted by the `Llm` wrapper (`loggedLlm`) the
caller passes, not by the state. `eval-run` handles `eval.run.started` and `eval.run.completed` outside the machine (see 1).
Proposed: state in the card that the declared logs name events that the state causes, which may be emitted by a wrapped port.

## 6. answer() lives in the prompts package but the runner imports it

The boundary between 11a (runner) and 11b (prompts) is stated as the core types. The runner's answering state calls `answer()`
from `src/prompts/answer.ts` (one function; no types cross the other way). Proposed: accept the single import, or move
`answer` behind an `Answerer` port in core.

## Event for dropped question drafts (from the integration run)
`generateQuestionsDetailed` returns `dropped` drafts with `{group, reason, question}`, but no event type fits logging them (generation runs outside a tool call and `llm.called` carries no such data). Proposal: an `eval.generate.dropped` event `{ count, reasons: {group, reason}[] }`, or a session note by the caller. Until then the caller prints `describeDropped(dropped)` and stores `genRecipeId` in `EvalSet.genRecipeId` (`packages/app/scripts/integrate.ts` still passes `null` and calls the old function; app owner to switch).
