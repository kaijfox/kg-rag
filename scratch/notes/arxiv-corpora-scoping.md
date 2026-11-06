# arXiv test corpora: scoping (2026-11-06)

Scoping only. Nothing is built or ingested. Follows Q15 (each paper is its own corpus; review plus cited works) and the Q13 follow-up (decoded-formula measurement).

## The two papers
| | 1901.10416 Statistical field theory for neural networks | 2102.12086 Modern Koopman Theory for Dynamical Systems |
|---|---|---|
| Source | 19 .tex files, about 48k words, bibliography as .bbl | one main.tex (6066 lines), bibliography inline |
| References | 89 (13 name an arXiv id; 50 are pre-2008; no titles in the .bbl, only journal/volume/pages) | 463 (31 name an arXiv id; titles present for 462) |
| Where the citations are | Intro 48, self-consistent DMFT file 24, MSR file 14, TAP file 11. The long derivation files (loopwise expansion, effective action, perturbation theory, about 25k words) cite almost nothing | Spread across nearly every subsection; densest: Domain applications 67, Koopman control intro 56, Convergence 49, Methodological extensions 43, Spectrum beyond eigenvalues 37, Connections 36, Data-driven control 34 |
| Verdict | Good single-document pair (derivation-heavy, equation-dense). Weak for cross-corpus: few citing passages, many cited works are old journal-only papers | Good for both. Main cross-corpus candidate |

## Citation coverage (measured on a sample, rough)
Koopman: sampled 30 references with no explicit arXiv id and looked up each title in the arXiv API. 14 of 30 matched, but my matcher is crude (it missed papers I know are on arXiv, such as the Raissi PINN paper and Brunton's SINDy paper, because of title formatting, and it produced about 3 false matches). Reading that as 50 to 65% on arXiv gives roughly 230 to 300 of 463 references. A proper pass (title and author lookup against OpenAlex or Semantic Scholar, then check that the arXiv id has a source tarball) is the first real task. Not every arXiv paper has TeX source (some are PDF-only submissions), so "has tex" is a second filter on top of "is on arXiv".

Field theory: 39 of 89 references are from 2008 or later; most pre-2008 neuroscience and physics papers have no arXiv copy. Expect around 25 to 40 resolvable, clustered in the intro, DMFT and TAP sections.

## Why the paired views matter (answering your two questions)
Yes to both, with one sharpening each.

- **PDF versus TeX of the same document.** The TeX gives us ground truth for text, section structure and equations that the PDF route has to reconstruct. Same content through two ingestion routes means any difference in retrieval or answer quality is attributable to ingestion, not to the content. It also gives exact LaTeX for the decoded-formula measurement (replacing the 33 hand references). The sharpening: this is only a clean comparison if gold is anchored to the content, not to chunk ids (see below).
- **Cross-corpus questions.** The stat-mech cross-author run showed the failure mode of questions with no guaranteed link: scores 0.24 and 0.31, mostly because the other book does not contain the fact. A review's citing sentence guarantees the link: the sentence says what the cited paper established. So these questions test combining evidence across documents, which a single-document test cannot do, and it is the only setup where a graph layer or multi-hop retrieval has something to show (the stat-mech multi-hop questions came out easy because they were built from passages similar by embedding).

## Proposed corpus ladder
1. **Single-document pair**, for each paper: PDF route versus TeX route, same questions.
2. **Review plus cited works, PDF only** (cited works as PDFs).
3. **Review plus cited works, paired** (cited works available as both TeX and PDF). Subset of 2, limited to cited works with source. Koopman only, realistically.

Suggested scopes for 2 and 3 (Koopman), chosen for citation density and topical coherence:
- A: DMD chapter (algorithm, extensions, applications, connections): about 175 citation slots.
- B: Koopman theory for control (model-based, data-driven, strategies): about 140.
- C (optional): convergence plus spectrum beyond eigenvalues: about 85.
Each scope's cited-paper set would be tens of papers (my estimate: 50 to 100 per scope after the on-arXiv filter). The field-theory paper gets scope D: intro plus DMFT plus TAP, probably 25 to 40 cited papers, treated as optional.

## The design question this raises: gold that survives re-chunking
Today the evaluator generates questions from chunks and records the chunk ids as gold. Different ingestion routes give different chunks, so a question's gold ids cannot carry from the TeX build to the PDF build. Options:
- (a) **Anchor gold to the TeX.** Generate each question from a TeX span (section plus paragraph or equation label, or a character range). Gold for any route is the set of chunks that overlap the span, found by text alignment of the route's chunks against the TeX. The alignment is also where PDF ingestion quality shows up: spans that cannot be aligned are ingestion failures. This is the a priori validated gold you describe. Needs a gold-span concept and an alignment step; the evaluator itself stays on-the-fly for question writing.
- (b) **Generate independently per route and compare aggregates.** No new machinery, but questions differ between routes, so the comparison is noisy and cannot localise failures.
- Recommendation: (a). It touches how the eval set records gold, so it belongs in `design/` and needs your approval before any edit.

Cross-corpus gold: for each question, start from a `\cite{}` sentence in the review (exact span, exact cited paper). A stronger model reads the cited paper's TeX to find the supporting span, then the question is written to need both. Gold is then spans in two documents. The same review-based validation step as Sprint 2 applies, plus a check that the cited span really supports the review's claim.

## What I would do next (still scoping)
1. Full citation resolution for both papers (OpenAlex or Semantic Scholar by title; confirm arXiv id; confirm a source tarball exists). Output: counts per scope, a list of resolvable papers. About an hour of work, no LLM cost.
2. Download and size the chosen scopes' PDFs and TeX; check that docling parses them at acceptable cost on the M2 (many pages, equation-dense).
3. Decide scopes from the real counts.

## Questions for you
1. Is a gold-span concept (option a) acceptable as a design change, to be drafted for your approval?
2. Is the field-theory paper a single-document pair only, with Koopman carrying cross-corpus? (Its citation structure suggests so.)
3. Q16 (stronger question writer) interacts: cross-corpus and topic questions are the ones a local model writes poorly. Should the arXiv corpora wait for that decision, or use a Claude model for just these?

Scratch tooling used: source tarballs and a title-lookup script are in the session scratchpad only (not committed).

## Update 2026-11-06: citation lookup done (Koopman)
Decisions: field theory paper is a single-document PDF/TeX pair only. Question writer stays undecided (Q16 open), so cross-corpus question writing waits.

Resolution (title search in the arXiv API; `scratch/arxiv-corpora/resolve.py`; outputs in `scratch/arxiv-corpora/koopman/`): of 463 references, 191 (41%) are on arXiv, and all 191 have TeX source (8 of 8 sampled tarballs checked, each with .tex files). That is a lower bound: a sample of the 272 misses suggests about 15% of them are real arXiv papers the strict title match missed (titles with LaTeX artifacts), so 190 to 240 is the likely range. The rest are mostly pre-arXiv papers, books, and non-arXiv journals. OpenAlex was not used (its anonymous daily budget for this network was exhausted; a key needs the user's email, which was not shared).

Candidate scopes (unique cited papers on arXiv with source; citing sentences that cite one arXiv paper):
| Scope | Cited | On arXiv | Single-paper citing sentences |
|---|---|---|---|
| A DMD chapter | 156 | 68 (43%) | 34 |
| B Control chapter | 113 | 55 (48%) | 40 |
| C Observables chapter (EDMD, time delay, diffusion maps, neural nets, convergence) | 96 | 59 (61%) | 49 |
| D Advanced Koopman chapter | 120 | 40 (33%) | 31 |
| E Intro and basics | 110 | 37 (33%) | 15 |
56 of 191 papers are cited in more than one scope, so scopes overlap and a combined corpus is smaller than the sum.

Recommendation: C first (highest arXiv share, most single-paper sentences, coherent topic), then B (data-driven control is a very clean section) and A. Skip E and D as primary scopes (low arXiv share; intro sentences are survey lists). Section-level focus table: `scratch/arxiv-corpora/koopman/map.md`; sentences with their cited papers: `citing-sentences.json`.
Densest question material: Convergence of data-driven Koopman approximations (24 clean sentences, 30 papers), Data-Driven Control (22, 23), The DMD algorithm (13, 16), nonautonomous and stochastic dynamics (11, 12), Time delay coordinates (11, 7). Poor material despite many citations: Domain applications (67 cited, few clean sentences, list-style), Introduction.
Known limit: a citing sentence states a claim about a paper but may not be answerable from the paper alone; the question review must check the supporting passage exists in the cited TeX.
