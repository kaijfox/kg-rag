# @kg/app

The composition root. It is the only package that imports its siblings.

- `src/compose.ts`: `compose({ dbPath, artifactDir?, sidecar?, config?, embedder?, llm? })` opens one SQLite file and wires the
  store, event log and eval repo, the parse package (cached artifacts first, the sidecar as an optional fallback), the
  section-pack chunker and chunk view, the Ollama embedder (digest pinned from the space), ingest, search and the
  `KgApi` handlers. It returns the pieces plus `mcpServer()`, `serveMcp()`, `viewer(port?)` and `runEval`.
- `src/ollamaLlm.ts`: the Ollama chat client used for eval generation, answering and judging.
- `src/index.ts`, `src/skeleton/`: the walking skeleton, kept as a test oracle. Not used by `compose`.
- `scripts/integrate.ts <ingest|search|mcp|eval>`: end-to-end run on `test/corpa/stat-mech` (needs Ollama with
  `embeddinggemma` and `qwen3.5`). `scripts/inspect-log.ts` prints the log of a search or session.
  `scripts/serve-viewer.ts` and `scripts/serve-mcp.ts` serve a database file. Output goes to `scratch/integration/`.
- `test/compose.test.ts`: the same path offline (hash embedder, in-memory database, cached artifacts).

Known gaps: no config file loader (the config is a parameter); no CLI wrapper around `compose`; the sidecar fallback is untested here.
