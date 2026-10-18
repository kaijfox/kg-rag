# parse package notes (WP2)

## What was done
- `src/artifactFile.ts`: sha256 identify, artifact file reading (plain or gzip), validation against `parseArtifactSchema`.
- `src/subprocess.ts`: `SubprocessParser` runs `kg-parse parse`, maps exit codes (2 upstream, 3 precondition, missing binary precondition), checks source hash and echoed recipe.
- `src/artifactDir.ts`: `ArtifactDirParser` scans a directory for matching artifacts.
- Tests: the exact conformance test file from the card, `test/harness.ts` (copies mini-corpus v1 into a temp dir with fake sources and rewritten sourceSha256), `test/subprocess.test.ts` (stub kg-parse shell script generated at runtime), `test/live.test.ts` (skipped unless KG_SIDECAR=1).

## Results
- `pnpm --filter @kg/parse test`: 25 passed, 1 skipped (live).
- `pnpm --filter @kg/parse typecheck`: exit 0.

## Assumed
- Node builtins beyond the card's list (os, path, url) are used; the card's "Node builtins only" was read as "no third-party packages".
- The recipe is validated with core's `parseRecipeSchema` before the sidecar is called.
- Corrupt files in an artifact directory make parse fail rather than being skipped.

## Surprised by / would flag
- The card's conformance test imports `makeArtifactDirHarness` from './harness', which is written here; the card's wording for the harness was followed as given.
- The exit-2 path maps to `upstream` and exit-3 to `precondition` as stated; other non-zero codes are treated as `upstream`, which the card does not say.
- No change proposal was needed; the contract as read matched the implementation.
