# @kg/chunk

The section-pack/1 chunker and the chunk view renderer. This package is the only code that reads docling's JSON
layout. It depends on `@kg/core` only.

- `sectionPack` (`src/chunker.ts`): walks the docling body in reading order, builds sections from headings, splits
  blocks longer than `maxChars` at sentence ends or hard, packs each section into chunks, and assigns IDs with core's
  `assignChunkIds`. Pure, synchronous and deterministic; the input is not mutated.
- `renderChunkView` (`src/render.ts`): the embedding text of one chunk. `full` returns the stored text. `placeholder`
  walks the chunk's formula blocks in reading order and replaces each with `[formula]`.
- `src/blocks.ts`: the shared helpers. Docling ref resolution, the formula block text (`formulaBlockText`), the
  `\n\n` block separator and the placeholder. Both the chunker and the renderer use them.
- `src/split.ts`: the normalized length measure and the block splitter.

## Algorithm notes

- Every block length is the length of core `normText`. The packing join adds 2 per `\n\n` (chunk length = sum of blocks +
  2 per join, as the card states).
- Splitting: a `.` inside the window cuts there even if the uppercase letter lies beyond it; the hard cut takes the longest
  attainable length <= `maxChars`, so no piece exceeds it. Formula blocks are
  measured at the placeholder length (9) whether or not they are decoded, so decoding does not move a boundary.
- A chunk's text is its blocks joined by `\n\n`. Its pages are the sorted union of its blocks' pages; its block refs
  are the union in first-seen order.
- A table block is its captions, then the grid (cells joined by ` | `, rows by `\n`). Empty parts are left out, so a
  caption-only table is just the caption. A picture block is its captions joined by `\n`.
- Inline groups are one block: their text descendants joined by one space, empty texts left out. A formula descendant is
  part of the group text (decoded text, or `[formula]`) and is measured at placeholder length when the group fits in
  `maxChars` that way; a group that does not fit is split on its real text.
- A formula inside an inline group is replaced as one whitespace-delimited item of the group text, scanning forward from
  the previous match, so a prose word equal to the formula text earlier in the same group is taken for it. Pieces of a
  split group keep every ref, so a formula that is in another piece is skipped.
- `renderChunkView` accepts a top-level formula occurrence only as a whole block: it starts the chunk text or follows `\n\n`, and
  it ends the chunk text or is followed by `\n\n`. A formula text that appears inside a longer prose block is skipped,
  so it is not replaced. A formula block that cannot be found this way, in order, is an `invalid_input` error.

## Observed on the fixtures

- All 13 chunker conformance cases pass, including the golden chunks, the IDs and the three real docling slices.
- The mini-corpus and the real slices contain undecoded formulas only. Their chunks are the same with the placeholder
  measure, so the golden vectors cannot tell the two measures apart. The tests check the decoded case directly: when
  every formula is given a long LaTeX text, the block refs, the pages and the chunk count are unchanged on all seven
  documents.
- With decoded formulas, chunk text can exceed `maxChars`. The largest chunk measured with decoded LaTeX was 4851
  normalized characters (thermo-plischke-p2-4, every formula replaced by a 1296-character expression). This is the expected
  consequence of the placeholder measure, not a bug. The conformance `maxChars` check holds only for undecoded parses.

## Known gaps

- A prose paragraph that is exactly the formula text, and sits right before the formula block, is taken for the
  formula. Making this exact needs per-block offsets in the stored chunk, which would change the stored shape.
- Empty headings still start a section, as the card says. Their path entry is the empty string.
- Docling's `key_value_items` and `form_items` are skipped, as in v0. Any other unknown ref kind is `invalid_input`.
- Heading levels come from docling's `level` field (default 1). Every header is level 1 on the PDFs seen so far, so
  section paths are one heading deep.
- Formulas, figure captions placed as body text, and chunks that end in a formula placeholder are boundary weaknesses
  of section-pack/1 (see the card's open questions).
