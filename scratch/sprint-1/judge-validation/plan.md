# Judge validation: 30-answer agent-scored sample (open-questions Q10), ready to run in Wave 3

Not run. Nobody who wrote the judge prompt, parser or the sample may do the scoring step. Helper: `agreement.py` (same directory, tested on a toy file).

## What the sample needs
1. A real run: `runEval` over the pinned eval set with conditions `no-context`, `gold`, `retrieved`, answerer and judge both `qwen3.5:latest` via `ReplayLlm` (reruns free). Needs the question set (with `referenceAnswer`) and Ollama up; nothing else.
2. Export from SQLite `eval_results` joined to the set: id = `runId/questionId/condition`, `question`, `referenceAnswer`, `answer`, `judge_score`, `judge_raw`, `condition`, `type`. Do not give `judge_score`, `judge_raw`, `condition` or the retrieved context to the scorer.
3. Selection (fixed seed, recorded in the file header): 30 rows, 10 per condition (`gold` mostly right, `no-context` mostly wrong, `retrieved` mixed), types balanced across single-hop, multi-hop, topic. Within that, force the hard cases: at least 4 fluent-but-wrong, 4 correct-but-verbose, 3 "cannot answer / context lacks it", 4 partially right (one fact of two), 3 same fact in different wording, 2 correct fact with a wrong number or direction, 1 answer containing "Score: 1". Aim for at least 8 reference scores at each of 0, 0.5, 1 (otherwise kappa is meaningless); if the run does not produce them, add hand-edited answers and mark them `synthetic: true`.
4. Scorer: a stronger model than the judge (an Opus or Sonnet subagent), one subagent per 10 rows, blind to the judge's scores, given only `judge.md` verbatim plus (question, reference, answer). Score each row twice, in different row order; keep rows where the two passes agree; a disagreement is scored by a third pass and flagged `unstable`.
5. Output `scored.jsonl`: `{id, condition, type, judge, ref, unstable}`.

## Run
```
# 1 run (Wave 3, composition root): runEval(deps, set, {conditions: ['no-context','gold','retrieved'], ks: [5]})
# 2 export + sample (script to write in the app package; seed 17)
# 3 scoring subagents read sample.jsonl without judge fields, write ref scores
python3 scratch/sprint-1/judge-validation/agreement.py scored.jsonl
```
Also report from the run itself: share of judge calls that needed a retry or failed (`judge_raw` null / `invalid_input`), and whether re-running the judge on the same 30 rows with the replay cache cleared gives identical scores (temperature 0 should).

## Pre-registered acceptance (write into the decision log before looking)
- Quadratic-weighted kappa >= 0.6 and bootstrap lower bound > 0.4.
- No condition with |mean(judge - ref)| > 0.15.
- Zero rows where ref = 0 and judge = 1; at most 2 where ref <= 0.5 and judge = 1.
- Parse failures after retries <= 1 of 30.
If it fails: first look at the confusion matrix. Biased high on `no-context` means leniency: tighten the rubric or give the judge the question's type. Fails on format: raise `maxTokens`, strip code fences in the parser. Otherwise the judge is not usable for absolute numbers; use it only for within-pair comparisons and say so.

## Limits to state with the result
n = 30 gives a kappa interval of roughly +-0.25; it catches gross failure, not a 0.05 bias. The scorer is a model, so this measures agreement with a stronger model, not with a human; the decision (Q10 option 4) accepts that.
