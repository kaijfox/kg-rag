# @kg/parse

Two implementations of core's `Parser` port.

- `SubprocessParser` runs the `kg-parse` CLI (see `packages/parse-sidecar`) for `identify`, `parse` and `readArtifact`.
  It writes the recipe to a temporary file, runs `kg-parse parse --input ... --recipe ... --out ...`, reads the artifact
  it names on stdout, and checks the source hash and the echoed recipe. Exit 3 is `precondition`, a missing executable
  is `precondition`, other failures are `upstream`.
- `ArtifactDirParser` serves artifacts copied from elsewhere: it scans a directory for `*.kgparse.json(.gz)` and returns
  the first one with the requested source hash and recipe, or `not_found`.

Both validate artifacts with core's `parseArtifactSchema` (`invalid_input`, naming the zod path).

## Tests

`pnpm --filter @kg/parse test`: the shared parser conformance suite against `ArtifactDirParser` (over the mini-corpus
v1 artifacts with fake source files) and against `SubprocessParser` (over a stub shell script that copies a fixed
envelope and exits with a requested code), plus unit cases for the error mapping. `test/live.test.ts` runs the real
sidecar on `testkit/fixtures/parse/tiny.pdf` and is skipped unless `KG_SIDECAR=1`.

## Assumptions and known gaps

- `identify` hashes the file bytes and returns the base name. It accepts any file, not only PDFs.
- `parse` checks the recipe with core's `parseRecipeSchema` before running anything. A recipe with `formulaDecoding`
  is passed to the plain `kg-parse parse` pass; the decoded artifact comes from `kg-parse decode-formulas`, which this
  package does not run.
- The sidecar's stdout result is the last line that is a JSON object with a `path` field, so log lines before it are ignored.
- `ArtifactDirParser.parse` reads candidate files in name order. A file in the directory that is not a valid artifact
  makes `parse` fail even if it is not the match, so one bad file blocks the directory. If two valid artifacts match
  the same source and recipe, the first by name wins.
- The sidecar's output path may be relative; it is resolved against the output directory.
- Temporary directories are created per call under the OS temp directory (or `workDir`) and removed afterwards.
- No timeout is set on the sidecar process; a hung sidecar blocks the call.
- Only `node:` builtins are used (child_process, fs, os, path, zlib, crypto).
- The test harness leaves its temporary directories in the OS temp directory.
