# parse: tiny.pdf for the sidecar's pytest and the optional live parser test

`tiny.pdf` (2 pages, sha256 89511784d5b992ffb41635c63f02e3f209e039b1bfd7604cf9a2e4576618ac86) was printed from
`tiny.source.html` with headless Chrome. Page 1: heading "1 Tiny test document" and two paragraphs (the
second mentions "the ideal gas law"). Page 2: heading "1.1 A small table", a 3x2 table (Gas | Molar mass;
Helium | 4; Argon | 40), one paragraph.

docling 2.140.0, OCR off, parses it to: section_header "1 Tiny test document" (level 1), two text items,
one table with that grid, a trailing text item. Note: docling labels "1.1 A small table" as a list_item
(marker "1.1") inside a list group, not as a section header, so a section-pack chunk of page 2 keeps the
path ["1 Tiny test document"]. Recorded as a heading-detection quirk (design-feedback 2026-10-17).
