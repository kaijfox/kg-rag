# Judge validation result (2026-10-23)

Judge: qwen3.5 (local), prompt `packages/eval/src/prompts/judge.md`. Sample: 30 answers from the own-corpus runs, 10 per condition, seed 17 (`make_sample.py` in `scratch/sprint-1/judge-validation/`), spread over the judge's own scores. Scorer: Sonnet subagents, blind to condition and judge score, rubric verbatim, two independent passes in different row orders; the 6 rows on which the passes differed were scored a third time and flagged unstable.

| Pre-registered threshold | Result | Verdict |
|---|---|---|
| quadratic-weighted kappa >= 0.6, bootstrap lower bound > 0.4 | 0.74 (95% interval 0.48 to 0.89) | pass |
| no condition with abs(mean(judge - ref)) > 0.15 | no-context +0.10, retrieved -0.10, gold -0.15 | pass (gold is exactly at the limit) |
| zero rows with ref 0 and judge 1 | 0 | pass |
| at most 2 rows with ref <= 0.5 and judge 1 | 2 (both no-context, both unstable) | pass (at the limit) |
| at most 1 of 30 parse failures after retries | 0 of 30; 0 of 252 judgements across all runs | pass |

Agreement: exact 0.70. Confusion (rows ref, columns judge): ref 0: 5/1/0; ref 0.5: 0/5/2; ref 1: 0/6/11.

Reading: the judge is usable for within-pair comparisons and coarse absolute levels. It is conservative: of the 17 answers the scorer rated fully correct, it gave 6 only 0.5, so gold and retrieved means are biased low by about 0.1 to 0.15 and no-context slightly high (+0.10), which compresses the gaps between conditions. Its leniency errors (judge 1 where the scorer said 0.5) fall on the unstable rows. Twenty percent of rows (6 of 30) were unstable between the scorer's own two passes, so the scorer is itself noisy and 0.74 is partly bounded by that.

Limits: n = 30 gives a wide interval (0.48 to 0.89); two thresholds pass exactly at the limit; the scorer is a model, so this is agreement with a stronger model and not with a person (decision of 2026-10-18). Not done: rerunning the judge on the same 30 rows to confirm determinism at temperature 0.
Files: `scored.jsonl`, `out-*.jsonl` (scorer outputs), `anon-map.json`, `key.jsonl`.
