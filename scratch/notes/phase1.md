# Phase 1 working notes (walking skeleton)

## What exists
- pnpm workspace (root `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json` strict + `noUncheckedIndexedAccess`,
  `.dependency-cruiser.cjs`). Packages export TypeScript sources; no build step. `pnpm check` = typecheck +
  depcruise + tests.
- `packages/core` (@kg/core 0.1.0): `ids.ts`, `errors.ts` (KgError codes), `model.ts`, `schemas.ts` (zod),
  `events.ts` (catalog + envelope rules), `scoring.ts`, `conditioning.ts`, `builds.ts` (composeBuild),
  `lookup.ts` (findSearch, Rule 6), `api.ts` (KgApi, TOOLS), `runTool.ts` (runTool, createKgApi),
  `evalTool.ts` (EVAL_RUN_TOOL, loggedLlm), `defaults.ts`, `schema.sql` + `schema.ts`, `jsonSchemas.ts`,
  `ports/*` (infra, parse, embed, store, log, llm, search, ingest), `schemas/*.schema.json` (generated).
- `packages/testkit`: fakes (`src/fakes`), broken fakes (`src/broken`), suites (`src/conformance`, entry
  `@kg/testkit/conformance`), harness helpers (`harnesses.ts`, `minicorpus.ts`), fixtures with READMEs,
  golden vectors with the Python oracle. Tests: fakes pass every suite; meta-test: every suite fails its broken
  fake in the intended case; golden vectors; fixture integrity (incl. an independent re-computation of the
  hand eval metrics).
- `packages/app`: composition root + skeleton implementations (`src/skeleton/`: chunker = section-pack/1,
  ingest, search runner + vector-knn + truncate, api handlers, Ollama embedder/LLM, viewer timeline renderer),
  `mcpCall` (MCP-shaped call without transport), `scripts/skeleton.ts`, `scripts/record-log-fixtures.ts`,
  `scripts/spikes/*` (5a-5c), tests running every relevant suite against the skeleton plus an architecture test.
- Cards + stub `src/index.ts` for parse-sidecar (Python stub), parse, chunk, embed, store, eventlog, ingest,
  search, api, mcp, eval, viewer.
- `test/corpa/stat-mech/artifacts/`: gzipped OCR-off parses of the four PDFs (+ HybridChunker output), the
  input of every spike script.

## How to run
- `pnpm install` (once), `pnpm -r test`, `pnpm -r typecheck`, `pnpm depcruise`.
- `pnpm skeleton` (live embeddinggemma if Ollama is up, else `--hash`); `--query "..."` to change the query.
- Spikes: `cd packages/app && npx tsx scripts/spikes/{chunker-compare,insertion-test,embed-recall}.ts`.
- Regenerate fixtures: `python3 -I build.py` in `testkit/fixtures/mini-corpus` and `testkit/fixtures/eval`;
  `python3 -I oracle.py > ids.json` in `testkit/golden`; `npx tsx scripts/record-log-fixtures.ts ../testkit/fixtures/log`
  in `packages/app`; real slices: `testkit/fixtures/docling-real/make_slice.py` in a docling 2.140.0 env
  (the spike venv: scratchpad `spike/.venv`).

## Assumptions I made
- docling 2.140.0 output layout as observed (furniture inside body.children, captions as children or body
  texts, list groups). The chunk card states the rules explicitly.
- Ollama's `/api/embed` returns L2-normalized vectors (observed); the embedder normalizes anyway.
- ULIDs from SeqIds are digit-only strings of 26 chars, which satisfy the ULID regex; tests depend on them.
- Recall definitions for eval (per unique gold chunk, summaries excluded, positions count all items) are
  mine, taken from the design text; written into the eval fixture README and card.

## What surprised me
- The hand-derived mini-corpus expectations, the Python-oracle IDs and the skeleton chunker agreed on the
  first run; so did the golden vectors (incl. UTF-16 key order). The fixture inequalities in build.py caught
  two of my own wrong length guesses before anything ran.
- The real docling JSON puts page headers inside `body.children` (layer furniture), so a tree walk alone leaks them.
- Kardar's text layer is full of math glyph names; this, not chunking, is the likely retrieval problem there.
- HashEmbedder at 64-256 dims collides so much that hand reasoning about rankings fails; 4096 is clean.
- dependency-cruiser silently ignores imports it cannot resolve; `not-to-unresolvable` was needed to catch
  an undeclared sibling import.
- Rule 4 of the packing (small first block) matters for one chunk out of 312 on the real corpus.

## Flags for the reviewer
- Contract revisions R-01..R-22 are applied in 0.1.0; P-1..P-3 are proposals that I think should land before
  fan-out (P-1 and P-2 from spike 5d). See `scratch/sprint-0/contract-revisions.md`.
- Acceptance tests are code for: chunk, store, eventlog, ingest, search, api, parse (ArtifactDirParser) and the
  embedder contract. For mcp, viewer, eval (metrics and runner), embed (HTTP replay), parse-sidecar (pytest),
  the acceptance is specified in the card against committed fixtures, but the test files are not pre-written:
  their APIs are package-level, not core. A reviewer may want those test files written before fan-out.
- The skeleton does not exercise real SQLite (store/eventlog are Phase 2); schema.sql is checked against real
  SQLite in core's tests (tables, idempotency, triggers, Rule 4 CHECK), not through a CorpusStore.
- The skeleton's logged search was reviewed for diagnosability (design-feedback entry): ranks and scores of the
  whole pool are in the log; texts and the model are one store read away.
- `pnpm skeleton` output for one search is in the final report; a captured run is in the scratchpad
  (`phase1/skeleton-run.txt`, temporary).

## Pre-fan-out fixes (contract 0.2.0)
Applied the lead's scope from `review-phase1.md` section 8 (R-23 to R-32 in contract-revisions.md): build ID over
items, S2 in putBuild + ingest, getItems membership, eval.run.started buildId, RankedRef.queryId, P-3 nesting via
AsyncLocalStorage, P-2b merge-on-retrieve, normText packing, orphanedGold, card updates (chunk, search, ingest,
api, store, eval, mcp, viewer, embed), pre-written eval-runner and MCP suites with controls. Not done by
instruction: P-1, P-2a/c, skeleton promotion (Q5). Mutation rerun: scratchpad `mut2.py` on a copy (`base2`).
