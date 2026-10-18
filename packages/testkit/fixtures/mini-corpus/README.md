# mini-corpus: hand-built DoclingDocuments with hand-derived section-pack/1 output

Two documents (`gas`, `entropy`) in two versions, as kg parse-artifact envelopes (`v1/`, `v2/`). `build.py`
assembles the DoclingDocument JSON from named blocks and writes the expected output; the grouping of
blocks into chunks was derived by hand from the rules below, and `build.py` asserts every inequality the
derivation relies on (so an edit to a block that breaks the derivation fails the build). Chunk IDs in
`labels.json` come from an independent Python implementation of core's `chunkId`.

Files: `expected-chunks-v1.json`, `expected-chunks-v2.json` (per document: label, section path, blocks,
occurrence, pages, blockRefs, text), `expected-diff.json` (which v1 chunk IDs survive in v2, vanish, are
new), `labels.json` (label -> chunk ID).

## Rules used (section-pack/1 with T = targetChars 1000, M = maxChars 1500, m = minChars 200)
Lengths are JS string lengths; a chunk's length is the sum of its blocks plus 2 per `\n\n` join.
1. Walk `body` in order; drop non-body layers and page headers/footers; headings start sections; a formula
   becomes `[formula]`; a table becomes caption + `\n` + rows (`cell | cell`); a picture becomes its caption.
2. Section path: heading stack by level (title = level 0, equal or deeper levels are popped).
3. A block longer than M is split at the last `. `+uppercase boundary that keeps the piece <= M, else hard at M.
4. Pack: append a block if the joined length <= T, or if the current chunk is < m and the joined length <= M;
   otherwise start a new chunk.
5. If a section ends with a chunk < m and merging it into the previous chunk stays <= M, merge.

## Block lengths (measured from the input, printed by build.py)
G_PRE 80, P1a 491, P1b 443, P1c 98, P1d 910, P1e 1037, N 300, P2a 266, P2b 266, TABLE 137 (caption 68 + grid),
P3 3231 (32 sentences of exactly 100 chars incl. the period, single spaces), C_P 44 (figure caption),
S 106, L 1086, D 233, X 880, LI1 80, LI2 75, LI3 68, H 1600 (numbers, no period), A1 587, A1v2 584, A2 427.

## gas v1 (8 chunks)
- `gas/pre` []: G_PRE alone (80). The page header "Lecture notes on gases" is furniture and dropped.
- Section `1 Ideal gases` (level 1):
  - `gas/1-ab`: P1a + P1b = 491+2+443 = 936 <= 1000. Adding P1c gives 936+2+98 = 1036 > 1000 and 936 >= 200: close.
    The running page header "1 Ideal gases" between P1b and P1c is furniture: it neither appears nor opens a section.
  - `gas/1-cd`: P1c (98 < 200) + P1d: 98+2+910 = 1010 > T but <= M and the current chunk is below m: rule 4 appends.
    Adding P1e: 1010+2+1037 > 1500: close.
  - `gas/1-e`: P1e alone (1037). Section ends; 1037 >= 200, no merge.
- `gas/1.1` [1 Ideal gases, 1.1 Pressure] (level 2 under level 1): P2a + [formula] + P2b + TABLE =
  266+2+9+2+266+2+137 = 684. Table text: caption line then `Gas | Molar volume | Unit`, `Helium | 22.4 | litre`, `Argon | 22.4 | litre`.
- Section [1 Ideal gases, 1.2 Temperature] (level 2 replaces 1.1): P3 is 3231 > 1500, split at sentence ends:
  14 sentences = 14*100+13 = 1413 <= 1500 (15 would be 1514), again 1413, remainder 4 sentences = 403.
  - `gas/1.2-p1`: 1413 alone; adding the next piece exceeds T and 1413 >= m.
  - `gas/1.2-p2`: 1413 alone.
  - `gas/1.2-p3`: 403 + figure caption 44 = 449. The picture's internal labels "0 C" and "100 C" are picture
    children and never appear. Pages [4, 5]: P3 spans pages 4-5.

## entropy v1 (9 chunks)
- Title "Entropy" (level 0) heads every path.
- `entropy/2` [Entropy, 2 Entropy]: S (106 < 200) + L: 106+2+1086 = 1194 > T, <= M, current below m: append (rule 4).
  Without rule 4, S would be a 106-char chunk of its own.
- Section 2.1 Definition: D, X, D (the same paragraph twice).
  - `entropy/2.1-d0`: D (233); D+X = 233+2+880 = 1115 > 1000 and 233 >= 200: close. occurrence 0.
  - `entropy/2.1-x`: X (880); X+D = 1115 > 1000: close.
  - `entropy/2.1-d1`: D again, same section and normalized text, so occurrence 1 and a distinct ID.
- Section 2.2 Third law: a list group of LI1..LI3, then H (1600, no `. `).
  - `entropy/2.2-list`: 80+2+75+2+68 = 227. Adding H's first piece (1500) exceeds M: close.
  - H has no sentence end, so it is hard-split at 1500: `entropy/2.2-h1` (1500) and `entropy/2.2-h2` (100).
    The final piece is < 200 but 1500+2+100 = 1602 > 1500, so rule 5 does not merge it.
- Section [Entropy, 3 Applications] (level 1 pops 2 Entropy and 2.2): `entropy/3-a1` = A1 (587);
  A1+A2 = 587+2+427 = 1016 > 1000: close. `entropy/3-a2` = A2 (427).

## v2 and the expected diff
- gas: paragraph N (300) inserted at the start of `1 Ideal gases`.
  N+P1a = 793 <= 1000; +P1b = 1238 > 1000: `gas/v2/1-na`. P1b+P1c = 543; +P1d = 1455 > 1000: `gas/v2/1-bc`.
  P1d+P1e = 1949 > 1000: `gas/v2/1-d` = P1d. Then P1e alone: same text, same section, occurrence 0, so
  `gas/1-e` keeps its ID. Greedy packing cascades to the end of the section and resynchronises at P1e.
- entropy: A1 edited in place (one sentence: "A refrigerator runs" -> "A heat pump runs"): `entropy/3-a1`
  vanishes, `entropy/v2/3-a1` is new, `entropy/3-a2` survives.
- Every chunk outside the two touched sections survives. An index-based ID scheme (the Phase 0 spike's
  sha256(index|text)) fails: the gas insertion adds a chunk, so every later index shifts.

Result: survive 14 (`gas/pre`, `gas/1-e`, `gas/1.1`, `gas/1.2-p1..p3`, all entropy chunks except `3-a1`),
vanish 3 (`gas/1-ab`, `gas/1-cd`, `entropy/3-a1`), new 4 (`gas/v2/1-na`, `gas/v2/1-bc`, `gas/v2/1-d`, `entropy/v2/3-a1`).

## What a wrong implementation gets wrong here
furniture leaking (page header text or a running header opening a section); picture labels leaking; the
duplicated paragraph colliding (missing occurrence); the long paragraph not split or split mid-sentence;
the number list not hard-split; the table dropped; heading levels ignored (2.1/2.2 flattened); the
small-first-block rule missing (`entropy/2` and `gas/1-cd` split); the final-merge rule over-applied
(`entropy/2.2-h2` merged past maxChars).

## extra/ (added for contract 0.2.0)
`extra/dupsec.kgparse.json`: paragraph D (233 chars) is the only block of section "A Gases" and of section
"B Liquids". Occurrence is counted per (section path, normalized text), so both chunks are occurrence 0 and
their IDs differ by the section path only (labels `dupsec/a`, `dupsec/b`). A chunker that counts occurrences
across sections gives the second occurrence 1 (review mutant M03).

## Lengths are normalized (contract 0.2.0, S5)
All lengths above are normText lengths; the fixture text is single-spaced, so they equal the raw lengths.
chunkerConformance also doubles every space and turns sentence-separating spaces into newlines or tabs in every
text item and requires the same chunk IDs; sentence ends are therefore "." + any whitespace run + uppercase.
