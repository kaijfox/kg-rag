# @kg/chunk (WP3, Sonnet)

Contract: `@kg/core` CONTRACT_VERSION 0.2.0. You need this card, `core`, and `testkit`; nothing else.
The only code in the system that knows docling's JSON layout. Frozen before Phase 4 question generation:
any change to its output changes chunk IDs and invalidates the eval set.

## Implements
`export const sectionPack: Chunker` (core `ports/parse.ts`): `(artifact, docKey, recipe) => ChunkDraft[]`.
Pure, synchronous, deterministic, must not mutate its input. IDs and occurrences come from core's
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

## The algorithm: section-pack/1 (authoritative)
Recipe spec `{algorithm:'section-pack/1', targetChars T, maxChars M, minChars m}`; default T=1000, M=1500,
m=200 (`DEFAULT_CHUNK_RECIPE`). **Every length is the length of core `normText(text)`** (S5, R-30), never the raw
string: a re-parse that differs only in whitespace must give the same boundaries and so the same IDs.
1. **Walk.** Visit `document.body.children` in order, resolving `$ref` (`#/texts/N`, `#/groups/N`,
   `#/tables/N`, `#/pictures/N`; `key_value_items` and `form_items` are skipped in v0). A ref is visited at most
   once. Skip any node whose `content_layer` is not `body` (missing means body): real docling puts page
   headers and footers in `body.children` with `content_layer: "furniture"`. Also skip labels `page_header`
   and `page_footer` whatever their layer.
   - group: visit its children in order; except label `inline`: join the texts of its text descendants with
     one space into a single block.
   - text item: `title` -> heading of level 0; `section_header` -> heading of level `item.level` (default 1);
     `formula` -> block `item.text`, or `[formula]` when its normalized text is empty (always, in v0);
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
   length exceeds M, take the longest prefix of the remainder with normalized length <= M and cut after the
   last `.` in it that is followed by a run of whitespace and an uppercase letter (`\p{Lu}`); the next piece
   starts at that letter. If there is no such `.`, cut hard at the SHORTEST prefix whose normalized length is M
   (trailing whitespace stays with the next piece). Pieces keep the block's refs and pages.
4. **Pack** (per section, in order): start a chunk with the first block; append the next block if the
   joined length (`+2` per `\n\n`) is at most T, or if the current chunk is shorter than m and the joined
   length is at most M; otherwise start a new chunk.
5. **Final merge.** If a section produced at least two chunks and the last is shorter than m, merge it into
   the previous one when the result is at most M.
6. Chunk text = blocks joined by `\n\n`; pages = sorted unique union; blockRefs = union in first-seen order.
7. `assignChunkIds(docKey, chunks)`.

## Decisions already made
- TS chunker, not docling's HybridChunker: kept after the Phase 1 spike (decision log 2026-10-17
  "TS chunker kept"; design-feedback "section-pack/1 vs HybridChunker").
- Chunk ID = H(docKey, section path, normText, occurrence); no ordinal (decision log 2026-10-17).
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
