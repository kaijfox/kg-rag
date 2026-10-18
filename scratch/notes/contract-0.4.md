# Contract 0.4.0 (R-34)

Done: CP-01a digest (model.ts, zod, DEFAULT_SPACE with the live digest of embeddinggemma:latest read from Ollama /api/tags, test spaces get fake digests, golden es_ regenerated with oracle.py, embed card text), CP-01b (port doc, fake, conformance case, broken SilentDocVersionStore + meta test), CP-01c (chunk card), CP-02 rename (model.ts, schema.sql CHECK, tests), events (`previousDocVersionId`, `revert`), skeleton ingest (emits both), S-11 conformance case, version stamps, lifecycle.md, contract-proposals.md, contract-revisions.md R-34.

Choices:
- digest is required in the spec (it must enter the id); fake digests `fake-...` for HASH_SPACE and the store conformance SPACE.
- Both event fields are optional in zod and always set by ingest: additive, old logs and fixtures still validate, schemaVersion stays 1. `revert` over a new `build.current` event or a rename: least invasive.
- `revert` is computed as "the composed build id already existed before putBuild"; the old build is moved to again, parentId = previous current build.
- Ordered chunk-list comparison for putDocVersion (chunkIds is an ordered list).
- schema_version not bumped (no DB exists); skeleton `ollamaAvailable` untouched (typecheck did not force it); JSON schemas in packages/core/schemas cover only parse artifact/recipe, so unchanged.
