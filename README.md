# kg-rag

Retrieval over document corpora for coding and research agents, exposed as MCP tools, with a read-only viewer of
what the system did. The design is in `design/`; the build plan is in `design/261017_v0-implementation-roadmap.md`.

## Setup

Requirements: Node 22, pnpm, [Ollama](https://ollama.com) running locally, and `uv` for the PDF parser.

```sh
pnpm install
ollama pull embeddinggemma
ollama pull qwen3.5            # only for eval generate and eval run
(cd packages/parse-sidecar && uv sync)   # the PDF parser (docling); the CLI finds it there
```

## Use

Run everything from the repository root. `./kg --help` lists the options.

```sh
./kg ingest path/to/papers/              # every PDF in the folder (or one file)
./kg search "Clausius inequality" -k 5   # passages from the current build, with labels and scores
./kg status                              # documents, build, counts
./kg serve viewer                        # http://127.0.0.1:4319/ shows the sessions and their runs
./kg eval generate eval.json --questions 8
./kg eval run eval.json --conditions no-context,retrieved --ks 1,5
```

By default the database is `./kg.sqlite`. Set `--db <file>` or `KG_DB` to choose another. Parsed PDFs are cached
under content hashes; `--artifacts <dir>` or `KG_ARTIFACTS` points at a directory of cached artifacts, which are
used before the parser runs.

### Agent clients

Register `./kg serve mcp --db <file>` as a stdio MCP server in your agent client. The tools are `search`, `feedback`,
`report_usage`, `report_outcome`, `get_items`, `add_note`, `ingest` and `snapshot_build`. Use `./kg` rather than
`pnpm kg` here: pnpm prints a header on stdout, which the protocol cannot carry.

## Where things are

- `packages/` holds the packages (`core` is the contract; `app` is the composition root and the command line).
- `design/` holds the design and the accepted amendments. `scratch/` holds the working records of each sprint.
- `pnpm check` runs the type checks, the dependency rules and every test.

## Status

v0: ingest, search, the event log, the MCP tools, the viewer and the eval harness work end to end on the stat-mech
corpus. Not in v0: the relation layer, graph walk, reranking and community summaries (see the design). The replay
cache for model calls is deferred until debugging needs it, so repeated evaluations re-ask the local model.
