# Change proposals from @kg/chunk

1. Formula view walk (ports/parse.ts, `ChunkViewRenderer`). The text says the walk is "found at or after the end of the
   previous match" and "never a global search", so a formula's text elsewhere in prose is not touched. That holds for
   prose after the formula, but not for prose before it in the same chunk: "Write PV = NkT first." then the formula
   "PV = NkT" in one chunk renders the prose occurrence. The implementation requires a whole-block match, which fixes
   that case. The one case left is a paragraph that is exactly the formula text and sits directly before it. The full
   fix is to store each block's offset in the chunk text (or each block's text) beside `block_refs`. Proposal: decide
   whether that change is worth a contract bump now, before Phase 4.

2. Chunk length (card rule 5). "Joined length (+2 per \n\n)" and "every length is normText" disagree by one character per
   join, because normText turns `\n\n` into one space. The implementation follows the explicit +2 rule, and the golden
   chunks agree. The card should say which one is meant, with the mini-corpus arithmetic as the example.

3. Decoded formulas and the maxChars check. The placeholder measure means a decoded parse can produce chunks longer
   than maxChars (4851 normalized characters observed). The card allows it in rule 5, but the conformance case "every
   chunk is at most maxChars" would fail on any decoded parse. The suite should either check undecoded parses only or
   check against the placeholder-measured length.
