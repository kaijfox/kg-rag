# @kg/parse (WP2, Haiku)

Contract: `@kg/core` CONTRACT_VERSION 0.6.1. You need this card, `core`, and `testkit`; nothing else.

## Implements (core `ports/parse.ts`, `Parser`)
- `class SubprocessParser implements Parser`: `identify(path)` = sha256 of the file bytes + base name;
  `parse(src, recipe)` runs `kg-parse parse --input src.path --recipe <tmp recipe file> --out <dir>` (command
  configurable, default `kg-parse`), reads the written file, validates it, and checks `sourceSha256` and the
  echoed recipe (`canonicalJson` equality) or throws `KgError('upstream')`; a missing binary or exit 3 ->
  `precondition`; exit 2 -> `upstream`. `readArtifact(path)` reads `.kgparse.json` or `.kgparse.json.gz`.
- `class ArtifactDirParser implements Parser`: `parse` finds `DIR/*.kgparse.json(.gz)` with matching
  `sourceSha256` and recipe (no docling needed: the import path for artifacts produced elsewhere), else
  `not_found`; `identify` and `readArtifact` as above.
- Validation: `parseArtifactSchema` from core (throw `invalid_input` with the zod path on failure).

## Formula decoding (0.6.0)
No code change. A recipe with `spec.formulaDecoding` is a different parse recipe: `SubprocessParser.parse` still runs
`kg-parse parse` (the plain docling pass; the sidecar's `check-recipe` accepts and ignores that key for `parse`), and the
decoded artifact comes from the separate `kg-parse decode-formulas` step that ingest runs. `ArtifactDirParser` finds a
decoded artifact by its recipe like any other. `parse` must not fail on a recipe carrying `formulaDecoding`.

## package.json to create
dependencies `@kg/core: workspace:*`; devDependencies `@kg/testkit: workspace:*`. Node builtins only otherwise
(`node:child_process`, `node:fs`, `node:zlib`, `node:crypto`).

## Tests you must pass
`test/conformance.test.ts`, exactly:
```ts
import { parserConformance, registerSuite } from '@kg/testkit/conformance';
import { ArtifactDirParser } from '../src/index';
import { makeArtifactDirHarness } from './harness'; // you write this: copies the mini-corpus v1 artifacts
// (testkit miniArtifact) into a temp dir as <name>.kgparse.json.gz and fake source files whose sha256
// you set as the artifacts' sourceSha256 (rewrite sourceSha256 in the copied envelopes accordingly)
registerSuite(parserConformance(() => makeArtifactDirHarness()));
```
plus `SubprocessParser` against a stub `kg-parse` shell script (writes a fixed envelope; exits 2 or 3 on
request), and a live test skipped unless `KG_SIDECAR=1`. Command: `pnpm --filter @kg/parse test`.

## Fixtures you may read
`testkit/fixtures/mini-corpus/v1/*.kgparse.json`, `testkit/fixtures/docling-real/*`, `testkit/fixtures/parse/tiny.pdf`.

## Forbidden imports
Any `@kg/*` other than core (testkit in tests). No chunking, no store access.

## Decisions already made
Sidecar is a CLI (D7); identity of an artifact is recomputed in TS (`artifactId(sha256, recipeId(recipe))`),
the file name hash is for humans only; artifacts are gzip JSON files.

## Open questions (note, do not decide)
Whether `identify` should also accept non-PDF sources (project databases later).
