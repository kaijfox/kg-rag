# golden: ID vectors for core/src/ids.ts

`ids.json` is produced by `python3 -I oracle.py > ids.json`. The expected canonical JSON strings, normText and
normName outputs were written by hand in oracle.py from the formulas in ids.ts; base32 vectors are RFC 4648
section 10; sha256("abc") is the FIPS 180-2 vector. Every ID is computed by Python's hashlib from those
hand-written strings, never by the TypeScript under test. test/golden.test.ts checks core against them.
Cases worth knowing: object keys sort by UTF-16 code units (U+1F600 before U+FF61), -0 prints as 0,
NBSP and U+3000 are whitespace for normText but U+200B is not, normName keeps brackets "(dls)".
Contract 0.2.0: the build vector uses `build/2` = H(canonical manifest, sorted unique itemIds joined by ',') (R-23).
