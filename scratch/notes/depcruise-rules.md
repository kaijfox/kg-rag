# Dependency-cruiser rules for @kg/pipeline

Rules added to `.dependency-cruiser.cjs` for the new shared package `packages/pipeline` (`@kg/pipeline`), per state-machine-revision.md section 5.

## Rules

- `star-rule` (amended): `^packages/pipeline/` added to the allowed targets, so search, ingest and eval may import it. Narrowed by the next rule.
- `pipeline-kit-importers`: only search, ingest, eval, app (and pipeline itself) may import `^packages/pipeline/`.
- `pipeline-imports-core-only`: pipeline source imports only `@kg/core` and itself (npm packages are not limited).
- `pipeline-tests-import-core-or-testkit`: pipeline tests may also import `@kg/testkit`.
- `xstate-only-in-pipeline`: `xstate`, `@xstate/*` and `@statelyai/*` npm targets may be imported only from pipeline. `@statelyai/inspect` is excluded here (see the next two rules).
- `statelyai-inspect-app-devdep-only`: only app may import `@statelyai/inspect`.
- `statelyai-inspect-not-runtime-in-app`: app must list `@statelyai/inspect` as a devDependency, not a runtime dependency.
- Config option `exclude` now also skips `.venv/` (Python virtualenv under parse-sidecar), whose JS files otherwise produce unresolvable-import errors.

## Verification

Each violating file was created, `pnpm depcruise` was run, the rule that fired was noted, and the file was deleted.
Where the target package was not declared (so the import did not resolve), a temporary symlink in that package's `node_modules` stood in for the declared dependency.

| Case | Temporary file | Rule(s) that fired |
| --- | --- | --- |
| viewer imports `@kg/pipeline` | `packages/viewer/src/tmp-violation.ts` | `pipeline-kit-importers` |
| store imports `xstate` | `packages/store/src/tmp.ts` | `xstate-only-in-pipeline` |
| pipeline/src imports `@kg/store` | `packages/pipeline/src/tmp.ts` | `star-rule`, `pipeline-imports-core-only` |
| pipeline/test imports `@kg/store` | `packages/pipeline/test/tmp-bad.ts` | `star-rule`, `pipeline-tests-import-core-or-testkit` |
| viewer imports `xstate` | `packages/viewer/src/tmp-xstate.ts` | `xstate-only-in-pipeline` |
| viewer imports `@statelyai/inspect` | `packages/viewer/src/tmp-inspect.ts` | `statelyai-inspect-app-devdep-only` |
| app imports `@statelyai/inspect`, declared as devDependency | `packages/app/src/tmp-app.ts` | none (clean) |
| app imports `@statelyai/inspect`, declared as runtime dependency | `packages/app/src/tmp-app.ts` | `statelyai-inspect-not-runtime-in-app` |
| search imports `@kg/pipeline` (positive control) | `packages/search/src/tmp-ok.ts` | none (clean) |
| pipeline/test imports `xstate` and `@kg/testkit` (positive control) | `packages/pipeline/test/tmp-ok.ts` | none (clean) |

The app devDependency checks temporarily edited `packages/app/package.json` and restored it byte for byte.

## Pattern gotchas

- npm targets resolve to `node_modules/.pnpm/xstate@5.33.2/node_modules/xstate/...` under pnpm. The pattern `node_modules/(xstate|@xstate|@statelyai)/` matches that path (checked with `-T json`).
- An import whose package is not declared resolves to nothing and fires `not-to-unresolvable`, not the path rule. An undeclared `xstate` import shows `dependencyTypes: npm-no-pkg`, so the xstate rule lists `npm-no-pkg` and `npm-unknown` as well as `npm`, `npm-dev`, `npm-peer`, `npm-optional`.
- Because `node_modules` is not followed, the npm target is reported with its resolved path. The path is still matched, so `pathNot` on that path works (used for `@statelyai/inspect`).
- A symlink from one package's `node_modules` into another package resolves to the real sibling path, so `star-rule` also fires in such tests. This is a test artifact, not a bug.
- `packages/parse-sidecar/.venv` (Python) holds JS files that were reported as unresolvable imports, so it is excluded.
