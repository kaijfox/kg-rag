# Design feedback: entries as written, before the end-of-Sprint-1 triage (archive; outcomes are in scratch/design-feedback.md)

Open entries are at the top; triaged entries move to "Resolved". An entry is plain prose and says:
- what was observed, with evidence (numbers, a failing case, a file);
- which part of the design doc it bears on;
- what it might mean (scope that could grow, a useful capability, a choice that may cause trouble later, or something that does not work as specified);
- how sure the author is, and what would settle it.

## Open

### 2026-10-18: the search log is large and cannot say where a failed search stopped (integration run on the stat-mech corpus)
Observed on a real database (312 chunks, one build, about 50 searches). Every `search.step` carries the full `considered` list, and `vector-knn` with pool 100 followed by `truncate` writes the 100 candidates twice: 18.2 KB for the retrieve step and 9.5 KB for the cut step, about 28 KB of events per search, so the log (about 2 MB) is already larger than the 312 stored vectors (about 1 MB) in a 3.3 MB file. At the Phase 4 scale (thousands of eval searches, several machines with more steps) the log will dominate storage and the viewer's per-poll payloads. Separately, a search that fails inside the machine (embedder unreachable) logs `pipeline.finished` with `state: "failed"`, the final state, not the work state that threw; the only hint that it was `retrieve` is the absence of a `search.step`. Bears on: design doc Rule 6 and the logging section (what an event must record to diagnose a result), v0 item 4. Meaning: either log `considered` as a delta (ids kept, dropped, new) after the first step, and record the failing state, or accept the size and say so. Confidence: high on the numbers, moderate that size matters before Phase 4. Settling it: the size of the log after the Phase 4 baseline run.

### 2026-10-18: Phase 4 idea: formula and retrieval tests from arXiv papers with LaTeX source (user suggestion)
Observed: nothing yet; this is a plan for Phase 4. The stat-mech corpus gives only hand-corrected references for formula decoding (33 items) and says little about whether retrieval and, later, graph encoding handle formulas well. Papers on arXiv whose LaTeX source is available give exact ground truth: the PDF render is what we ingest, the source is the truth. The user named two candidates (arXiv 1901.10416 and 2102.12086; not yet looked at). Two uses: (1) decoding quality at scale, comparing decoded formulas to the source LaTeX, which replaces hand-checking; (2) cross-corpus questions (the second-corpus test generators in the design doc): a tutorial or review with source available writes the questions, and answers are looked for in the PDFs of the works it cites. Also useful: tag questions whose gold passages contain formulas, so the three answer conditions can be compared on that subset, and run an oracle (decode only the gold passages) to bound what better formula text could add. Bears on: roadmap Phase 4, design doc eval harness (question generation, second corpus), v0 item 1 (parse recipe). Confidence: high that source-available papers make a stronger formula test than hand references; unknown whether the two named papers fit (length, math density, how many cited works are retrievable). Settling it: look at the two papers and check the cited works are obtainable as PDFs.

### 2026-10-18: explicit state machines: not worth it for search, rule met for ingest resume (state-machine spike, Sprint 1)
Observed against core 0.4.0 with XState 5.33.3 (0 runtime dependencies; 13 KB gzip for the API used) and robot3 1.4.0, running the shipped conformance suites against both designs (code and 95 tests in `scratch/sprint-1/spike-state-machine/`, findings in its `results.md`). Search: `vector-knn`+`truncate`, decomposition with per-subquery pools and RRF, and the critique loop all work as machines with the same plain steps; event logs equal the runner's, nested tool calls link through the actors (`AsyncLocalStorage` is inherited from whoever causes the transition, so it holds only if actors are started inside the handler). But the pipeline code is 104 lines against 15 for the runner (22 for a runner with one data construct, `repeat`, for bounded loops), and a pipeline's shape becomes code plus a version bump instead of recipe data. A recipe hash needs a topology pin to be as strong as today, and a guard-body change is invisible to it (only a golden run catches it; the runner has the same blind spot for step code). Ingest: per-document actors with JSON snapshots (at most 2 KB, no vectors) resumed to the identical build and events from all 50 simulated crash points (after every snapshot, and after every emitted event); events become at-least-once across a crash window (up to 3 duplicates in one case), the in-flight embedding batch (at most 9 texts) is redone, and it costs 245 lines against 146 plus a vector checkpoint and a snapshot store (an insert-only table, since S-1 allows only two mutable rows). Two incidental findings bear on the current design: `fuse.from` as a static pool list breaks when a model chooses the number of sub-questions, and a naive resume mislabels `build.created.revert` after a post-commit crash unless the build is planned before the transaction.
Bears on: roadmap search and ingest design (recipes as data, logging), core `ports/search.ts` (fuse, loops), lifecycle S-1 and the ingest events (at-least-once).
What it might mean: keep the runner; add `repeat` and a fuse pool pattern (CP-SM-1, CP-SM-2); decide whether resumable ingest is wanted in v0 (Q8). Confidence: high for the search numbers and for the ingest mechanics on the in-memory fake; moderate that the same holds on SQLite (the checkpoint and snapshot storage are untested there) and that resume matters in practice (parse is already durable and cached, so the saving is mostly embedding progress). Settling it: time a real 337-chunk embedding on Ollama and how often runs are interrupted.

### 2026-10-18: formula decoding on the Apple GPU is cheap but not clearly useful for retrieval (formula-VLM spike, Sprint 1)
Observed on 33 gold crops (29 display, 4 inline Kardar) with references from docling's CPU CodeFormulaV2 stage, hand-corrected (18 of 33 needed correction), and one full-corpus run. Speed: docling's CPU path is 24 s per formula, about 4.1 hours for the 605 display formulas; the same CodeFormulaV2 driven directly on MPS gives identical-or-token-equal output (29 of 33) at 1.3 s, 15 min for the corpus (docling's own stage refuses MPS, its supported devices are CPU/CUDA/XPU). GLM-OCR 4-bit on MLX (1.25 GB) decoded all 605 formulas in 258 s with no failures, peak 2.0 GB, and has the best accuracy: 27 of 33 normalized exact (82%, 95% interval about 70-94%), 1.4% mean token edit distance; PaddleOCR-VL 4-bit with a tight crop 76%, CodeFormulaV2 61-67%, Granite-Docling-258M MLX 58-67% (the only one reachable through docling's own `code_formula_options`, verified on one page), texify 55%, a 9.7B Ollama VLM 61% at 3.5 s each, pix2tex 30%. The decision rule (full corpus under about 30 min, at least about 90% exact, retrieval pilot shows no harm) is therefore met on speed, missed on accuracy (82%; 91% only if the crossed-d and two crop artifacts are forgiven, post hoc), and not met on retrieval: with the same chunker and embeddinggemma, replacing `[formula]` by decoded LaTeX moved the 31 hand queries from MRR 0.671 to 0.598 (hit@5 0.87 to 0.81) and chunks from 312 to 440; on 10 new formula-referring prose queries MRR fell 0.850 to 0.662, and on 10 LaTeX-fragment queries (biased toward decoding) it fell 0.577 to 0.355 even though 5 of the 10 improved. Raw glyph names as text were no better. Bears on v0 item 1 (parse recipe), Scale and Cost (a GPU server is not needed for formula decoding speed), and the chunker freeze (decoded formulas lengthen chunks and shift boundaries). It also shows that the 18% crop margin in docling's formula stage makes CodeFormulaV2 transcribe neighbouring prose lines, and that any decoder's accuracy depends on the margin (4% helps three models and hurts two). Meaning: formula decoding looks affordable but is not a clear retrieval win; if wanted, it fits as an optional post-pass over the portable artifact (a new parse recipe, new chunk IDs), possibly embedding the placeholder while storing the LaTeX, rather than a default. Confidence: speed numbers high; accuracy moderate (n=33, references partly derived from one of the candidates, normalization tuned while looking at failures); retrieval low (31 + 20 queries, one embedder). Settling it: the Phase 4 eval set with formula-dependent questions, and a blind second reader for the gold references. Details: `scratch/sprint-1/spike-formula-vlm/results.md`.

### 2026-10-18: formula decoders compared by LLM-judged meaning: GLM-OCR 94%, Qwen3-VL-2B not better (formula-VLM follow-up, Sprint 1)
Observed on the same 33 gold crops. Qwen3-VL-2B 4-bit (`mlx-community/Qwen3-VL-2B-Instruct-4bit`, 1.8 GB) runs on the Apple GPU at about 1 s per formula (about 10 min for the 605 formulas, 2.3 GB peak) but is less accurate than GLM-OCR: 15/33 normalized exact at the docling crop and 20/33 at a 4% crop, against 27/33 and 22/33 for GLM-OCR. A second metric, a local qwen3.5 judge (temperature 0) asked whether the candidate and reference denote the same mathematical statement, gives a higher rate for nearly every model because exact match punishes equation numbers, array wrappers and the crossed-d: GLM-OCR 31/33 (94%), PaddleOCR-VL tight 30/33 (91%), Granite 29/33, texify and Qwen3-VL tight 28/33, CodeFormulaV2 on MPS 21-22/33 (its output carries neighbouring prose). Reading the 5 "different" verdicts of the top two by eye: 2 are real errors (the same `\partial/\partial\mu` misread), 2 are correct equations with a stray sentence attached, 1 is a judge mistake. So the semantic rate of the best decoder is about 94-97%, above the plan's 90% bar, while the retrieval pilot is unchanged (decoding still did not help MRR). Bears on v0 item 1 (parse recipe): a decoded formula is probably good enough for an LLM to read at answer time, which separates "usable as context" from "useful as retrieval text". Meaning: if formulas are decoded, store the LaTeX for the generation step and consider keeping the placeholder in the embedded text. Confidence: moderate-low (n=33, one 9.7B judge that never used `minor-difference`, only the top two audited). Settling it: judge on formula-dependent eval questions, answer quality with and without decoded formulas. Details: `scratch/sprint-1/spike-formula-vlm/results.md` (last section).

### 2026-10-18: input-addressed rows are first-writer-wins, so producer drift is silent (PROV/Nix review, Sprint 1 item 6)
Observed in core 0.2.0. `DEFAULT_SPACE.model` is `embeddinggemma:latest`, a mutable Ollama tag, and `putEmbeddings` keeps the first `(space, item)` row, so after a model pull new and old vectors share one `es_` ID with no record. `putDocVersion` on an existing `dv_` returns "all reused" without comparing chunk lists, and the chunk recipe names the algorithm and not the code, so a chunker fix without a recipe bump is silently ignored and ingest reports `unchanged`. This bears on Rule 4 (a recipe must identify exactly what to regenerate) and on the Amendment that builds are content-addressed. It means input addressing is only as good as the recipe's coverage of the producer (Bazel and Nix call these untracked dependencies). Suggested fixes: pin the model digest (Ollama `/api/tags` gives one) in the space spec or verify it in `embed`; have `putDocVersion` throw `immutable_violation` when the stored chunk list differs; add a card rule that any output change bumps the chunk recipe. Confidence high on the code reading; the drift itself has not been observed. Details: `scratch/sprint-1/prov-review.md` A2.

### 2026-10-17: section-pack/1 (TS) vs docling HybridChunker on the four stat-mech PDFs, OCR off (spike 5a, Phase 1)
Both chunkers ran on the same OCR-off docling 2.140.0 parses (FoundationsKardar 64 pages 9.6 s, FoundationsPlischke
2.9 s, ThermoKardar 3.2 s, ThermoPlischke 2.7 s). Counts TS/Hybrid: FK 147/165, FP 50/50, TK 76/77, TP 39/44; total
312/336 (the "337 chunks" in the decision log was HybridChunker with OCR on). Chunk lengths in chars, TS vs Hybrid:
median 855 vs 822, p10 437 vs 394, p90 997 vs 1043, max 1500 vs 1229, under 200 chars 3 vs 8. Identical chunk texts
31 of 312 (they agree on paragraph-aligned chunks; Hybrid renders formulas as a 29-char placeholder and joins with
single newlines, so texts rarely match byte for byte); shared chunk start blocks 183 of 312. Same number of
distinct section paths per document (21/13/12/12), because docling reports every header as level 1 and both use
the nearest header. Spot check of 20 random within-section boundaries: all 20 fall at a docling block boundary or, for split
paragraphs, a sentence end (none mid-sentence); 6 of 20 separate a chunk ending in "[formula]" from a continuation starting "where ...", the
main weakness, shared by Hybrid: 45 of 312 TS chunks start lowercase vs 38 of 336 Hybrid, while 30 TS chunks end
mid-sentence vs 56 Hybrid (Hybrid splits paragraphs by tokens more often). Real structure: furniture texts are
inside `body.children` (filter by content_layer), pictures carry up to 18 child texts (axis labels, 194 in
ThermoKardar) that must not leak, captions appear both as picture children and as body texts, lists are
`list` groups, there are no `inline` groups, no title, one or two tables per Kardar document (rendered
`cell | cell`), multi-page paragraphs (11-14 per document) and paragraphs up to 1994 chars (split). Bears on v0
item 1. Recommendation: keep the TS chunker (decision log); it is at least as good on every measure taken and
needs no Python on an import-only machine. Confidence: moderate; 20 boundaries is a small sample and "good
boundary" was judged by me. Settling further: the Phase 4 eval's "evidence split across chunks" signature.

### 2026-10-17: chunk IDs under a real insertion and a real in-place edit (spike 5b, Phase 1)
On each of the four section-pack/1-chunked documents I inserted a 400-char paragraph at the start of a mid-document
section and, separately, changed one word in a paragraph of another section, by editing the docling JSON (a
proxy for re-parsing an edited PDF; IDs do not depend on docling refs). Every chunk outside the two touched
sections kept its ID in all 12 runs (104/104, 41/41, 58/58, 36/36). The insertion changed 1-3 chunks inside its
section (greedy repacking cascades and then resynchronises); the edit changed exactly one chunk. An index-based
scheme (sha256(index|text)) did equally well whenever the chunk count stayed the same, but when the insertion
added a chunk (ThermoPlischke 39 -> 40) it kept only 20 of 39 IDs against 37 of 39. Bears on Core Concepts
(Chunk) and the eval-set pinning. Confirms the chunk-ID decision; confidence high for these documents.
Script: packages/app/scripts/spikes/insertion-test.ts.

### 2026-10-17: embeddinggemma through Ollama on the stat-mech chunks (spike 5c, Phase 1)
embeddinggemma:latest (307M, BF16): 768 dims, unit-norm output, batch-invariant (embed([a,b]) = singletons,
conformance at 1e-4). Throughput on an M2 Pro: 312 chunks (249k chars) in 8.0 s, about 39 chunks/s or 31k chars/s;
31 queries in 0.3 s. On 31 hand-written paraphrase queries with gold located by phrase (1-4 gold chunks each,
spanning both authors; packages/app/scripts/spikes/data/embed-queries.json): with the model's retrieval prompts
(`title: {headings} | text: {text}` / `task: search result | query: {query}`) hit@1 0.52, hit@5 0.77, hit@10 0.87,
hit@20 0.97, recall@10 0.81, MRR 0.65; without any template hit@10 0.84, recall@10 0.68, MRR 0.58. Misses at 10:
grand potential (q08, first gold rank 14), molecular chaos (q23, 15), H-theorem (q24, 30), thermal conductivity
(q25, 11), mostly Kardar chunks whose text is dominated by math-font glyph names (next entry). Not compared:
nomic-embed-text, mxbai-embed-large, bge-m3, qwen3-embedding (none installed; I was not to pull models). Bears
on v0 items 1 and 3 and the "Embeddings" concept (conditioning is part of the space). Meaning: conditioning
matters (+13 points recall@10), so the space must keep its templates in the ID, as it does. Confidence: the
query set is small and written by me after reading the chunks, which favours similarity search; the numbers
are a smoke test, not a baseline. Settling: Phase 4 eval set; a model comparison if the user allows pulls
(open-questions Q4).

### 2026-10-17: the Kardar PDFs' text layer turns inline math into glyph names (Phase 1)
With OCR off, Kardar chunks contain strings like "lparenoriA 1 commaoriA 2", "SLpartialdiffV/SLpartialdiffTbarSC P",
"UPDeltaQ= UPDeltaE!UPDeltaW"; Plischke has milder damage ("q$jv", "6iV-dimensional", "ZN" for 3N). These are the
PDFs' font encodings, not OCR. They inflate chunk text, add noise tokens to embeddings and will leak into eval
questions written from those chunks. Bears on v0 item 1 (parse quality) and item 6 (eval). Possible remedies: a
glyph-name cleanup pass as a parse or chunk recipe (a new recipe, so new chunk IDs), or formula enrichment on a
GPU server. Not measured: how many Kardar chunks are affected (a large share of the Kardar sample I read).
Confidence high that it exists; impact on retrieval unmeasured (three of the four spike-5c misses are Kardar).

### 2026-10-17: docling heading detection is flat and sometimes wrong (Phase 1)
All 65 section headers in the four PDFs come out with level 1, so section paths are one heading deep ("1.2.1 First
law" replaces "1.2 Laws of Thermodynamics"). Bold run-in heads are detected as headers ("Consequences of the third
law:", "Consequences of Liouville's theorem:"). In the generated tiny.pdf, the heading "1.1 A small table" became a
list item with marker "1.1". Bears on Core Concepts (chunk position = section path) and on conditioning (headings
are embedded). Chunk IDs are still stable across re-parses with the same recipe (spike 5b); a docling upgrade that
changes header detection would change IDs (expected, it is a new parse recipe). Possible improvement: infer levels
from numbering; that would be a new chunk recipe. Confidence high on the observation.

### 2026-10-17: decomposition and critique against the linear step contract (spike 5d, Phase 1)
Wrote both pipeline recipes against the 0.1.0 SearchState/Step contract (scratch/sprint-0/pipeline-recipes.md).
Decomposition with per-subquery fusion cannot be expressed: retrieval must fuse to one unique-per-item list
before a fusion step sees per-query ranks. The critique loop can be expressed by unrolling, but only with three
unstated conventions (runner honours `done`, retrieval merges into existing candidates, variants record that they
were searched). Bears on Planned Layers (query refinement) and the proposal's weakest-assumption note. Proposed
fixes P-1 (named candidate pools) and P-2 (runner semantics), both additive now. Confidence high that the gap is
real; the fixes are untested.

### 2026-10-17: can the log alone diagnose a failed query? (Phase 1 skeleton review)
The skeleton's log for one search (pnpm skeleton) holds the query, the build, the search recipe, and per step the
ranked considered pool (all 22 chunks here, up to 100) with scores, then the result and the feedback keyed to the
same search and build. From the log alone one can read the rank of any gold chunk at every step (the "ranked low"
and "not retrieved" signatures), which query variants ran, and whether the build was stale. One cannot see why a
chunk scored as it did: texts and the embedding model are one store read away (item IDs, build manifest). Nested
tool calls (an eval run's searches) are linked only by order (contract-revisions P-3). Bears on v0 item 3 and the
analysis tools. Confidence: judged on the mini-corpus and three real slices, not a real failure.

### 2026-10-17: changing the parse recipe changes chunk text, not just IDs (spike, Phase 0)
Compared chunk sets for OCR on versus OCR off, using HybridChunker, text-whitespace-normalized. ThermoPlischke: 46 vs 44 chunks, only 2 identical texts; heading paths 11 of 12 shared (the odd one was an OCR artifact, "7 of Thermodynamics Review"). FoundationsKardar: 165 vs 165 chunks, all texts and heading paths identical. For ID schemes (section path + text + occurrence, the same with section numbers stripped, and text + occurrence only) the overlap equals the identical-text count in every case, so the section path is not what makes IDs fragile; text is. Bears on Core Concepts (Chunk) and Rule 2. Meaning: a parse recipe change that alters text legitimately produces new chunks, which invalidates eval questions on that document, so the parse recipe must be chosen and frozen before eval generation, along with the chunker. Two architecture drafts named heading instability as their biggest risk and proposed dropping the section path from the ID; this evidence says that fallback gains nothing. Confidence high for these two PDFs, untested on a document where OCR on and off differ only slightly. Settled for the architecture.

### 2026-10-17: derived item IDs vs nondeterministic producers (from the extensible draft, deferred)
The design says a derived item's ID derives from its recipe and input chunk IDs. An LLM extractor run twice with the same recipe and inputs can give different text, which would collide on ID with different content and violate immutability. Options: add a text hash to the ID (reruns become distinct immutable items and a build chooses), or forbid reruns (the derivation cache is authoritative and a deliberate resample needs a recipe bump such as a seed parameter). v0 writes no derived text items, so nothing is blocked. Defer to the sprint that builds the relation layer; v0 only reserves the ID function. Confidence: the problem is real, the choice is open.

### 2026-10-17: Phase 1 review findings deferred beyond Sprint 0 (independent reviewer)
Bears on Core Concepts (Chunk), Rule 5, Scale and Cost. Evidence in `scratch/sprint-0/review-phase1.md`. (L1) Greedy chunk packing can renumber every chunk ID in a section after one inserted paragraph (20 paragraphs of 300 chars, inserted at the start: all 7 IDs vanish); the gas fixture resynchronised only by luck. Harmless for the static stat-mech baseline, but "unchanged content keeps its ID" is false for project databases that edit often; content-defined boundaries would fix it. (L2) Section paths `[]` and `[""]` hash identically. (L3) docKey defaults to the file stem, so `a/foo.pdf` then `b/foo.pdf` silently replaces the first. (L4) `derivedItemId` throws, so Rule 4 on derived items is tested only with hand-made IDs. (L5) `parseArtifactSchema` checks only top-level docling keys. (L6) `pool < k` silently returns fewer than k. (L7) a throwing `finish()` in `runTool` masks the original error. (L8) an identical-text duplicate counts as a recall miss; state in the eval card. Also: the log cannot show which query variant produced a candidate (adding `queryId` to `RankedRef` is in the pre-fan-out list), and `mixedRecipes` is a false positive when only `page_range` differs (cosmetic, only fixtures are sliced). Confidence high; each is cheap to fix when its trigger arrives.

### 2026-10-17: parser settings need a quality gate and escalation path (user-raised, Phase 0)
Observed: the default docling settings (OCR on) cost 15x the time on Plischke and introduced garbled text over a good text layer; the cheap setting (OCR off) was both faster and cleaner on these PDFs, but would presumably fail on genuinely scanned input. Docling gave no signal either way. Bears on v0 item 1 (ingest) and Rule 4 (recipes). Possible meaning: the parser interface should support several recipes (cheap first, escalating options such as OCR or formula decoding) and a check on the output that decides whether to escalate, for example heuristics (text density per page, garble rate against a dictionary) and a sampled LLM check for bad output. Each attempt is a recipe-keyed parse artifact, so escalation is just a second recipe on the same file. Not verified: whether docling has such a mechanism (the user was surprised it lacks one; I have not searched its documentation). Settling it: read docling's confidence-scoring and pipeline docs, then pilot a heuristic gate on the four PDFs plus one genuinely scanned file.

### 2026-10-17: parse speed depends on the PDF; saved docling JSON round-trips to identical chunk IDs (spike, Phase 0)
All four stat-mech PDFs, default docling pipeline, no formula decoding, CPU:

| PDF | pages | parse | chunks | undecoded formulas | JSON size |
|---|---|---|---|---|---|
| FoundationsKardar | 64 | 12s | 165 | 285 | 1.0MB |
| ThermoKardar | 29 | 18s | 77 | 85 | 0.5MB |
| FoundationsPlischke | 26 | 89s | 49 | 131 | 0.3MB |
| ThermoPlischke | 24 | 90s | 46 | 105 | 0.3MB |

Total 337 chunks and 606 undecoded formulas. Every PDF has a text layer (pdftotext gives about 2k chars per page on pages 2-4), so the Plischke slowness (about 4s/page against about 0.3s/page for Kardar) likely comes from docling OCRing pages whose layout looks scanned; this is a guess. The earlier OCR garbling was seen in a Plischke chunk only. Saving the parsed document with `save_as_json`, reloading it and chunking gave identical chunk IDs for all four, so a parse artifact can be produced elsewhere and chunked locally; the artifacts are small (0.3-1.0MB), so transfer is trivial. This supports the portable-artifact constraint (see the entry above) and the default of chunking locally. Follow-up: `do_ocr=False` parsed ThermoPlischke in 6s (against 90s) with 35,562 chars of readable text; The garbled passage near "ideal gas law" is clean without OCR, so the garbling came from OCR over a good text layer. I did not diff the whole text against the OCR run. Not yet settled: the ID scheme. A section-path-plus-ordinal ID limits an insertion's effect to its own section, while a global index shifts every later ID; this follows by construction and I did not test it (my edit test changed one paragraph in place, so it could not tell the schemes apart). Confidence high on the table.

### 2026-10-17: remote parsing and portable parse artifacts (user-raised, Phase 0)
The user wants v0 to be roughly usable later by installing the parser on a GPU server and downloading the processed and chunked data. Bears on v0 items 1 and 2 and on Scale and Cost. Possible meaning: the parse (and equation decoding) step is a recipe-keyed derived artifact that can be produced anywhere and imported, which fits the recipe and build model in Core Concepts. Needs Phase 0 to decide the artifact format and whether chunking happens on the server or locally (chunk IDs must come out identical either way). Confidence high that it is wanted, open on the format.

### 2026-10-17: docling on stat-mech PDFs is slow, and formulas and some text are poor (spike, Phase 0)
Observed on `ThermoPlischke.pdf` (24 pages, docling 2.140, CPU, macOS, default pipeline with RapidOCR): parse took 108s and 91s on two runs (about 4s/page). The 46 chunks from HybridChunker have median 857 chars and range 32-1146. Display equations come out as `<!-- formula-not-decoded -->`. At least one chunk contains OCR-garbled text ("ie re Se nns nas Se s to pn ns ideal gas law"), so the PDF probably has scanned or poor text-layer regions. Bears on v0 item 1 (ingest) and on eval quality: questions about equations cannot be answered from these chunks. Possible meaning: parsing cost makes caching parsed documents by file hash necessary (a scale/cost item), and formula enrichment or a different pipeline setting may be needed, or the corpus should be limited to prose questions. Confidence in the numbers is high (two runs), low on cause. Settling it: run the other three PDFs, try formula enrichment, and check whether the text layer exists (`pdftotext`).

### 2026-10-17: docling formula enrichment does not support MPS; CPU decodes correctly but slowly (spike, Phase 0)
Docling 2.140 on an M2 Pro: `do_formula_enrichment=True` with `device=mps` raises `AcceleratorDeviceNotAvailableError: MPS is not supported by this model. Supported devices: ['cpu', 'cuda', 'xpu']`. On CPU, pages 2-4 of `ThermoPlischke.pdf` took 194s (including model load) and decoded 7 formulas to clean LaTeX, with none left undecoded (e.g. the van der Waals equation was correct). So quality is good and the cost is the problem. Bears on v0 item 1 (ingest) and the eval's handling of equations. Possible meaning: decode equations as a separate, lazily run derived step, not inside ingest. Confidence high on the MPS error, low on per-formula cost (load time is mixed in). Settling it: time a second page after warm-up, count formulas per PDF, and try a vision-LLM transcription of the crops.

### 2026-10-17: chunk IDs were identical across two runs of the same environment (spike, Phase 0)
Chunk ID = sha256(position index | text)[:12]. Both runs produced identical ID lists for all 46 chunks. This supports "re-ingesting unchanged content is idempotent" only within one docling version and configuration. It does not show stability under a docling upgrade or a small document edit, and an index-based position component means an insertion early in a document shifts every later ID. Bears on Core Concepts (Chunk). Confidence moderate. Settling it: edit-and-reingest test, and decide whether position should be a section path rather than a global index.

## Resolved

(none yet)
