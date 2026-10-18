# golden: ID vectors for core/src/ids.ts

`ids.json` is produced by `python3 -I oracle.py > ids.json`. The expected canonical JSON strings, normText and
normName outputs were written by hand in oracle.py from the formulas in ids.ts; base32 vectors are RFC 4648
section 10; sha256("abc") is the FIPS 180-2 vector. Every ID is computed by Python's hashlib from those
hand-written strings, never by the TypeScript under test. test/golden.test.ts checks core against them.
Cases worth knowing: object keys sort by UTF-16 code units (U+1F600 before U+FF61), -0 prints as 0,
NBSP and U+3000 are whitespace for normText but U+200B is not, normName keeps brackets "(dls)".
Contract 0.2.0: the build vector uses `build/2` = H(canonical manifest, sorted unique itemIds joined by ',') (R-23).
Contract 0.5.0: the search recipe is a machine recipe (`machine`, `settings`, `topology`), so only `DEFAULT_SEARCH_RECIPE`'s `rc_` changed (`rc_dsttj7ftrqu6ebxcedps` to `rc_o3vj74kof7ugqctjnqhn`); its topology is the `similarity` machine's fingerprint, which the search package asserts.
Contract 0.6.0: `EmbeddingSpaceSpec.formulaView` is part of the hashed space spec, so `DEFAULT_SPACE`'s `es_` changed; `DEFAULT_PARSE_RECIPE` has no `formulaDecoding` key and keeps its `rc_`; a new recipe vector covers a parse recipe with `formulaDecoding` (its test-only recipe is built in golden.test.ts).
