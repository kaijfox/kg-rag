# Sprint 2 results: baseline measurement (2026-10-23)

Plain-language summary first; tables from `analyze.py` are in `results-tables.md`. Everything here is on the stat-mech corpus with the frozen chunker and the undecoded parse, one index per author (Kardar 223 chunks, Plischke 89), local models only (embeddinggemma, qwen3.5), and 63 reviewed questions (37 Kardar, 26 Plischke; 40 single-hop, 12 multi-hop, 11 topic). It is a small, easy test, and several conclusions are limited by that.

## The headline
1. **Baseline similarity search is already strong on this test.** For single-hop questions the right passage is first in 31 of 40 cases, top 3 in 37, and always in the top 20. Answers from retrieved passages (top 5) score about 0.91 against 0.93 to 1.0 when the right passage is handed over directly (the judge is conservative, so absolute values run low).
2. **The test cannot tell small improvements apart.** Answers without any context already score 0.73 to 0.80, so many questions are answerable from general physics knowledge, and the gap between "no context" and "perfect context" is only about 0.2. Any layer that helps by less than that will be invisible here.
3. **The one clear weakness is topic-level questions** (answers that need a whole section): all the gold passages are in the top 5 for only 36% of them (against 95% for single-hop), and the answer gap to perfect context is 0.14 (n = 11, so indicative only).
4. **We could not test multi-hop.** After review only 12 multi-hop questions survived, and they were built from passages that retrieval itself considers similar, so they come out easy (all-gold at 5: 0.92). That says nothing about hard multi-hop.
5. **Cross-author answers are poor**: questions written from one author's text and answered from the other author's index score 0.24 (Kardar questions on the Plischke index) and 0.31 (the reverse), far below no context (0.8). Mostly the other book does not contain the specific fact asked (15 of 37 Kardar-question answers say the context lacks it), and the answerer is told not to guess. So the overlap between the two books, at the level of individual facts, is small. This is the headroom the cross-corpus test offers, and it is bounded by the overlap.

## What the pre-checks say about each possible first expansion
| Layer | Pre-check result | Reading |
|---|---|---|
| Reranking | Gold rank 1 for 31/40 single-hop, rank 2-3 for 6, 4-5 for 1, 6-20 for 2. Recall@1 0.78 vs @5 0.95. | Gain only at k = 1 to 3; little left at k >= 5. Low priority. |
| Graph walk / query decomposition (multi-hop) | all-gold@5 0.92 vs single-hop 0.95; answer gap -0.05 (n = 12, noise). | No failure observed, but the multi-hop questions are weak and easy. Untestable with this set. |
| Community summaries (topic-level) | all-gold@5 0.36, @20 0.45; answer gap 0.14 (n = 11). | The clearest gap. A plausible first target, but n is small. |
| Adjacent-chunk expansion (evidence split across chunks) | 14 of 63 questions have gold in adjacent chunks (9 topic, 5 multi-hop); 4 of the 8 questions where retrieved context scored below perfect context have adjacent gold. | A real but modest signature. It needs no extraction, so it is the cheapest candidate to try. |
| Query refinement | Of the 10 questions with gold not fully in the top 5, paraphrasing fixed 2 of Plischke's 4 completely (recall 0 to 1) and none of Kardar's 6. | Helps single passages with unlucky wording; does nothing for topic questions. Small n. |
| Relation layer (extraction) | Pilot on 24 gold chunks: the needed fact appears in a relation for 20 (83%). Of 40 sampled relations, 24 (60%) are clean standalone sentences, 14 are not (dangling "the chapter", "Equation (2.100)", section-number filler), 2 are unfaithful. Duplicate node names about 10% (lower bound); conflicts 1 pair in 185 relations. | Not ready: the extractor needs prompt and filter work first. It is the prerequisite for graph walk, so the graph track is blocked on that, not on retrieval. |
| Conflation / corpus gap | Kardar: 57% of chunks carry PDF glyph-name junk (`SLalpha`, `lbrace`); Plischke 0%. For Kardar topic questions, all the gold is within the top 50 only 78% of the time. | Kardar's text quality confounds any author comparison; report authors separately. A cleanup is a new chunk recipe (new ids). |

## Recommendation (ambiguous, so it goes to you)
The data does not single out an expensive layer. What it supports:
1. **Before building anything expensive, make the test harder.** Add a stronger question generator for multi-hop and topic questions, and use the second corpora (the arXiv review plus its cited works, with validated equations; Q15). Without that, a graph or summary layer cannot show its value.
2. **Try the cheap candidate first:** adjacent-chunk (or section) expansion, measured with an oracle first (gold chunks supplied) to bound the gain. It needs no extraction and attacks the clearest weakness (topic questions).
3. **Treat the relation layer as a longer track:** fix extraction (standalone sentences, no section-number filler, qualifier checks) and re-pilot on a larger sample before scaling.
4. **Decoded-formula build:** the required follow-up from Q13 is not started. 46 of 63 questions have a formula in their gold text, so decoding affects most of the set; the arXiv corpora are the place to measure it.

## What was verified and what was not
- Judge validated: kappa 0.74 (interval 0.48 to 0.89), all five pre-registered thresholds pass, two at the limit; conservative on correct answers (`judge-validation/RESULT.md`). Judge parse failures: 0 of 252.
- Questions: 113 drafts, reviewed by Sonnet reviewers against a fixed rubric; 50 removed (excluded by review or duplicate gold). The review is by a model, not a person. The 4-word copy rule dropped about half of all drafts (a possible bias towards vague wording).
- The first answer run used 20 retrieved passages as context by accident (side effect of the recall list), which made answers worse than no context; the reported retrieved numbers use the top 5. The 20-passage run is kept for reference.
- Not done: the judge's determinism check; the decoded-formula build; the formula-question oracle with decode-only gold; multi-hop on a trustworthy set; extraction pilot beyond 24 chunks; answers for conditions other than the three standard ones; the share of runs reproduced (see below).

## Reproduction
Seeds: groups 17 (round 1) and 31 (round 2). Builds: Kardar `bd_54xv4xliwgsagq3kbflb`, Plischke `bd_kixjonpuruzwuth7mto2`. Eval sets: `eval-set-kardar.json` (`qs_qvhpnfeltkzxik3ti2yn`), `eval-set-plischke.json` (`qs_4rot47kbnzjnmrsgj5pu`). Models: embeddinggemma:latest (digest pinned in the space), qwen3.5:latest (digest 6488c96fa5fa) for generation, answers, judging and extraction; Sonnet subagents for question review, judge scoring and extraction review. Scripts: `packages/app/scripts/baseline.ts`, `baselineRun.ts`, `precheck.ts`, `extractPilot.ts`; `scratch/sprint-2/analyze.py`. Local model answers are not bit-reproducible (temperature 0 but no replay cache); the stored answers and judgements are in the `run-*.json` exports and the databases.
- Log size: about 30 to 34 KB per search, 87% of it the `search.step` events; the two baseline databases are 10 MB and 7.5 MB after 222 and 192 searches. Delta encoding is not needed at this scale.
