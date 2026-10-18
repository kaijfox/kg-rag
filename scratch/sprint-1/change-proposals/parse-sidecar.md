# parse-sidecar: contract clarifications (proposal, not applied)

The CLI and schema work as written. These points are ambiguous and the implementation chose a reading for each.
Please confirm or amend the card.

1. Recipe hash serialization. The card says `sha256(recipe json)[:12]`. Implemented as sha256 of sorted-key,
   no-whitespace UTF-8 JSON. Core and sidecar must agree on this for the file names to match.
2. Decode output timestamps. `decode-formulas` keeps `producedAt` and `producedOn` from the input. Option: set
   `producedAt` to the decode time, which the schema allows, and say so in the card.
3. `stats.undecodedFormulas` meaning. In `parse` it counts `formula-not-decoded` markers in the markdown export.
   In `decode-formulas` it counts formula items whose text was not replaced. Proposal: define it once as
   "formula items with no decoded text", and have `parse` count those too (with no decoder, all formulas).
4. Decoded text form. GLM-OCR returns `$$ ... $$` with `\tag{n}`. Decide whether the stored `text` should be bare
   LaTeX (sidecar strips delimiters) or raw (chunker strips). Not decided here: stored raw, stripped of whitespace.
5. `parse` exit code on invalid recipe. The card gives exit 3 for check-recipe but no code for parse. Implemented as 3.
6. `charsPerPage` may be []. It is filled here; say whether it is meant to be filled.
