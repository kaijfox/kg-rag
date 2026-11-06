# @kg/eval

Evaluation as plain functions over the kernel: questions with known supporting passages, answering, judging, retrieval
metrics, and questions taken from real use. Its source imports `@kg/kernel` only.

## Open first

| For | File |
|---|---|
| a run: every question under every condition, answered, judged and scored | `src/run.ts` |
| writing questions from chunks, and the check against copying the passage's wording | `src/generate.ts` |
| questions from agent sessions, and labelling the ones that went badly | `src/fromLog.ts` |
| recall at k, and whether all supporting passages are present | `src/metrics/recall.ts`, `src/metrics/summary.ts` |
| the prompts for generating, answering and judging | `src/prompts/` |
| the question and set types | `src/types.ts` |

## Worth knowing

- A condition is `no-context`, `gold`, `retrieved` (the database's default machine), or the name of a search machine. With
  `retrievalOnly` only retrieving conditions are allowed and no model is called.
- A question or condition that fails is recorded and the run goes on. Failures are counted and left out of the means.
- Questions from real use have type `logged`. Their gold is the set of chunks an agent reported using, which is a weaker
  claim than a hand-reviewed gold, and they have no reference answer, so they are run with retrieval only.
- The pinned sets for the stat-mech corpus are in `test/corpa/stat-mech/eval/`.

## Tests

`test/eval.test.ts`. Other packages' tests also run evaluations end to end.
