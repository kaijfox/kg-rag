# kg-rag

Retrieval over document corpora and project histories for coding and research agents, exposed as MCP tools, with a
viewer that shows what the system did. Similarity search over chunks is the baseline. Extracted facts, links between
records and summaries are layers built on that baseline, and each layer is measured against it.

The current design is `design/architecture.md`. Choices and their reasons are in `design/decisions.md`, and measurements are in
`design/measurements.md`. Agents working on the project read `CLAUDE.md` first. People trying the beta start at
`docs/beta/README.md`. The first design and the proposal that replaced it are kept in `design/archive/`.

## Setup

Requirements: Node 22, pnpm, [Ollama](https://ollama.com) running locally, and `uv` for the PDF parser.

```sh
pnpm install
ollama pull embeddinggemma
ollama pull qwen3.5            # fact extraction, evaluation questions, answers and judging
(cd packages/parse-sidecar && uv sync)   # docling; used only when no parsed copy of a PDF is kept
```

## Use

Run everything from the repository root. A database is a directory (default `./kg-data`, or `--db <dir>`, or `KG_DB`).

```sh
./kg doctor                                   # checks the installation and prints the line that registers it with an agent
./kg init                                     # extraction on, facts-and-neighbours; --baseline for plain search
./kg add papers/ notes.md                     # files or folders: PDFs, markdown, a dated log (--adapter decision-log)
./kg ingest                                   # read new and changed sources; retire those whose file is gone
./kg search "Clausius inequality" -k 5
./kg status                                   # what the index holds, and an audit of the rules
./kg machines                                 # the ways of answering, as lists of steps
./kg serve viewer                             # http://127.0.0.1:4319/ shows sessions and what each step did
./kg report                                   # what agents asked, how they rated it, and how the baseline compared
./kg export                                   # a folder with the history, to send for review
./kg eval generate eval.json --single 8 --multi 4 --topic 3
./kg eval run eval.json --conditions no-context,gold,retrieved --ks 1,5
./kg eval from-log logged.json               # questions from real searches; run them with --retrieval-only
```

Register `./kg serve mcp --db <dir>` as a stdio MCP server in an agent client (`./kg doctor` prints the command). The tools
are `search`, `get_chunks`, `feedback`, `report_usage`, `report_outcome` and `status`. Each connection is one session in the
history, and the server tells the agent how to report. Add `--watch` to re-read sources when files change.

To follow a project history, add its dated log with `--adapter decision-log` and create the database with
`./kg init --machine current-state`, which leaves out entries that a later entry replaced. To map a codebase, see
`docs/beta/code-map-prompt.md`. To run extraction on a faster machine, see `docs/beta/moving-extraction.md`.

### Upgrading

A better extraction prompt, a new module or a new embedding model makes the derived records out of date. The index is
never upgraded in place. `./kg rebuild` builds a new index from the kept sources and swaps it in. Model calls come from the
cache, so only steps whose prompt, model or input changed run again, and corrections that a person confirmed
(`./kg correct alias <name> <canonical>`) are replayed. `CHANGELOG.md` says when a release needs a rebuild. `./kg rebuild --redo extract-facts` copies the index and redoes
one module's records. `./kg rebuild --keep-old` keeps the previous index file, and `./kg diff <old-index-file>` compares
two indexes chunk by chunk.

## How it is built

Four packages, with one direction of dependency (`pnpm depcruise` enforces it).

- `packages/kernel` is the foundation and imports nothing else here. It holds the ID formulas, the three stores, the
  state-machine runner and its load-time check, and the model and embedding interfaces.
  - The **index** (`index.sqlite`) holds everything a rebuild can recreate: documents, chunks, derived items (facts and
    summaries) with the chunks they cite and the names they mention, links (`replaces`, `alias-of`) and embeddings.
  - The **history** (`history.sqlite`) holds what a rebuild must not touch: the event log, notes, evaluation results and
    corrections that a person confirmed. It is keyed to chunk IDs and names.
  - The **cache** (`cache.sqlite`) holds model responses and is pruned to a size cap. Losing it only slows a rebuild.
  - Parsed documents are kept in `artifacts/`, because a rebuild starts from them.
- `packages/modules` is what a use case swaps: source adapters (docling PDF, markdown, dated log, symbol documentation), the
  chunker, the ingest, extraction and search modules, the replacement rule, the machines that wire them, and `ingest` and
  `rebuild`.
- `packages/eval` generates questions with known supporting passages, answers and judges them, and computes retrieval
  metrics, as plain functions over the kernel.
- `packages/app` is the command line, the MCP server, the viewer, and the tools for seeing how the system is used.
- `packages/parse-sidecar` is the Python docling wrapper, used only when no parsed copy of a PDF is kept.

Each package has a README that lists the files to open first.

A **module** is one function with a name, a version and a declaration of which intermediate results of a request it needs
and which it adds. A **state machine** is a short list of module calls with routes between them. The kernel checks every
machine when it loads, refuses one in which a step needs something no earlier step provides, runs the steps, writes each
module's results (modules never write to the index themselves), stamps them with the module's name and version, and logs
every step with what it received and returned. A new way of answering is a new machine over existing modules; a new kind
of source is a new adapter.

## Rules the code enforces

- Every derived item cites at least one chunk, and the store refuses one that does not.
- Derived items and links are never edited. A changed module version produces new records, and a rebuild replaces the index.
- A merge or a replacement is a link, which can be deleted. The records it joins are not touched.
- Chunk IDs come from content, so unchanged text keeps its ID and evaluation questions pinned to chunk IDs stay valid.
- Feedback and evaluation results key to chunk IDs, and every logged event names the index it ran against.
- A source location goes in a chunk's metadata, never in its text, because the text decides the chunk ID.

`pnpm check` runs the type checks, the dependency rules and every test.

## Status

Working: ingest of PDFs (through kept parsed documents or the docling sidecar), markdown, dated logs and generated code
documentation, from files or folders; the baseline, adjacent-chunk, facts-and-neighbours and current-state machines;
rebuild with a model-call cache that can be moved between machines; the MCP tools; the viewer; evaluation, including
questions taken from real use; export, report and doctor for a beta. On the stat-mech corpus the baseline machine
reproduces the first build's recall for all 63 pinned questions (`experiments/baseline-parity.mts`).

Not built: summaries of sections or communities, a ranking walk over the graph, reranking, and verified merging of
duplicate names. Each waits for a measurement that shows room to gain (see `design/architecture.md`).
