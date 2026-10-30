# Reviewer B: processing (parse, parse-sidecar, chunk, ingest, embed, search, pipeline, eval)

## Summary

Tests pass in under a second per package, so running them is not the friction. The cost is structure: every pipeline is an XState machine that only orders a few function calls; formula decoding (not run as a build) touches five packages; in the eval harness the promised replay cache does not exist and one failed call fails a 25-minute run; and the multi-hop questions are built from passages similarity search already pairs. The chunker, embedder and metrics are sound and should stay.

Findings: 13 (3 need the user, 4 evidence-resolvable, 6 arbitrary).

## Findings (most severe first)

### F1. Pipelines as state machines cost more than anything in v0 uses
- **Finding:** Search, ingest, eval run, eval question, judge and generation are each a machine, plus a fingerprint, a map extractor, pins and diagrams. v0 has no loop and no branching that a plain function could not express.
- **Where:** `packages/ingest/src/machines/document.ts:60-192` (4 routing-only states, 7 identical `onError` blocks, wrapping 6 calls that are already plain functions in `steps.ts`); `packages/search/src/machines/similarity.ts:62-104` (114 lines for embed, knn, top-k); `packages/pipeline/src/map.ts` (98 lines), `run.ts` (69), `actors.ts`, `testing.ts`; `packages/*/src/machines/pins.json` (4 files); `ingest/test/machine.test.ts` (464 lines, 11 describe blocks, most of them about the machines themselves).
- **Evidence:** Q9 triage (`scratch/open-questions.md`): "no v0 machine uses a loop". Sprint 1 retro: "104 lines against 15 for search"; `machineLogConformance` is search-only (`scratch/notes/ingest.md`). `topologyOf` (`pipeline/src/map.ts:18`) hashes `meta.label`, so a cosmetic rename changes every build id, yet it ignores step parameters and guard bodies (`pipeline/README.md`).
- **Lens:** 2, 5.
- **Kind:** needs the user. AM-1 (machines) is an approved amendment; the user overrode the spike's own decision rule.
- **Proposed direction:** Smallest version: each pipeline is one async function that emits `pipeline.started`, the step events and `pipeline.finished`. A recipe is machine name, version and settings (no topology hash). Keep XState only for the first pipeline that needs a real loop (query refinement). The viewer's drawings are then written by hand or dropped (Reviewer C to price that).
- **Plain-language line:** Ingest, search and eval each run through a workflow engine that today only does steps one after another. It makes every new step cost extra wiring and tests, and a harmless rename can change the identity of every saved index.

### F2. The replay cache the design promises does not exist
- **Finding:** The design says model calls are "cached for replay". No cache is wired. `ReplayLlm` is a test fake, and the log cannot feed it because it stores only hashes.
- **Where:** `design/260916_initial-roadmap.md` ("Stack settled"); `packages/testkit/src/fakes/llm.ts:25-35` (read-only fake); `packages/core/src/evalTool.ts:67-80` (`llm.called` records `requestSha256` and `responseSha256`, never the text); `packages/eval/README.md:56` says "a `ReplayLlm` over a recorded log", which cannot work; `packages/app/src/ollamaLlm.ts` has no cache; `packages/eval/src/machines/retry.ts:3-8` is written to defeat a cache that is not there.
- **Evidence:** `scratch/sprint-2/results.md` ("no replay cache"); judge determinism check not done (`judge-validation/RESULT.md`). Cost of not having it: own-corpus run 1,494,239 ms for 37 questions x 3 conditions (`run-own.out`), generation round 2 took 7,256,981 ms (`generate-r2.out`), and one stalled call lost a run (decision log 2026-10-23).
- **Lens:** 1, 4.
- **Kind:** evidence-resolvable. Check: with a cache in place, rerun the judge on the 30 validation rows twice; identical output settles the determinism item for free.
- **Proposed direction:** A write-through cache inside `ollamaLlm`, keyed by `requestSha256` and stored as a table in the existing SQLite file (about 20 lines, no dependency). Store the response text. Then reruns are free and `RETRY_INSTRUCTION` is justified.
- **Plain-language line:** Re-running an evaluation re-asks the local model every question, which takes 25 minutes to 2 hours. The saved-answer shortcut promised in the design was never built.

### F3. One failed model call fails the whole eval run
- **Finding:** If any single question's answer or judge call fails, the run ends in `failed`. Already-scored results are stored, but nothing resumes or skips them.
- **Where:** `packages/eval/src/machines/evalRun.ts:91` and `:163-167` (`questionFailed` goes to `#failed`); docstring at `:76` ("A failed question fails the run").
- **Evidence:** `scratch/notes/eval.md` ("A failed judge call fails the question and the run"); decision log 2026-10-23 ("a run was lost to a single stalled call", fixed by one blind retry in `ollamaLlm.ts:31`). Round 2 generation logged 2 "ollama chat unreachable" failures (`generate-r2.out`).
- **Lens:** 4, 5.
- **Kind:** evidence-resolvable. Check: kill Ollama mid-run on the mini set; compare with a run that records the failure and continues.
- **Proposed direction:** Record a failed question as a result row with its error and carry on; report the failure count in the summary. With F2 in place a rerun skips finished calls.
- **Plain-language line:** A long evaluation can die at question 80 of 100 because the laptop slept, and you start again from the beginning.

### F4. Formula decoding is carried by five packages for a build nobody has run
- **Finding:** The optional decoding path adds a second recipe for every document, a view renderer, a re-chunk-to-embed path, a sidecar command and four Python dependencies. The default recipe uses none of it.
- **Where:** `chunk/src/render.ts` (71 lines, plus `blocks.ts` helpers and `FORMULA_MEASURE` rules in `chunker.ts:62-66,117`); `ingest/src/steps.ts:25-33` (stores plain and full parse recipes), `:108-135` (`decodeFormulas`), `:186-236` (`embedOtherDocuments`, re-runs the chunker on other documents' artifacts to embed missing vectors), `ingest/src/deps.ts:15-43`; `parse-sidecar/src/kg_parse/formulas.py` (138), `decoder.py` (51); `pyproject.toml:8-11` (mlx-vlm, pypdfium2, pillow, huggingface-hub exist only for decoding; docling alone does parsing).
- **Evidence:** Spike: 82% exact against a 90% rule, hand-query MRR 0.671 to 0.598 with decoding (Q6). Baseline froze undecoded (Q13); the follow-up build is "not started" (`sprint-2/brief.md`). The renderer threw on inline groups in Sprint 1 review, so it was untested on real input.
- **Lens:** 2.
- **Kind:** needs the user (Q13 follow-up, Q17).
- **Proposed direction:** Do not delete now, since Q17 may schedule the decoded build. If Q17 does not, remove the render, re-chunk and decode paths and four sidecar pins. Meanwhile, keep it out of any new work.
- **Plain-language line:** A lot of code exists so that equations could one day be read as LaTeX. The tests so far say it makes search slightly worse, and the experiment that would decide has not been run.

### F5. The multi-hop questions are built from passages that search already pairs
- **Finding:** Two thirds of multi-hop groups are chosen by asking the index for the 8 passages most similar to a seed passage, and one third are adjacent chunks. A question answered from such a pair cannot show that a graph walk finds links similarity misses.
- **Where:** `packages/app/scripts/baseline.ts:94-103` (the `search` call, `k: 8`, and the `pick` of the first 1 to 2 siblings).
- **Evidence:** `scratch/sprint-2/results.md` point 4: all-gold@5 is 0.92 for multi-hop and 0.95 for single-hop, "built from passages that retrieval itself considers similar, so they come out easy". Only 12 multi-hop questions survived review.
- **Lens:** 1, 5.
- **Kind:** needs the user (Q16 and Q17 decide which generator and which corpus).
- **Proposed direction:** Whatever generator Q16 picks, choose multi-hop groups by structure the baseline cannot see: a shared named entity across distant sections, or the cited-works pairing in Q15. Record the linking rule in the eval set.
- **Plain-language line:** The test for "questions that need several passages" mostly contains questions that plain search already gets right, so it cannot tell us whether the knowledge-graph layers are worth building.

### F6. The generator's multi-group loop is bypassed; set assembly lives in scripts
- **Finding:** The generator is built to process many groups and dedupe across them, but the real driver calls it once per group with its own failure handling and dedupe.
- **Where:** `packages/app/scripts/baseline.ts:140-153`, merge and exclusion at `:164-190`; `eval/src/machines/evalGenerate.ts:133-188`.
- **Lens:** 1, 3. **Kind:** arbitrary (the same questions come out).
- **Proposed direction:** Make the package function take one group, add one exported "continue past failures" helper, and move set assembly into `@kg/eval`.
- **Plain-language line:** Making a question set for a new corpus means copying a long script, not calling a tool.

### F7. The prompt digest ties the judge's identity to the question-writing prompts
- **Finding:** `promptDigest()` hashes every `.md` in the directory, so editing a generation prompt changes the judge recipe id.
- **Where:** `packages/eval/src/prompts/loader.ts:47-50`; used with no argument at `prompts/judge.ts:49` and `prompts/generate.ts:132`; `machines/pins.json` shows the identical digest `576f82d4…` for `judge@1` and `eval-generate@1`.
- **Evidence:** Raised as a nit in `scratch/sprint-1/review-ingest-eval-viewer.md` ("editing `answer.md` changes the judge recipe id"); still unchanged. The judge validation (kappa 0.74) is attached to a recipe id that any prompt edit would silently move.
- **Lens:** 1 (Rule 4).
- **Kind:** evidence-resolvable. Check: edit `generate-topic.md` and compare `judgeInfo().recipeId` before and after.
- **Proposed direction:** `promptDigest(files)` hashing only the files each machine uses (about three lines); re-pin.
- **Plain-language line:** Changing a question-writing prompt would make a run look as if the judge had changed, so the "judge was validated" claim stops matching the recipe.

### F8. Retry machines guard a failure that did not happen
- **Finding:** The judge (79 lines) and the generator each run a retry loop for malformed JSON replies.
- **Where:** `eval/src/machines/judge.ts:42-79`, `machines/retry.ts`, `machines/settle.ts` (a helper only to run a machine to the end), `prompts/judge.ts:23-28`.
- **Evidence:** Judge parse failures 0 of 252 (`results.md`); generation drops were 34 wording-copy and 1 `uses` error out of 35 (`scratch/sprint-2/dropped-kardar.json`). `ollamaLlm.ts:23` already asks Ollama for JSON.
- **Lens:** 2.
- **Kind:** arbitrary (a function with a for-loop and the same strict parser gives the same scores).
- **Proposed direction:** Keep `parseJudgeReply` (strict, tested). Replace the machine with a bounded loop in a function. If failures ever appear, use Ollama's schema-constrained `format` before adding any retry logic.
- **Plain-language line:** A safety net for garbled judge replies, which has caught nothing in 252 judgements, accounts for much of the judging code.

### F9. The search state carries machinery for decomposition that is not built
- **Finding:** Each search builds a state with `queries` (with origin and parent), `seeds`, `pools`, `notes`. `vectorKnn` supports named pools with a `{queryId}` template. Only one query and the candidate list are ever used.
- **Where:** `packages/search/src/service.ts:75-84`; `steps/vectorKnn.ts:14-21,53-80`; `steps/truncate.ts` plus the service slice at `service.ts:90` (top-k is done twice).
- **Evidence:** Pools were designed as P-1 and deferred (`notes/pools.md`, Sprint 0 retro); a Sprint 1 review mutant (`pool+1`) survived here (`review-chunk-embed-parse-search.md`, item 3).
- **Lens:** 2.
- **Kind:** arbitrary (v0 results are identical).
- **Proposed direction:** Needed later, when decomposition or graph walk is scheduled. Defer, but note that `knn` plus slice is the whole v0 search; do not extend pools further until a consumer exists.
- **Plain-language line:** Search is built for features that do not exist yet; this makes a "top 5 passages" call heavier to understand than it needs to be.

### F10. The wording-copy rule discards half the drafts and checks only copying
- **Finding:** The generator drops any question that shares four consecutive words with its gold passage. It cannot detect other leakage and may bias toward vague questions.
- **Where:** `eval/src/machines/evalGenerate.ts:51-65,97`; `prompts/generate-single-hop.md` (the same rule in the prompt).
- **Evidence:** 34 of 62 round-1 Kardar drafts in generate.out were dropped by it ("group 60/67: 27 questions, 31 dropped"); `results.md` itself says the rule "dropped about half of all drafts (a possible bias towards vague wording)". No-context answers score 0.73 to 0.80, so many surviving questions do not need the passage.
- **Lens:** 5.
- **Kind:** evidence-resolvable. Check: run only search (no model) for the dropped questions' text against their gold chunks, and compare recall@1 with the kept ones. If dropped questions retrieve about as well, the rule is costing generation time (about 7 s per kept question) for little protection.
- **Proposed direction:** Keep the rule if the check shows kept questions retrieve worse; otherwise relax to five words and add the no-context score as the leakage filter.
- **Plain-language line:** Half the questions the local model wrote were thrown away for sounding like the book, and we do not know whether that made the test fairer or only slower.

### F11. Sprint 1 review nits in parse are still open
- **Finding:** No timeout on the sidecar call; `ArtifactDirParser` validates every artifact in the folder per call, so one corrupt file blocks all lookups.
- **Where:** `parse/src/subprocess.ts:28`; `parse/src/artifactDir.ts:21-23`; `review-chunk-embed-parse-search.md` nit 6.
- **Lens:** 1. **Kind:** arbitrary (no effect on the stat-mech corpus).
- **Proposed direction:** Add a timeout; filter artifact names by hash prefix first.
- **Plain-language line:** A hung PDF parse stalls ingest silently, and one damaged imported file breaks all imports.

### F12. A recipe is validated twice, in two languages
- **Finding:** Python `validate_recipe` repeats checks that core's `parseRecipeSchema` does, and a second canonical-JSON function exists for hashing.
- **Where:** `parse-sidecar/src/kg_parse/recipe.py:30-36,44-73`; `parse/src/subprocess.ts:68-69`. A cross-language test pins the hash (`scratch/notes/parse-sidecar.md`).
- **Lens:** 3. **Kind:** arbitrary (keep it if the sidecar must run alone on a GPU server, decision log 2026-10-17).
- **Proposed direction:** Reduce the Python check to building docling options and refusing unknown keys.
- **Plain-language line:** Parser settings are checked twice by two programs that must agree.

### F13. The chunker's review loop cost far more than its size
- **Finding:** Chunker source is 445 lines, tests 840 (`chunk/test/freeze.test.ts`, 372). Sprint 1 left 16 of 28 mutants alive; the freeze ran 91 more (5 equivalent survivors, `scratch/notes/chunk-freeze-tests.md`).
- **Lens:** 4. **Kind:** arbitrary (a process observation; the frozen chunker stays).
- **Proposed direction:** Do not rewrite. For the next recipe version, pin behaviour with goldens on three real documents plus the insertion-stability test, not hand-written boundary mutants.
- **Plain-language line:** The piece that decides every passage ID was cheap to write and expensive to trust; changing it means new IDs and new eval questions.

## Concepts in this area

| Concept | Status |
|---|---|
| Parse artifact as portable docling JSON, keyed by (sha256, recipe) | needed now |
| Parse recipe (docling options + version pin) | needed now |
| Formula-decoding recipe, plain/full recipe pair, chunk view (`placeholder`/`full`) | needed later (F4) |
| Chunk recipe `section-pack/1` + frozen ids | needed now |
| Space/embedding digest pin, query/document templates | needed now |
| Item kinds, `withSummaries` recall column | needed later (no summaries exist) |
| Search recipe = machine name + version + settings + topology | recipe: needed now; topology fingerprint: only serves the machine concept (F1) |
| Named pools, seeds, notes, query variants in search state | needed later (F9) |
| Pipeline state machines, map, Mermaid, pins, routing states | needed only for later loops; serves viewer drawing (F1) |
| Ingest `embedOtherDocuments` / `gate` (repair of missing vectors) | needed later (space switch, Q4) |
| Eval conditions (no-context, gold, retrieved, oracle) | needed now |
| Judge recipe, answerer record in run, prompt digest | needed now (F7 fix) |
| Retry-with-history machine | unused so far (F8) |
| Replay cache | needed now, missing (F2) |

## Hand-rolled pieces

- Chunker (`chunk/src`): docling `HybridChunker` was compared and rejected on evidence (decision log 2026-10-17). Replacing it puts every chunk id under a Python library's output. **Keep.**
- Ollama clients (`embed/src/index.ts`, `app/src/ollamaLlm.ts`, plus a copy in the hidden skeleton): the `ollama` npm package would replace the fetch and error mapping, but the digest check, `truncate:false` and L2 normalisation stay ours. **Keep; share one base-URL and timeout helper.**
- Recall and judge-mean metrics (`eval/src/metrics`, 96 lines): ranx and ir-measures are Python. **Keep.**
- Strict JSON reply parsers (`prompts/parse.ts`): **Keep.**
- Search settings validator imitating zod (`search/src/machines/similarity.ts:23-49`): zod is already in core, so this adds no concept. **Replace when F1 and F9 are decided.**
- Pipeline map and topology (`pipeline/src/map.ts`): **drop with F1**, not replace.
- Question generation and judge frameworks (Ragas, promptfoo): they add test-set graphs or plugin configuration the tool does not need. **None recommended.**

## Surprises

- `llm.called` records hashes only, so the log cannot show what the judge said; answers and verdicts survive only in the results table and the `run-*.json` exports.
- The judge validation agrees with another model (kappa 0.74), but that scorer disagreed with itself on 6 of 30 rows (`RESULT.md`); condition gaps under about 0.15 are not interpretable.
- The multi-hop and topic subsets (12 and 11) are reported as bare means (`analyze.py`, 63 lines); the judge validation bootstrapped, so the tooling exists.
- Ingest's `embedOtherDocuments` (`steps.ts:203-236`) re-runs the chunker on old artifacts, which makes chunker determinism a permanent obligation.
- Sprint 1 review "nits" (prompt digest, parse timeout) never entered the fix lists, so the review loop's output is only partly applied.
