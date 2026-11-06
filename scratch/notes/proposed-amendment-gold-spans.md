# Proposed amendment: gold evidence as source spans (DRAFT, not applied)

Status: awaiting user approval. `design/` is unchanged. Motivation and scoping: `arxiv-corpora-scoping.md`.

## Text to add to Amendments in `design/260916_initial-roadmap.md`

**2026-11-06. Gold evidence can be a source span; chunk gold is derived from it.** (arXiv paired-corpus scoping; placement: Eval harness (v0 item 6), after "The eval set is pinned to chunk IDs.", and Search, after the paragraph on source chunk IDs.)
A question's gold evidence may be recorded as one or more source spans in addition to chunk IDs. A span names a document, an anchor that does not depend on chunking (a section path plus paragraph or equation label for sources with structure, otherwise a character range of the normalised source text), and the exact span text. When the same document is ingested by two routes (for example its TeX source and its PDF), a span is mapped to the chunks of each build by aligning the span text against the build's chunks; the chunks that overlap the span are that build's gold chunks. A span that cannot be aligned to any chunk is reported as an ingestion loss for that build and is not silently dropped. Questions are still generated on the fly, from a span instead of a chunk where the corpus has a structured source. An eval set that records only chunk IDs stays valid (a chunk is a span in its own build), and recall@k, the three answer conditions and the judge are unchanged. For a cross-corpus question, gold is a span in each document the answer needs; the citing sentence of a review fixes the first span and the supporting passage in the cited work, found and checked during question review, fixes the second.
The statement "A change to chunking requires regenerating the questions for the affected chunks" then applies only to chunk-pinned sets; span-pinned sets are re-mapped, not regenerated.

## What changes in code (not part of the amendment text)
- Eval set row: optional `goldSpans` next to `goldChunkIds`; ids of a span-pinned set derive from the spans.
- A span-to-chunks alignment function (normalise whitespace, case, and LaTeX markup on the TeX side; match against chunk text; return overlapping chunk ids and an overlap fraction).
- Recall and gold-context conditions read the mapped chunk ids per build; the run record stores the mapping used.
- Generate machine: a span source (TeX section tree) as an alternative to chunk sampling.
- A report of unaligned spans per build (the PDF-ingestion failure list).

## Cost and risk
- Alignment on PDF-derived text is the hard part: glyph-name junk (Kardar: 57% of chunks) and placeholder formulas lower overlap. Use a threshold on matched characters, and report the distribution, not a pass/fail.
- A span overlapping two chunks makes both gold, which matches how adjacent-gold is already counted.
- It does not change search, chunking or the store.

## Alternatives considered
- Independent generation per route, compare aggregates: no new machinery, but questions differ between routes, so differences cannot be attributed to ingestion, and no failures can be localised.
- Pin on a fixed chunker only: breaks as soon as the chunk recipe is versioned.
