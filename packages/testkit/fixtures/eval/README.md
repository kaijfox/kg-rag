# eval: mini eval set, scripted retrievals, judge verdicts, hand-computed metrics

- `mini-set.json`: an EvalSet over mini-corpus v1, 5 questions: q1, q2 single-hop; q3, q4 multi-hop with
  two gold chunks each; q5 topic with three. Gold text is the chunk text. `id` = evalSetId(questions).
- `retrievals.json`: the scripted "retrieved" condition, five ranked items per question. q4's rank 1 is a
  relation item (`rl_...`) whose sources are A1 and X, so gold A1 is reached only through a relation; q4 also
  retrieves `entropy/2.1-d1`, the same text as gold `entropy/2.1-d0` under a different ID. q5's rank 1 is a
  summary (`sm_...`) whose sources include all three gold chunks.
- `judge-verdicts.jsonl`: one scripted judge verdict per (question, condition) at the JudgeVerdict
  boundary (the prompt format belongs to eval 11b and is not fixed here).
- `expected-metrics.json`: written by hand from the definitions below; test/fixtures.test.ts re-checks it
  with an independent few-line computation.

Definition: G = gold chunk IDs; C_k = union of sourceChunkIds of the items at ranks 1..k whose kind is not
`summary` (ranks count every item). recall@k = |G ∩ C_k| / |G|. withSummaries includes summary sources
(reported separately; the design says summaries inflate recall). allGold@k = 1 if G ⊆ C_k.

Arithmetic:
- q1 G={1-ab}: rank 1 -> 1, 1, 1.
- q2 G={1.1}: rank 3 -> @1 0, @3 1, @5 1.
- q3 G={1-cd, 1-e}: 1-cd at rank 1, 1-e absent -> 0.5, 0.5, 0.5 (partial multi-hop credit).
- q4 G={3-a1, 2.1-d0}: relation at 1 covers a1 -> @1 0.5; d1 at 3 does not count -> @3 0.5; d0 at 5 -> @5 1.
- q5 G={2, 2.1-x, 2.2-list}: summary at 1 excluded -> @1 0; entropy/2 at 3 -> @3 1/3; list at 5 -> @5 2/3;
  withSummaries 1, 1, 1.
- overall: @1 (1+0+.5+.5+0)/5 = 0.4; @3 (1+1+.5+.5+1/3)/5 = 2/3; @5 (1+1+.5+1+2/3)/5 = 5/6.
  withSummaries: @1 (1+0+.5+.5+1)/5 = 0.6, @3 0.8, @5 0.9.
- by type: single-hop @1 .5 @3 1 @5 1; multi-hop @1 .5 @3 .5 @5 .75, allGold@5 .5; topic 0, 1/3, 2/3.
- judge means: no-context (0+0+.5+0+0)/5 = 0.1; gold (1+1+1+1+.5)/5 = 0.9; retrieved (1+.5+.5+1+0)/5 = 0.6.
  Ceiling gap (gold - retrieved) by type: single-hop 1 - .75 = .25; multi-hop 1 - .75 = .25; topic .5 - 0 = .5.
