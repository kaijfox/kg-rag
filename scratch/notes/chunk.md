# chunk package notes (WP3)

## What was done
- `src/chunker.ts`: section-pack/1 walk, sections, splitting, packing, final merge; `sectionPack` ends in core's `assignChunkIds`.
- `src/render.ts`: `renderChunkView`, a positional walk over the formula blocks of a chunk; `full` returns the stored text.
- `src/blocks.ts`: shared helpers (ref resolution, formula block text, placeholder, block separator). Used by the chunker and the renderer.
- `src/split.ts`: normText length measure and the sentence/hard splitter.
- Tests: the exact conformance file from the card (13 cases), `test/render.test.ts` (full and placeholder views, fixtures with and without formulas, a formula text repeated in prose, out-of-order and missing formulas), `test/split.test.ts`, and `test/docs.ts` (small hand-built artifacts).
- `README.md` with the algorithm notes, observed numbers and known gaps. `scratch/sprint-1/change-proposals/chunk.md` with three proposals.

## Results
- `pnpm --filter @kg/chunk test`: 29 passed (13 conformance, 12 render, 4 split).
- `pnpm --filter @kg/chunk typecheck`: exit 0.

## Assumed
- Packing join length: sum of normalized block lengths plus 2 per join, as the card's explicit rule says. Chunk normText length is one less per join; the goldens agree with the +2 rule.
- Sentence cut: the `.` must lie inside the window; the whitespace and uppercase letter may lie beyond it (oracle diff 1). The whitespace between pieces is dropped.
- Hard cut: the longest prefix with normalized length <= maxChars, trailing whitespace to the next piece (oracle diff 2; unattainable maxChars no longer overshoots).
- Inline groups with formula children render as part of the group; renderChunkView finds them as space-delimited items (review finding 1). Missing `body` is `invalid_input`.
- Tests: 57 (13 conformance, 12 render, 12 split, 21 chunker incl. T/M/m boundaries and final merge).
- Table text: caption lines, then grid lines. Empty parts are left out, so no stray `\n`.
- Table and picture captions: a caption already visited is skipped; a caption that is a child of the table or picture is still emitted (captions are handled before children are marked visited).
- Pages of a table or picture block: its own prov plus its captions' prov. The goldens agree.
- Inline groups: texts joined by one space, empty texts dropped; refs are the group and each descendant text.
- A heading with empty text still starts a section (the card does not say to drop it).
- Recipe validation: algorithm must be `section-pack/1`; targetChars and maxChars positive integers; minChars non-negative integer.
- Unknown docling ref kinds throw `invalid_input`; `key_value_items` and `form_items` refs are skipped.
- The renderer matches a formula only as a whole block (starts the text or follows `\n\n`, and ends the text or is followed by `\n\n`). This is stricter than the card's wording "at or after the end of the previous match"; it is needed for the case "formula text in prose before the formula, same chunk", which the plain wording gets wrong (confirmed). The card's rule is otherwise kept.

## The recommended item (formula measure at placeholder length)
- Implemented: every formula block is measured at 9 whether decoded or not.
- Goldens unchanged: all 13 conformance cases pass. The goldens cannot distinguish the two measures, because all fixtures are undecoded.
- Checked on decoded input: with every formula replaced by a 1296-character LaTeX string, refs, pages and chunk count are unchanged on all seven fixture documents (mini v1/v2 gas and entropy, three real slices). Decoded chunks reach up to 4851 normalized characters, above maxChars; recorded in the README.

## Surprised by / would flag
- The card's `renderChunkView` wording lets a formula's own text match earlier prose in the same chunk. Fixed by the whole-block rule above. The one remaining case is a paragraph that equals the formula text exactly and sits right before it.
- Chunk length: the card says both "+2 per join" and "every length is normText of the text"; those disagree by one per join. Followed the +2 rule.
- The conformance `maxChars` check cannot hold for decoded parses (see the proposal file).
- Docling tables carry `data.grid` (2D array of cells with `text`), so the grid is read from there rather than from `table_cells`. Spans are not expanded: a spanning cell's text appears once in its grid position, as docling gives it.
- The card's `packages/chunk/package.json` already listed `vitest` as a devDependency; kept as it was.
