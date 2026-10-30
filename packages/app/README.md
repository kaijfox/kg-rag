# @kg/app

The composition root. It is the only package that imports its siblings.

- `src/cli.ts`: the command line, run as `./kg` from the repository root (`pnpm kg` also works). Commands: `ingest`,
  `search`, `status`, `serve mcp`, `serve viewer`, `eval generate`, `eval run`. Options and environment variables are listed by `./kg --help`.
  The root `./kg` script is the launcher to use for `serve mcp`, because pnpm prints its own header on stdout.
- `src/compose.ts`: `compose({ dbPath, artifactDir?, sidecar?, config?, embedder?, llm? })` opens one SQLite file and wires the
  store, event log and eval repo, the parse package (cached artifacts first, the sidecar as an optional fallback), the
  section-pack chunker and chunk view, the Ollama embedder (digest pinned from the space), ingest, search and the
  `KgApi` handlers. It returns the pieces plus `mcpServer()`, `serveMcp()`, `viewer(port?)` and `runEval`.
- `src/ollamaLlm.ts`: the Ollama chat client used for eval generation, answering and judging.
- `scripts/integrate.ts <ingest|search|mcp|eval>`: end-to-end run on `test/corpa/stat-mech` (needs Ollama with
  `embeddinggemma` and `qwen3.5`). `scripts/inspect-log.ts` prints the log of a search or session. Output goes to `scratch/integration/`.
  The baseline drivers (`baseline.ts`, `baselineRun.ts`, `precheck.ts`, `extractPilot.ts`) are the Sprint 2 experiment scripts.
- `test/compose.test.ts`: the same path offline (hash embedder, in-memory database, cached artifacts).

The walking skeleton (a first draft kept as a test oracle) was removed in sprint 3; it is in git history at `9fa235e`.

Known gaps: no config file (options and environment variables only); the sidecar fallback is covered by hand, not by a test here; the CLI has a smoke test only for its usage errors (`test/cli.test.ts`).
