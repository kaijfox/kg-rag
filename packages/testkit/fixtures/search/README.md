# search: queries over the mini-corpus with hand-explained expected rankings

`queries.json` lists queries, the build searched (v1 or v2; the store holds both, v2 current), k, the
expected top labels, labels that must not appear, the expected result count, and the reasoning ("why").
`loadMiniCorpus()` (src/minicorpus.ts) builds the store from the hand-derived expected chunks, with
HashEmbedder(4096) and HASH_SPACE (`{headings}\n{text}` / `{query}`), so search can be tested without a
chunker or ingest. `oracle.py` re-implements HashEmbedder, conditioning, cosine and the tie rule in Python
and checks every expectation; it also reports hash-bucket collisions of query tokens (only s6/s7 have
any, which is why they assert rank 1 only).

What it catches: KNN over superseded chunks (s7, s9), a wrong tie-break (s1, s2, s3, s8, s9 rely on exact
ties: identical vectors, or exactly zero scores, which are exact in any float format because all vector
components are non-negative), truncation off by one (k=3 everywhere, k=50 > 17 chunks in s5), and
embedding without the heading template (s4: "definition" occurs only in a heading).
