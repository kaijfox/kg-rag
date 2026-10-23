# Open questions for the user

Each entry gives: the question, the options, what each implies for scope, cost and later layers, a recommendation, and what stays blocked until it is answered.


## Q1. Builds in v0 (2026-10-17)
Question: add builds to v0, although the design's v0 section does not mention them?
Options: (a) yes, content-addressed builds created by every changing ingest; (b) no, and search filters by a "current chunks" view.
Implications: (a) satisfies Rule 6 (events record the build), keeps superseded chunks out of results, and exercises the recipe/build model before the relation layer needs it; costs one modest package. (b) is smaller but Rule 6 then has nothing to record, and the first expansion would have to retrofit builds under pressure.
Recommendation: (a). Blocks: the store schema and `ingest`.

## Q2. Logging below the MCP layer (2026-10-17)
Question: may logging live in the shared tool layer that MCP exposes one-to-one, rather than in the MCP adapter?
Options: (a) log at the tool contract (`KgApi`), MCP a thin adapter, eval calls the same API; (b) log in the MCP server and run eval through an in-process MCP client.
Implications: both give one path for agent and eval events. (a) keeps MCP trivial and makes tests need no transport; it amends the design sentence "logging is a property of the MCP tool layer". (b) keeps the sentence literal and adds transport to every eval run.
Recommendation: (a). Blocks: the `api` and `mcp` contracts.

## Q3. LLM for eval generation and judging (2026-10-17)
Question: which provider writes eval questions and judges answers?
Options: (a) Claude API behind a replay cache; (b) local Ollama model; (c) Claude for generation and judging, local model for answering.
Implications: (a) gives better questions and a more trustworthy judge, small per-run cost, reruns free via the cache; needs an API key. (b) is free and offline, but leakage of passage wording and a weaker judge risk Phase 4 conclusions; the judge must still pass hand-scored validation. (c) is a middle path.
Recommendation: (a). Blocks: eval prompt work and Phase 4 only; the metrics code is unaffected.

## Q4. May the project pull more Ollama embedding models for a comparison? (2026-10-17, Phase 1)
Question: Phase 1 was told not to pull models, so only embeddinggemma (the one installed) was measured. Should a
later phase pull two or three candidates (e.g. bge-m3, nomic-embed-text, qwen3-embedding:0.6b) and compare them
on the same 31 queries and, better, on the Phase 4 eval set?
Options: (a) yes, before Phase 4, on the hand queries (about 1-2 GB of downloads, an hour of work); (b) yes, but only
after the Phase 4 baseline, as an embedding-model experiment against the pinned eval set; (c) no, stay with
embeddinggemma until the GPU server exists.
Implications: the embedding space is keyed by model and templates, so a switch re-embeds 312 chunks (about 8 s
here) and changes no chunk ID or eval question; the only cost is disk and time. (a) risks tuning to my 31 queries;
(b) measures on the real eval set, but the baseline numbers would then be for embeddinggemma; (c) costs nothing now.
Recommendation: (b). Proceeding provisionally with embeddinggemma:latest and its retrieval prompts (DEFAULT_SPACE).
Blocks: nothing before Phase 4.

## Resolved 2026-10-17
Q1 yes (builds in v0). Q2 yes (log below MCP). Q3 local Ollama for all LLM calls for now. Q4 resolved by the lead under the standing cheap-option instruction: option (b), more embedding models after the Phase 4 baseline. See decision log.

## Q5. What to do with the finished skeleton code that duplicates five Phase 2 packages (2026-10-17, Phase 1 review S7)
Question: `packages/app/src/skeleton` holds working versions of `chunker`, `ingest`, `search`, `api` and the Ollama embedder (about 640 lines) that already pass the required suites. Should Phase 2 re-implement those packages from their cards, or start from this code?
Options: (a) promote the files into their packages, so Phase 2 for those five becomes review plus the missing tests; (b) keep them under `app/src/skeleton`, tell implementers not to read them, and use them as a reference to diff implementer output against; (c) delete them once the packages exist.
Implications: (a) is cheapest and fastest but removes the roadmap's measurement of whether cheap models can build a package from card, core and testkit alone, and carries any hidden coupling the skeleton author brought. (b) keeps the measurement and adds a free oracle, at the cost of five cheap-model package builds. (c) is (b) with less safety.
Recommendation: (b) for `chunk` and `search` (the two most consequential), and your call on the rest. Provisional default: (b) for all five; moving files later is a few minutes. Blocks: the Sprint 1 plan only.

## Resolved 2026-10-18
Q5 option (b): skeleton stays hidden under `packages/app/src/skeleton`, implementers do not read it, and it is used as a reference oracle (user approved the recommendation).

## Q6. Should formula decoding enter the v0 parse recipe? (2026-10-18, formula-VLM spike)
Question: given the spike numbers, do you want formula decoding as part of the default parse recipe, as an optional post-pass recipe, or not at all for v0?
Options: (a) default recipe: decode display formulas with GLM-OCR 4-bit on MLX (about 4 min for the corpus, 2 GB RAM, new chunk IDs, chunker boundaries shift, 312 to 440 chunks); (b) optional post-pass recipe over the portable parse artifact (needs the PDF and an MLX or GPU runtime), judged on the Phase 4 eval set; (c) no decoding in v0, placeholders stay.
Implications: the best candidate scored 82% exact on 33 hand-checked crops (the rule asked for about 90%) and the retrieval pilot regressed slightly (31 hand queries MRR 0.671 to 0.598), so (a) is not supported by the evidence. (b) keeps the option and a possible variant (embed the placeholder, store the LaTeX) without touching the default; it still changes chunk IDs for any document that uses it, so it must be decided before the chunker freeze if it is ever to be the default. (c) costs nothing. A GPU server is not needed for speed.
Recommendation: (c) for v0 and a note that (b) is cheap to add later; decide (a) only from Phase 4 evidence on formula-dependent questions. Blocks: nothing in Sprint 1; the recipe decision must precede the chunker freeze before Phase 4 eval question generation.

**Status 2026-10-18 (triage): resolved in part.** The user's state-machine plan (section 13) put formula handling in v0 as option (b): an optional decoding stage plus an embedding view setting (contract 0.6.0, built in parse-sidecar, ingest and chunk). The default recipe has no decoding, which is option (c) for the baseline. What remains is Q13 (confirm the baseline freezes on the undecoded recipe).

## Q7. Pull a small Qwen-VL (about 1.8 GB) and more OCR VLMs for the formula comparison? (2026-10-18, formula-VLM spike)
Question: the spike stayed near 3.5 GB of Hugging Face downloads and did not pull Qwen3-VL-2B-4bit (1.78 GB), Qwen2.5-VL-3B (3.1 GB), olmOCR-2 7B 4-bit (5.6 GB), dots.ocr (3.5 GB) or Nougat (2-2.8 GB). Allow more?
Options: (a) no, the installed 9.7B Ollama model already represents general VLMs (61% exact, slow); (b) yes, Qwen3-VL-2B only; (c) yes, also a page-level OCR model.
Implications: (b) costs 1.8 GB and about 20 minutes and could change the ranking only if it beats GLM-OCR's 82%, which is unlikely for a general 2B model; (c) tests page-level OCR as an alternative to cropping, a different pipeline that would replace docling's text layer, not a drop-in. Recommendation: (a). Blocks: nothing.

**Status 2026-10-18 (triage): resolved, not as recommended.** The follow-up spike pulled and ran Qwen3-VL-2B 4-bit (option (b)); it was less accurate than GLM-OCR (15 to 20 of 33 exact against 27, 82%). No decision-log entry records the permission to pull. Page-level OCR models were not tried; nothing needs them now.

## Q8. Make ingest resumable with persisted state-machine snapshots in v0? (2026-10-18, state-machine spike)
Question: the spike's pre-set rule for ingest is met (resumable per-document stages, JSON snapshots, unchanged event catalog). Do you want it in v0?
Options: (a) adopt now in the `ingest` package only (XState inside ingest, nowhere else); needs a vector checkpoint and an insert-only snapshot store (proposal CP-SM-3) and documents ingest events as at-least-once across a resume; (b) keep the skeleton's single-pass ingest for v0 and revisit if runs get interrupted; parse is already durable and cached by (sha256, parse recipe), so what resume adds is embedding progress; (c) adopt only the part that does not need XState: the vector checkpoint plus a resumable plain loop.
Implications: (a) is 245 lines against 146, adds a 13 KB (gzip) dependency to one package, and puts an extra table or files next to the database; its measured behaviour is in `scratch/sprint-1/spike-state-machine/results.md` section 5 (50 simulated crash points, identical final build every time, no event lost, at most 9 texts re-embedded). (b) costs nothing now and loses nothing that cannot be added in Phase 3. (c) is untested.
Recommendation: (b) for v0, with the checkpoint and snapshot contract text (CP-SM-3) kept as a proposal; the rule is met but the v0 benefit is small. Blocks: the `ingest` package hand-off (card text differs between (a) and (b)).

**Status 2026-10-18 (triage): resolved, option (b).** The user decided no pause, resume or snapshots (`state-machine-revision.md`, Decided 3). Ingest was built as plain run-to-completion machines, all-or-nothing per call. CP-SM-3 is dropped. Reopen only if Phase 4 ingest runs get interrupted (embedding 312 chunks takes 8 s, so unlikely at this corpus size).

## Q9. Add a `repeat` loop construct and a `fuse.from` pattern to the search contract? (2026-10-18, state-machine spike)
Question: instead of machines, extend the recipe data model with `{type:'repeat', params:{max, steps:[...]}}` (`done` ends the loop) and let `fuse.from` take a prefix pattern. Both are core contract text (proposals CP-SM-1, CP-SM-2 in `scratch/sprint-1/contract-proposals.md`).
Implications: replaces the deferred P-2a (done skip and `final` marker) and P-2c; the prototype runner is 22 lines; affects the search runner, step conformance (a loop case), the viewer (repeated step types in one search), the search card. Recommendation: adopt both before the `search` package is handed off. Blocks: the `search` package hand-off.

**Status 2026-10-18 (triage): moot.** The user chose machines for all pipelines (Decided 1), so `repeat` and the `fuse.from` pattern are not needed; loops are moves back to an earlier state. CP-SM-1 and CP-SM-2 are dropped. The one open point carried over: no v0 machine uses a loop, so the claim that loops need no special construct is untested until query refinement.

## Q10. Add the missing `pipeline.started` to the cut-off search in `session-live-partial`? (2026-10-18, viewer)
Question: the live fixture's second search has `query` and one `search.step` but no `pipeline.started`, although every search writes it right after `query`. The viewer therefore cannot draw the live overlay on any fixture. Patch the fixture?
Options: (a) yes: testkit inserts `pipeline.started` after seq 11 (the same payload as the other searches) and renumbers seq; the viewer adds a live overlay test on the real fixture; (b) no: the fixture stays as recorded and the live overlay is tested only on a synthetic prefix; (c) add a new fixture for a live search instead of changing this one.
Implications: (a) changes a committed testkit fixture, so the testkit README and the fixture's seq numbers change; no other package's test depends on that search's seq (checked for the viewer only). (b) keeps the fixture as it is and leaves a gap between the contract and the recorded live case. (c) adds a file and keeps the old fixture as a record of the cut-off shape.
Recommendation: (a). Blocks: nothing in the viewer; the live overlay works and is tested on synthetic events.

## Resolved 2026-10-18 (lead, autonomous)
Q10 (viewer fixture) option (a): fixture patched. This entry had been written twice; one copy removed.

## Q11 (was written as a second Q10). Validate the judge against hand-scored examples before any eval number is reported (2026-10-18, eval package)
Question: who scores the hand-scored examples the judge is checked against, and how many are needed before a judge score is trusted?
Options: (a) the user scores about 30 answers from the mini set (three conditions, all types) by hand; the judge's agreement with those scores is reported before any eval run is used; (b) a smaller check of 10 answers, with agreement reported as a range; (c) no validation, judge scores reported with a caveat.
Implications: (a) costs about an hour of reading and gives a number to quote; (b) is quicker and noisier; (c) leaves every eval result exposed to the weak local judge the card warns about. The package has the judge, the strict parser and the retry budget, but no hand-scored set: the judge fixture is scripted, not a model check.
Recommendation: (a). Blocks: any eval result reported beyond a smoke run; the eval-design review in Phase 2.

**Status 2026-10-18 (triage): decided, work pending.** The user decided on 2026-10-18 (decision log, Sprint 1 additions item 4) to use an agent-scored sample of about 30 answers and no human scoring, which is a variant of (b)/(a) without the user's time. The plan and agreement script exist (`scratch/sprint-1/judge-validation/`); the run has not been done. The plan's acceptance thresholds must be written into the decision log before the first look (not yet done). Reported numbers so far (judge mean 1.0 in the integration run) are not trusted; the judge scored 1.0 on a gold-condition answer that began "Based on my own knowledge".

## Remaining for the user (2026-10-18, end of Sprint 1)

Q12 to Q15 are new. Q1 to Q11 are answered or moot (statuses above).

## Q12. Approve the proposed design-doc amendments AM-1 to AM-6 (and AM-8) (2026-10-18, triage)
Question: the roadmap sends any change to a core concept, a rule or the v0 scope to you, and these Sprint 1 decisions were built into contracts 0.4.0 to 0.6.1 without a matching design text. Which drafts in `scratch/sprint-1/proposed-amendments.md` may be recorded in `design/260916_initial-roadmap.md`?
Options: (a) approve all six (AM-1 machines, AM-2 formulas, AM-3 producer pinning, AM-4 run records and judge validation, AM-5 pointer moves, AM-6 settled stack) and the roadmap note AM-8, with edits you mark; (b) approve some; (c) reject one and record that the code is the authority.
Implications: AM-1 and AM-2 describe things you already decided, so (a) mostly records history; AM-3 to AM-5 are small readings of Rules 4 and 6 and Builds; AM-6 retires the Tentative Defaults paragraph. Not approving leaves the code ahead of the design, which makes the next relation-layer plan harder to trace. AM-7 (derived item identity) is held and is not part of this question.
Recommendation: (a). Blocks: nothing in code; the Sprint 2 plan cites the amendments.

## Q13. Which parse recipe do the chunker freeze and the Phase 4 baseline use? (2026-10-18, formula entries; supersedes the open part of Q6)
Question: decoded formulas change chunk text and therefore chunk IDs and every eval question on those documents, so the recipe must be fixed before question generation. Freeze on the default undecoded recipe (formulas as placeholders)?
Options: (a) yes, undecoded baseline; decoding is later tried as a separate recipe and build on the same eval set; (b) decoded baseline with GLM-OCR; (c) freeze both and generate questions for both.
Implications: (a) matches the evidence (82% exact against a 90% rule, retrieval MRR 0.671 to 0.598 with decoding) and keeps the baseline cheap; the formula experiment then compares builds, which the build model supports, but only for documents whose chunk IDs survive, and a decoded recipe changes all chunk IDs of documents with formulas (so questions would be regenerated for it). (b) adds 4 minutes of decoding and 440 chunks against 312 for a feature the pilot did not support. (c) doubles question generation.
Recommendation: (a). Blocks: the chunker freeze, hence eval question generation.

## Q14. Commit the Sprint 1 state? (2026-10-18)
Question: git holds one commit (Sprint 0 state, da018a2); 218 paths are modified or new. May the lead commit the Sprint 1 state in one commit?
Options: (a) one commit now, before Sprint 2 starts; (b) wait until the amendments are applied; (c) a series of commits per package.
Implications: nothing is lost if the work stays uncommitted, but all four review passes and the mutation runs were against the working tree, and no agent may run checkout or restore, so a commit is also the only safety net. (b) delays that; (c) takes effort for little gain.
Recommendation: (a). Blocks: nothing.

## Q15. Use the two arXiv papers with LaTeX source as a second Phase 4 corpus? (2026-10-18, arXiv entry)
Question: the design lists second-corpus question generators as use-case-triggered work, and the Phase 4 corpus was settled as stat-mech. Do you want the arXiv formula and cross-corpus test inside the baseline, after it, or not?
Options: (a) after the baseline, as a formula experiment (first look at the papers, check the cited works are downloadable); (b) inside the baseline, which delays question generation; (c) no.
Implications: (a) keeps the baseline comparable and uses the same tools (the LaTeX source gives exact references for decoding quality at scale, replacing the 33 hand references). (b) mixes two corpora before the first measurement. Tagging formula questions in the stat-mech set is cheap and goes ahead under any option.
Recommendation: (a). Blocks: nothing before the baseline.

## Resolved 2026-10-23
Q12 approve all (applied to design/). Q13 option (a), with a required decoded-formula follow-up build. Q14 moot (committed). Q15 option (a), clarified: each arXiv paper is its own corpus, used as a review-plus-cited-works pair with validated equations.
