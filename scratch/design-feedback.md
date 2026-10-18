# Design feedback

Open entries are at the top; triaged entries move to "Resolved". An entry is plain prose and says:
- what was observed, with evidence (numbers, a failing case, a file);
- which part of the design doc it bears on;
- what it might mean (scope that could grow, a useful capability, a choice that may cause trouble later, or something that does not work as specified);
- how sure the author is, and what would settle it.

## Open

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
