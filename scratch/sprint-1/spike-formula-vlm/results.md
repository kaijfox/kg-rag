# Spike: Apple-GPU formula recognition (results)

Run 2026-10-18 on this machine (Apple silicon, 16 GB, macOS 24.6). Plan: `../spike-formula-vlm.md`. All code, crops, outputs and scores are in this directory; models and venvs are in `~/.cache/kgrag-spike-formula/` (outside the repo).

## Bottom line against the pre-set decision rule

Rule: worth it if a candidate decodes the full corpus in under about 30 min, with at least about 90% normalized exact match on the gold set, and the retrieval pilot shows no harm.

- Speed: met by several candidates. The best, GLM-OCR 4-bit on MLX, decoded all 605 display formulas of the four PDFs in 258 s (4.3 min) measured end to end, against about 4.1 hours extrapolated for docling's CPU CodeFormula.
- Accuracy: not met. Best is GLM-OCR 4-bit at 27/33 = 82% normalized exact (bootstrap 95% interval about 70-94%, n is small), mean token edit distance 1.4%. Next are PaddleOCR-VL with a tight crop (76%) and CodeFormulaV2 on MPS (61-67%).
- Retrieval pilot: not "no harm". Replacing the `[formula]` placeholder with decoded LaTeX lowered the 31 hand queries' MRR from 0.671 to 0.598 and hit@5 from 0.87 to 0.81 (2 queries lost the top 5, 5 improved rank, 11 worsened). Differences are small and n is 31, but there is no sign of a benefit and the chunk count rises from 312 to 440.

Outcome: a Mac-GPU formula pass is technically feasible and cheap (minutes, about 2 GB RAM, about 0.7-1.3 GB of weights), but the pre-set rule is NOT satisfied (accuracy short of 90%, retrieval pilot not neutral). Per the plan this is reported with numbers and left to the user. Recommendation: do not add formula decoding to the default v0 parse recipe on this evidence; keep it as an optional post-pass recipe (see Integration) to be judged on the Phase 4 eval set. A GPU server is not needed for speed; the open issue is value, not cost.

Sensitivity, flagged as post hoc: 4 of GLM-OCR's 6 misses on the gold set are the crossed-d (đ, inexact differential) rendered as d, plus a prose word ("or") and a crop-edge "=". If those are forgiven GLM-OCR scores 30/33 = 91%. That does not change the retrieval finding.

## Candidates and install effort

Downloads (all to `~/.cache/kgrag-spike-formula/hf`, total about 3.5 GB including docling's layout models fetched for one integration test; the already-cached CodeFormulaV2 610 MB lives in the older `~/.cache/huggingface`):

| model | weights | source | effort |
|---|---|---|---|
| GLM-OCR-4bit (0.9B) | 1.25 GB | mlx-community/GLM-OCR-4bit | `uv pip install mlx-vlm`; a few lines (load, apply_chat_template, generate) |
| PaddleOCR-VL-1.6-4bit (0.96B) | 0.70 GB | mlx-community | same |
| Granite-Docling-258M-mlx | 0.63 GB | ibm-granite | same; also works inside docling (below) |
| texify (vikp/texify) | 0.63 GB | pip `texify` | needs `transformers==4.46.3` (4.57 fails in a config repr); runs on MPS fp16 out of the box |
| pix2tex | 0.12 GB | pip `pix2tex` | CPU default; MPS needs manual `.to("mps")`; sampling temperature set to about 0 |
| CodeFormulaV2 (0.3B) | 0.61 GB (cached) | docling-project | transformers on MPS works directly; docling's own stage refuses MPS |
| qwen3.5 9.7B Q4 | 6.6 GB (already installed) | Ollama | no download; vision over `/api/chat` with `think:false` |

Not evaluated (size/budget, listed so the choice is visible): Qwen3-VL-2B-4bit 1.78 GB, Qwen2.5-VL-3B-4bit 3.07 GB, olmOCR-2 7B 4-bit 5.6 GB, dots.ocr 4-bit 3.5 GB, Nougat small/base 2.0/2.8 GB, UniMERNet (gated, 401), LightOnOCR-2 2.0 GB. Pulling the 2B Qwen would have taken total downloads past about 5 GB, so it was not pulled (open question logged).

## Method as run

1. Gold set (`gold.json`, 33 items): 29 display formulas, stratified across the four documents by seeded random choice (8 FK, 8 TK, 6 FP, 7 TP after drops, with two "heavy" ones per document: braces, multi-line, long) plus 4 inline spans from the Kardar PDFs (found through docling-parse word cells because only docling's text layer carries the glyph names; PDFium cannot see them). Crops reproduce docling's formula crop exactly (page at 1.67 scale, bbox expanded 18% each side), plus a "tight" variant with a 4% margin (`CodeFormulaVlmOptions.expansion_factor` exposes this). Three selected items were dropped after viewing: one display formula whose docling bbox cuts the formula in half (FP-p06-t59) and two inline spans where my box clipped the first glyph.
2. Reference: docling's own `CodeFormulaVlmModel` stage (CodeFormulaV2, CPU, bf16, batch 5) run on the crops, then every crop read by eye. 18 of 33 references were corrected: several only removed prose from neighbouring lines (the 18% margin pulls in adjacent text and CodeFormulaV2 transcribes it), equation numbers and `&` markers, about 10 had real symbol errors (primes dropped, `\propto` read as `\alpha`, `P` read as `p`, `c_\alpha c_\beta u_{\alpha\beta}` read as `c_\alpha c_\alpha u_\alpha`, subscripts `j\neq i`, `\partial/\partial\mu` read as a smile, đ), and all four inline references were rewritten (the CPU output for those crops is garbage). The accepted items are therefore biased toward CodeFormulaV2's style, which favours it slightly.
3. Metrics (`latexnorm.py`, `score.py`): exact match of normalized token sequences (strip math delimiters, equation numbers, `\left`/`\right`, spacing commands, style wrappers such as `\mathrm`/`\mathcal`, brace grouping, `^{\prime}`/`'`, `\dots`/`\cdots`, `\dfrac`/`\cfrac`/`\frac`; `\bar{d}`, `\mathfrak{d}` and đ identify), normalized token edit distance, and render equivalence (pdflatex bitmap identical to the reference's). "Lenient" ignores `\text{}`/`\intertext{}` fragments in the candidate (prose copied from crop margins), "strict" does not. The normalization was tuned while looking at GLM-OCR / CodeFormulaV2 / Paddle failures, so it is somewhat fitted; the numbers are consistent across candidates but not blind. Render equivalence is too brittle to use (style choices such as `\left(` sizing change pixels, 3-10 compile failures per candidate); it is recorded in `out/scores.json` but not used for conclusions.
4. Latency: wall time per formula, batch of 1, after 2 warm-up generations; memory is MLX peak or MPS driver allocation. The CPU reference is the docling batch-5 figure.

## Results (gold set, docling-default crops unless marked)

| candidate | device | exact (lenient) | exact (strict) | mean token NED | median s/formula | mean s/display | est. 605 formulas | peak GB |
|---|---|---|---|---|---|---|---|---|
| CodeFormulaV2 via docling stage, CPU bf16, bs5 (reference) | cpu | 19/33 (58%) | 15/33 (45%) | 0.077 | 24.4 (batch 5) | 24.4 | 246 min | ~1.2 (RSS) |
| CodeFormulaV2 (0.3B) transformers, MPS bf16, bs1 | mps | 20/33 (61%) | 16/33 (48%) | 0.081 | 1.25 | 1.48 | 14.9 min | 1.4 |
|   same, 4% crop margin | mps | 22/33 (67%) | 19/33 (58%) | 0.057 | 1.26 | 1.40 | 14.1 min | 1.4 |
|   same, fp16 | mps | 20/33 (61%) | 16/33 (48%) | 0.081 | 1.10 | 1.27 | 12.8 min | 1.4 |
| **GLM-OCR 4bit (mlx-vlm) "Formula Recognition:"** | mlx | **27/33 (82%)** | 26/33 (79%) | **0.014** | 0.29 | 0.46 | 4.6 min (measured 4.3 min, 605 formulas) | 2.0 |
|   same, 4% crop margin | mlx | 22/33 (67%) | 22/33 (67%) | 0.020 | 0.27 | 0.43 | 4.3 min | 1.9 |
| PaddleOCR-VL-1.6 4bit (mlx-vlm) "Formula Recognition:" | mlx | 20/33 (61%) | 19/33 (58%) | 0.091 | 0.45 | 0.52 | 5.2 min | 1.5 |
|   same, 4% crop margin | mlx | 25/33 (76%) | 23/33 (70%) | 0.039 | 0.43 | 0.49 | 5.0 min | 1.5 |
| Granite-Docling-258M (mlx-vlm) "<formula>" | mlx | 19/33 (58%) | 17/33 (52%) | 0.088 | 0.77 | 0.92 | 9.3 min | 1.5 |
|   same, 4% crop margin | mlx | 22/33 (67%) | 21/33 (64%) | 0.058 | 0.83 | 0.95 | 9.6 min | 1.5 |
| texify (vikp/texify) MPS fp16 | mps | 18/33 (55%) | 17/33 (52%) | 0.109 | 0.57 | 1.01 | 10.2 min | 1.3 |
|   same, 4% crop margin | mps | 16/33 (48%) | 16/33 (48%) | 0.138 | 0.52 | 0.83 | 8.4 min | 1.3 |
| pix2tex (LaTeX-OCR), CPU | cpu | 10/33 (30%) | 10/33 (30%) | 0.296 | 1.87 | 4.14 | 41.8 min | - |
|   same, 4% crop margin | cpu | 10/33 (30%) | 10/33 (30%) | 0.199 | 1.17 | 2.74 | 27.7 min | - |
| pix2tex, MPS (patched device) | mps | 10/33 (30%) | 10/33 (30%) | 0.296 | 1.60 | 2.95 | 29.7 min | 1.4 |
| qwen3.5 9.7B Q4 via Ollama (installed) | ollama/Metal | 20/33 (61%) | 20/33 (61%) | 0.035 | 3.50 | 5.48 | 55.3 min | model 5.5 |
|   same, 4% crop margin | ollama/Metal | 17/33 (52%) | 17/33 (52%) | 0.040 | 3.39 | 5.57 | 56.2 min | model 5.5 |

Reading the table:
- Every MLX and MPS transformer candidate finishes the corpus in under 15 min; pix2tex (28-42 min) and the 9.7B Ollama model (55 min) are slower; docling's CPU path (4.1 h) is the outlier. The CPU/MPS outputs of CodeFormulaV2 agree (28/33 identical strings, 29/33 token-equal), so MPS does not cost accuracy; fp16 vs bf16 makes no difference. Docling itself blocks MPS for this model (`transformers_engine` supported devices are CPU/CUDA/XPU only), but the model runs fine when driven directly.
- GLM-OCR has by far the lowest edit distance (1.4% of tokens). Its 6 misses: three đ items (read as d), `\partial/\partial\mu` misread as `1/\partial\mu` (FP-p18, a hard crop), a prose word, and a crop-edge "=". On the full corpus it produced no errors, no empty output, no runaway generations (605 of 605 `stop`, longest 398 tokens, median 0.34 s).
- The tight (4%) margin helps CodeFormulaV2, Granite and Paddle (less neighbouring prose is transcribed, 3 to 5 more exact) but hurts GLM-OCR and texify (clipped brackets/tails); there is no single best crop setting. Margin is therefore a tuning knob for any recipe, not a detail.
- Inline: GLM-OCR, Paddle, Granite and Qwen get 3/4 inline spans (the fourth fails only on a leading "="); CodeFormulaV2 gets 1/4. A crude count of Kardar inline-math spans (openers `lparenori`, `lbraceori`, `langleSC` in prose items) is 357, so inline decoding adds about 357 x 0.3 s, roughly 2 min for GLM-OCR, but needs span localization from docling-parse word cells (the artifact does not keep cell boxes) and the spans' prose neighbours make the crop messy.
- Docling-native Apple GPU path exists: `CodeFormulaVlmOptions.from_preset("granite_docling")` with the default AUTO_INLINE engine selects MLX on Apple silicon (verified: one ThermoPlischke page, 6 formulas decoded, 21 s including layout). Its accuracy is the Granite row (58% / 67% tight). CodeFormulaV2 has no MLX export in docling 2.140.0.

## Retrieval pilot (`retrieval.ts`, `data_formula_queries.json`, `out/retrieval.json`)

Same `section-pack/1` chunker, same embeddinggemma space via Ollama; only the text of formula blocks changes: `[formula]` placeholder (baseline), raw glyph-name text, or the GLM-OCR LaTeX (all 605 decoded display formulas, equation numbers stripped). Gold chunks are found by prose phrase, so a chunk split differently is still scored.

| rendering | chunks | hand31 hit@1 / @5 / @10 / MRR | formula-prose10 (hit@1 / @5 / MRR) | formula-LaTeX10 (hit@1 / @5 / MRR) |
|---|---|---|---|---|
| `[formula]` placeholder | 312 | 0.52 / 0.87 / 0.94 / 0.671 | 0.70 / 1.00 / 0.850 | 0.50 / 0.80 / 0.577 |
| raw glyph names | 364 | 0.52 / 0.81 / 0.90 / 0.656 | 0.30 / 0.70 / 0.469 | 0.20 / 0.70 / 0.378 |
| decoded LaTeX (GLM-OCR) | 440 | 0.45 / 0.81 / 0.90 / 0.598 | 0.50 / 0.90 / 0.662 | 0.10 / 0.60 / 0.355 |

- The 10 formula-heavy chunks were picked from the 100 baseline chunks with 3 or more formulas, and I wrote 10 prose queries and 10 LaTeX-fragment queries about them; I was not blind to the decoded text, so the LaTeX group is biased toward decoding, and still decoding only helps 5 of its 10 (ranks 4->2, 17->2, 75->13, 4->2, 5->2) while 4 get much worse (1->85, 1->25, 1->4, 1->6).
- Raw glyph-name text (what the Kardar prose already contains inline) is the worst for formula queries, consistent with the earlier design-feedback guess that glyph names hurt Kardar retrieval; but replacing the display formulas' placeholder with it does not help either.
- Likely mechanism for the decoded-LaTeX regression: formula text is 100-400 characters each, the chunker packs by characters, so decoded chunks hold less prose and the corpus splits into 440 chunks; embeddinggemma also gets LaTeX tokens it was not trained to relate to prose queries. A variant not run: keep LaTeX for display/storage but embed the placeholder text (equivalent to the baseline for retrieval).
- Caveats: 31 + 20 queries, one embedding model, one chunker; a 2-3 query swing is within noise. This is a pilot; the Phase 4 eval set is the real test.

## Integration cost

- Docling pipeline option: only Granite-Docling (MLX engine) is available today through `code_formula_options`; adding GLM-OCR means a custom stage or a new engine preset in docling, not configuration.
- Post-pass over the portable parse artifact (preferred, fits the "parse artifact is portable docling JSON" decision): for each `label == "formula"` item, crop from the source PDF using the item's page and bbox (the artifact already holds both; the crop rule is page at 1.67 scale, bbox expanded by a margin), decode, write `text` back. Output is a new artifact with a new parse recipe (`do_formula_enrichment` false plus a `formulaPostPass: {model, revision, prompt, cropMargin}` entry, or a new recipe `version`), hence new chunk texts and new chunk IDs. It needs the PDF at post-pass time (an import-only machine without the source cannot run it), a Python or MLX runtime (about 2 GB RAM), and a model revision pin. It can run on a GPU server too, so it does not conflict with the remote-parsing constraint.
- Chunker side: nothing changes (it already renders `text` for formula items), but formula text lengthens chunks and shifts boundaries (312 -> 440 chunks on this corpus), a chunking-recipe interaction to settle together with the recipe, before the chunker freeze.
- Inline glyph-name spans are a separate and harder item: they live in prose text items, not formula items, so decoding them means replacing text spans (docling-parse word cells for localization), a larger change to the artifact.

## Files

`common.py`, `select_gold.py`, `select_inline.py`, `make_gold_ref.py`, `make_tight.py` (gold set); `ref_cpu.py`, `ref_cpu_inline.py` (docling CPU reference); `run_mlx.py`, `run_codeformula.py`, `run_texify.py`, `run_pix2tex.py`, `run_ollama.py`, `full_run.py` (candidates); `latexnorm.py`, `score.py` (metrics); `retr_common.ts`, `retr_dump.ts`, `retrieval.ts` (pilot, imports packages read-only); `docling_granite_mlx_test.py` (docling-native MLX check); `gold.json`, `crops/`, `crops_tight/`, `out/` (outputs, `scores.json`, `retrieval.json`, `full_glm_ocr_4bit.json`, `decoded_glm.json`, sheets). Environments: `~/.cache/kgrag-spike-formula/venv` (docling 2.140.0, mlx-vlm 0.7.8, mlx 0.32.4, torch 2.14.1, transformers 5.20.1) and `venv2` (texify, pix2tex, transformers 4.46.3). Run python without `-I` from this directory (it imports `common`).

## Gold set (33 items)

Display: FK-p09-t137, FK-p19-t277*, FK-p20-t290, FK-p27-t426*, FK-p28-t439*, FK-p56-t936, FK-p60-t1007*, FK-p64-t1075*, TK-p04-t55*, TK-p04-t57*, TK-p14-t275*, TK-p17-t334*, TK-p20-t385, TK-p24-t460*, TK-p24-t447, TK-p25-t472*, FP-p06-t65, FP-p15-t194, FP-p18-t235*, FP-p21-t292, FP-p23-t314, FP-p23-t322, TP-p10-t123*, TP-p10-t121, TP-p16-t221, TP-p17-t233, TP-p18-t245, TP-p18-t248, TP-p24-t315* (ids are document initials, page, text index; FK/FP = Foundations Kardar/Plischke, TK/TP = Thermo; * = reference corrected by hand). Inline (all four corrected): IFK-p17-51, IFK-p23-116, ITK-p12-329, ITK-p18-377. Full list with references in `gold.json`.


## Follow-up 2026-10-18: Qwen3-VL-2B on the Apple GPU, an LLM-judged semantic metric, and CodeFormulaV2's roles

Added files: `judge.py` (judge), `out/judge.json` and `out/judge_cache.json` (verdicts), `out/qwen3_vl_2b_4bit_mlx{,_tight}.json` (+ `.log`). `score.py` gained a filter so it skips non-candidate json in `out/` (the earlier numbers reproduce unchanged).

### Qwen3-VL-2B (question 1)

Repo id verified on Hugging Face: `mlx-community/Qwen3-VL-2B-Instruct-4bit` (1.80 GB of files, 1.7 GB on disk in `~/.cache/kgrag-spike-formula/hf`; no other downloads). Run with mlx-vlm on the Apple GPU (MLX), batch 1, 2 warm-up generations, `temperature=0`, same 33 crops, same harness (`run_mlx.py`) as GLM-OCR. It has no dedicated formula prompt, so I used a fixed one: "Transcribe the mathematical formula in this image as LaTeX. Output only the LaTeX code, with no explanation and no $ delimiters." (it still wraps its answer in `$$`, which normalization strips). All 66 generations ended with `stop`.

| candidate | exact (lenient) | exact (strict) | mean token NED | median s/formula | mean s/display | est. 605 formulas | peak GB |
|---|---|---|---|---|---|---|---|
| Qwen3-VL-2B 4bit, docling crop (18%) | 15/33 (45%) | 14/33 | 0.079 | 0.67 | 0.95 | 9.6 min | 2.34 |
| Qwen3-VL-2B 4bit, 4% crop | 20/33 (61%) | 19/33 | 0.048 | 0.73 | 1.01 | 10.2 min | 2.19 |
| GLM-OCR 4bit (for comparison) | 27/33 (82%) | 26/33 | 0.014 | 0.29 | 0.46 | 4.6 min | 2.05 |
| GLM-OCR 4bit, 4% crop | 22/33 (67%) | 22/33 | 0.020 | 0.27 | 0.43 | 4.3 min | 1.89 |

Answer: it runs on the GPU at about 1 s per formula (2-2.5x slower than GLM-OCR, same order as CodeFormulaV2 on MPS), but it is not notably better than GLM-OCR; it is worse on every exact-match and edit-distance figure with either crop (best 61% against GLM-OCR's 82%/67%). Like the other general models it benefits from the tight crop (less neighbouring prose copied). Extrapolation is from the 33-crop mean and ignores the longest equations in the corpus; the GLM-OCR full run showed such extrapolations are close (258 s measured against 4.6 min).

### Semantic equivalence judged by a local LLM (question 2)

Judge: Ollama `qwen3.5:latest` (9.7B Q4) via `/api/chat`, `think:false`, `temperature:0`, `seed:0`. The prompt is the one given: "Do these two LaTeX expressions denote the same mathematical statement? Ignore formatting/notation style differences. Answer same / minor-difference / different", followed by the reference and candidate and one line asking for exactly one of the three words (my addition, for parseable output). The only preprocessing is stripping math delimiters (`$$`, `\[`, `\begin{equation}`); equation numbers (`\tag{}`), `\begin{array}` wrappers and copied prose are left in, so the judge sees what a downstream LLM would see. References are the hand-corrected gold references. 12 candidate outputs x 33 = 396 verdicts, all parsed. The judge never returned `minor-difference` (not once), so same+minor equals same here.

| candidate (crop) | same+minor | exact (lenient) | different |
|---|---|---|---|
| GLM-OCR (18%) | 31/33 (94%) | 27/33 (82%) | 2 |
| GLM-OCR (4%) | 27/33 (82%) | 22/33 (67%) | 6 |
| PaddleOCR-VL (18%) | 28/33 (85%) | 20/33 (61%) | 5 |
| PaddleOCR-VL (4%) | 30/33 (91%) | 25/33 (76%) | 3 |
| CodeFormulaV2 MPS bf16 (18%) | 21/33 (64%) | 20/33 (61%) | 12 |
| CodeFormulaV2 MPS bf16 (4%) | 22/33 (67%) | 22/33 (67%) | 11 |
| Granite-Docling (18%) | 29/33 (88%) | 19/33 (58%) | 4 |
| Granite-Docling (4%) | 29/33 (88%) | 22/33 (67%) | 4 |
| texify (18%) | 27/33 (82%) | 18/33 (55%) | 6 |
| texify (4%) | 28/33 (85%) | 16/33 (48%) | 5 |
| Qwen3-VL-2B (18%) | 25/33 (76%) | 15/33 (45%) | 8 |
| Qwen3-VL-2B (4%) | 28/33 (85%) | 20/33 (61%) | 5 |

Reading: the semantic rate is above the exact rate for every model except CodeFormulaV2, because exact match punishes harmless things (equation numbers, `\mathrm{d}` against the reference's crossed d, `array` wrappers, spacing, `\dots` styles). The CodeFormulaV2 rows are low on the judge because its outputs carry neighbouring prose and numbers, and (for the references) because the references were derived from its style, so its exact rate is the inflated one. The ranking of the top two holds under both metrics (GLM-OCR at the docling crop, PaddleOCR-VL at the tight crop), and GLM-OCR's single best setting also has the highest semantic rate (94%, which is the 90% mark the plan used for exact).

Judge check, reading every "different" verdict of the top two by eye:
- GLM-OCR (18%), 2 verdicts. FP-p18-t235: correct verdict, a real error (`\frac{\partial}{\partial\mu}` read as `\frac{1}{\partial\mu}`, which changes the equation). TP-p10-t123: judge wrong or at best harsh; the candidate is the same equation (`dA = dE - d(TS) = dQ - TdS - SdT - dW`) with a `\begin{array}` wrapper and a `\tag{1.28}`, and the crossed d read as plain d. Note the judge inconsistently called the same crossed-d substitution "same" in TK-p14-t275 and TK-p25-t472. By eye 32/33 are the right equation (97%); one is wrong.
- PaddleOCR-VL tight, 3 verdicts. FP-p18-t235: correct, a real error (`\frac{1}{\partial u}`, same failure as GLM-OCR, plus `\mathrm{e x p}`). TK-p17-t334 and TK-p25-t472: the equation itself is transcribed correctly, but the output also contains a line of the neighbouring prose ("with temperature are related to heat capacities at", "S_i ... in Eq.~(1.71) is non-zero"); the judge's "different" is fair if the question is whether the output denotes only the equation, and a downstream LLM would see a correct equation plus a stray sentence. By eye 30/33 clean, 2 correct with prose attached, 1 wrong.
- In the other direction I scanned all exact-miss / judged-"same" items of those two (9 items): the judge was right in all (differences are `\tag`, `\mathrm{d}` for the crossed d, `\mathrm{o r}` for "or", `\dots` for `\cdots`, a dropped leading "="), with the caveat that loss of the crossed-d (inexact differential) is a real notation loss that the judge forgave in three of four cases. The judge is therefore lenient about notation and strict about prose, which is the behaviour wanted here, but it is one model at temperature 0 on 33 items and I only audited the top two candidates; the other 10 rows' "different" verdicts were not read.

### How CodeFormulaV2 was used, from the earlier results (restated)

- Reference producer: docling's own `CodeFormulaVlmModel` stage (CodeFormulaV2, 0.3B) ran on the CPU in bf16, batch 5, over the gold crops (`ref_cpu.py`, `ref_cpu_inline.py`; output `out/ref_cpu_all.json`). Every crop was then read by eye and 18 of the 33 outputs were corrected by hand to form the gold references (prose removed, symbol errors fixed, all four inline ones rewritten). So the gold set is biased toward CodeFormulaV2's style, which helps it a little as a candidate.
- Also a candidate, in two forms: (a) the docling CPU run itself, scored as `docling_codeformulav2_cpu_bf16_batch5` (19/33 lenient, 58%); (b) the same model driven directly with transformers on Apple MPS (`run_codeformula.py`; bf16 and fp16, both crop margins; 20/33 at 18% crop, 22/33 at 4%).
- Where it ran: CPU for the reference, because docling's formula stage refuses MPS (supported devices are CPU/CUDA/XPU); MPS only when driven outside docling. The CPU and MPS strings agree (28/33 identical, 29/33 token-equal).
- Time per formula: CPU 24.4 s (batch 5; 246 min extrapolated for 605 formulas, about 4.1 h); MPS 1.25 s median at batch 1 (1.48 s mean per display formula; 14.9 min for 605), fp16 1.10 s, 4% crop 1.26 s. MPS is about 20x faster than the CPU stage. Memory about 1.4 GB on MPS, about 1.2 GB RSS on CPU. The CPU figure is a batch-5 per-formula number including padding to the longest in the batch, and the 24 s includes crop garbage on the 18% margin, so it is not a clean per-model CPU latency; it is the figure docling users get.
