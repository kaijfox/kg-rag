# @kg/chunk (WP3, Sonnet)

Contract: `@kg/core` CONTRACT_VERSION 0.6.1. You need this card, `core`, and `testkit`; nothing else.
The only code in the system that knows docling's JSON layout. Frozen before Phase 4 question generation:
any change to its output changes chunk IDs and invalidates the eval set.

## Implements
`export const sectionPack: Chunker` (core `ports/parse.ts`): `(artifact, docKey, recipe) => ChunkDraft[]`.
Pure, synchronous, deterministic, must not mutate its input.
`export const renderChunkView: ChunkViewRenderer` (core `ports/parse.ts`, 0.6.0): `(artifact, blockRefs, chunkText, view) => string`,
the embedding text of one chunk. `blockRefs` are the chunk's refs for a document version (`doc_version_chunks.block_refs`,
in reading order) and `chunkText` is the stored chunk text. View `full` returns `chunkText`. View `placeholder` resolves the
refs in the artifact, takes the `formula` blocks among them in reading order, and replaces each one's text, found in
`chunkText` at or after the end of the previous match, with `[formula]`. The walk is positional and never a global search,
so a formula's text appearing elsewhere in prose is not touched. Formula blocks are never split by the chunker, so each
occurs whole; a formula block that cannot be found in order is an `invalid_input` error. A formula inside an inline group is not a
whole block: it is found as one space-delimited item of the group's text and replaced; if the chunk is a piece of a
split group that lacks it, it is skipped. A parse artifact whose document has no `body` is `invalid_input` for `sectionPack`. Passing the stored text means the
renderer needs no knowledge of how long prose blocks are split into pieces. Ingest's embed state calls it (the embedder never
sees parse structure); `renderDocument` still takes the resulting text. Only this package reads docling structure.
IDs and occurrences come from core's
`assignChunkIds(docKey, drafts)`; never hash anything yourself.

## package.json to create
`{"name":"@kg/chunk","type":"module","exports":{".":"./src/index.ts"},"scripts":{"test":"vitest run","typecheck":"tsc -p tsconfig.json"},"dependencies":{"@kg/core":"workspace:*"},"devDependencies":{"@kg/testkit":"workspace:*"}}`
plus a `tsconfig.json` extending `../../tsconfig.base.json` with `include: ["src","test"]`.

## Tests you must pass
`test/conformance.test.ts`, exactly:
```ts
import { chunkerConformance, registerSuite } from '@kg/testkit/conformance';
import { sectionPack } from '../src/index';
registerSuite(chunkerConformance(sectionPack, { full: true }));
```
Command: `pnpm --filter @kg/chunk test` (and `pnpm --filter @kg/chunk typecheck`). 13 cases: mini-corpus v1 and
v2 golden output, IDs equal to the Python-oracle labels, the v1->v2 survive/vanish/new diff, the duplicate
paragraph, the same paragraph in two sections (`mini-corpus/extra`), a whitespace-only variant of every parse
giving identical IDs, determinism, sizes, recipe parameters honoured, and three real docling slices.

## Fixtures you may read
`testkit/fixtures/mini-corpus/*` (README.md has the hand derivation of every expected chunk; read it, it is
the worked example of the algorithm), `testkit/fixtures/docling-real/*` (real docling 2.140.0, OCR off).

## Forbidden imports
Any `@kg/*` other than `@kg/core` (and `@kg/testkit` in tests). No Python, no docling, no I/O.

## Versioning rule (CP-01c, 0.4.0)
Any change to the chunker's output for any input bumps the recipe `version` (`ChunkRecipeSpec.version`, a top-level
field of the recipe, e.g. `DEFAULT_CHUNK_RECIPE.version`). A change of the algorithm's definition, not just a fix,
also gets a new `spec.algorithm` name (e.g. `section-pack/2`) with a new golden vector. Why: `dv_` is input-addressed
(docKey, artifact, chunk recipe) and `putDocVersion` now throws `immutable_violation` when a stored `dv_` is
re-put with a different chunk list, so an unrecorded output change fails loudly instead of being dropped. Until the
chunker freeze (Phase 4) `version '1'` is provisional and R-11/R-12 style changes are allowed without a bump.

## The algorithm: section-pack/1 (authoritative)
Recipe spec `{algorithm:'section-pack/1', targetChars T, maxChars M, minChars m}`; default T=1000, M=1500,
m=200 (`DEFAULT_CHUNK_RECIPE`). **Every block length is the length of core `normText(blockText)`** (S5, R-30), never the raw
string: a re-parse that differs only in whitespace must give the same boundaries and so the same IDs. **The length of a
packed chunk is the sum of its block lengths plus 2 per `\n\n` join** (a convention, not the normText length of the chunk
text, which is 1 per join): in the mini corpus `gas/1-ab` is 491+2+443 = 936. Rules 4 and 5 use this length.
1. **Walk.** Visit `document.body.children` in order, resolving `$ref` (`#/texts/N`, `#/groups/N`,
   `#/tables/N`, `#/pictures/N`; `key_value_items` and `form_items` are skipped in v0). A ref is visited at most
   once. Skip any node whose `content_layer` is not `body` (missing means body): real docling puts page
   headers and footers in `body.children` with `content_layer: "furniture"`. Also skip labels `page_header`
   and `page_footer` whatever their layer.
   - group: visit its children in order; except label `inline`: join the texts of its text descendants with
     one space into a single block. A `formula` descendant contributes its block text (`[formula]` when undecoded) and
     is measured at placeholder length like a whole formula block; the block's refs are the group's `self_ref` and each
     text descendant's `self_ref`, formula descendants included.
   - text item: `title` -> heading of level 0; `section_header` -> heading of level `item.level` (default 1);
     `formula` -> block `item.text`, or `[formula]` when its normalized text is empty (every formula until a parse recipe
     with `formulaDecoding` fills the text in; see the decoding note under rule 3);
     any other label with non-empty text (text, paragraph, list_item, caption, footnote, code, reference, ...)
     -> block `item.text` (verbatim; list markers are not added). Then visit the item's children.
   - table -> one block: the texts of its `captions` refs (each marked visited, skipping any caption already
     emitted), joined by `\n`, then `\n`, then the grid: each row's cell texts joined by ` | `, rows joined by
     `\n`. Its children are marked visited and not walked. No caption and empty grid -> no block.
   - picture -> one block of its caption texts joined by `\n`; its other children (figure-internal labels)
     are marked visited and never emitted. No caption -> no block.
   - A block whose normText is empty is dropped. A block records its refs (the item's `self_ref`, plus the
     caption refs for tables and pictures) and its pages (`prov[].page_no`).
2. **Sections.** A heading closes the current section. Pop every stacked heading with level >= the new
   level, then push it. The section path is the stack's heading texts (verbatim). Headings never appear in
   chunk text; blocks before any heading have path `[]`.
3. **Split.** A block whose normalized length exceeds M is split into pieces: while the remainder's normalized
   length exceeds M, take the longest prefix of the remainder with normalized length <= M (the window) and cut after the
   last `.` that lies inside the window and is followed by a run of whitespace and an uppercase letter (`\p{Lu}`); the
   whitespace and the uppercase letter may lie beyond the window, the piece ends at the period and so is at most M, and
   the next piece starts at that letter. If there is no such `.`, cut hard at the shortest prefix with the same
   normalized length as the window (trailing whitespace stays with the next piece). Normalized length jumps by 2 across
   a whitespace run, so length M may be unattainable; the piece is then shorter than M, never longer. No piece exceeds
   M. Pieces keep the block's refs and pages.
4. **Pack** (per section, in order): start a chunk with the first block; append the next block if the
   joined length (the +2-per-join length above) is at most T, or if the current chunk is shorter than m and the joined
   length is at most M; otherwise start a new chunk.
5. **Final merge.** If a section produced at least two chunks and the last is shorter than m, merge it into
   the previous one when the result is at most M.
   **Formula blocks are measured at placeholder length** (`[formula]`, 9 characters) in every length above (splitting,
   packing, final merge), whether or not the block was decoded, so boundaries do not move between decoded and undecoded
   parses (the formula pilot saw 312 chunks become 440 when decoded LaTeX counted). Recommended, to verify: the
   implementer checks it against the packing rules and the T/M/m limits (a chunk with decoded formulas may then exceed M in
   characters; state the observed maximum in the README) and against the golden chunks, which must not change for
   undecoded parses. A decoded formula block is never split.
6. Chunk text = blocks joined by `\n\n`; pages = sorted unique union; blockRefs = union in first-seen order.
7. `assignChunkIds(docKey, chunks)`.

## Decisions already made
- TS chunker, not docling's HybridChunker: kept after the Phase 1 spike (decision log 2026-10-17
  "TS chunker kept"; design-feedback "section-pack/1 vs HybridChunker").
- Chunk ID = H(docKey, section path, normText, occurrence); no ordinal (decision log 2026-10-17).
- Chunk IDs are content-addressed (`ch_`): no recipe is in the hash. The chunker's output for one artifact is a
  derivation (`dv_`, input-addressed, core `docVersionId`); `section-pack/1` is the recipe, the plan.
- Rule 4 (small first block may run past T up to M) and title = level 0 are Phase 1 additions to the
  testable draft's spec (contract-revisions R-11, R-12).
- docKey default = file name without extension (decided elsewhere; you receive it).

## Open questions (note in your README, do not decide)
- Every docling header comes out level 1 on these PDFs, so paths are one heading deep; numbering
  ("1.2.1") could give levels. Not in section-pack/1.
- Formulas, figure captions placed as body text, and `[formula]`-ending chunks followed by a "where ..."
  continuation (14% of chunks start lowercase) are known boundary weaknesses; HybridChunker has the same.
- Kardar's PDFs carry math-font glyph names in the text layer ("lparenori", "SLpartialdiff"): a parse
  issue, not yours.
