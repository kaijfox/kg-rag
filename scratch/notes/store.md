# store (WP5) notes

## What was done
- `src/db.ts`: open (WAL, foreign keys, sqlite-vec), schema apply (skipped when the version is current), busy/locked mapping to `upstream`, immediate transactions, SQLite-to-KgError mapping, prepared-statement cache, float32 LE encoder.
- `src/sqlite-store.ts`: `SqliteCorpusStore` implementing every `CorpusStore` method in the port.
- `src/sqlite-eval-repo.ts`: `SqliteEvalRepo`.
- Tests: conformance (exact text from the card), knn fixture, triggers, build rule, cross-check against the testkit fake (values, rankings, error codes), file reopen, latency report.
- `pnpm --filter @kg/store test`: 73 passed. `pnpm --filter @kg/store typecheck`: clean.

## Assumed
- Item rows carry `created_at` from the injected clock at insert time; putDocVersion uses one timestamp for the whole version.
- Relation node order comes from rowid.
- Vectors are stored as given (not re-normalized); cosine is scale-invariant.
- Zero-norm vectors: sqlite-vec returns NULL for the distance, so the score is coalesced to 0 in SQL.

## Surprised by
- `vec_distance_cosine` returns NULL (not 0 or 1) for a zero-norm argument. Handled with COALESCE.
- The bundled SQLite is 3.50.4 (better-sqlite3 12.4.1 with sqlite-vec 0.1.9 reports vec v0.1.9), not the 3.53.x the card mentions.
- `FixedClock` advances on every `now()` call, so two stores that call the clock at different points produce different timestamps. The cross-check ignores `createdAt`.
- The conformance suite's `putBuild` check order means an existing build with an unsorted item list returns its id; I kept this to match the fake.

## Would flag
- Summary items cannot be stored without a schema change (no run id column). The card says `putItems` accepts summaries. Proposal in `scratch/sprint-1/change-proposals/store.md`.
- Relation node order depends on rowid order, not a stored ordinal.
- Float32 storage: near-tie ordering can differ from the fake (already in the card's open questions).
