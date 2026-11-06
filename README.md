# kg-rag

Retrieval over document corpora and project histories for coding and research agents, exposed as MCP tools, with a
viewer that shows what the system did. Similarity search over chunks is the baseline. Extracted facts, links between
records and summaries are layers built on that baseline, and each layer is measured against it.

The design is in `design/`. The reasoning behind the current architecture is in `scratch/proposal-report.html`, and the
decisions made while building it are in `scratch/rebuild/decision-log.md`.

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
./kg init
./kg add path/to/paper.pdf other.pdf          # PDFs, markdown files, or a dated log (--adapter decision-log)
./kg ingest                                   # read new and changed sources into the index
./kg search "Clausius inequality" -k 5
./kg status                                   # what the index holds, and an audit of the rules
./kg machines                                 # the ways of answering, as lists of steps
./kg serve viewer                             # http://127.0.0.1:4319/ shows sessions and what each step did
./kg eval generate eval.json --single 8 --multi 4 --topic 3
./kg eval run eval.json --conditions no-context,gold,retrieved --ks 1,5
```

Register `./kg serve mcp --db <dir>` as a stdio MCP server in an agent client. The tools are `search`, `get_chunks`,
`feedback`, `report_usage`, `report_outcome` and `status`. Each connection is one session in the history.

To search with facts, set `"extract": {"enabled": true}` in the database's `kg.json`, run `./kg ingest`, and pass
`--machine facts-and-neighbours`. To follow a project history, add its dated log with `--adapter decision-log` and search
with `--machine current-state`, which leaves out entries that a later entry replaced.

### Upgrading

A better extraction prompt, a new module or a new embedding model makes the derived records out of date. The index is
never upgraded in place. `./kg rebuild` builds a new index from the kept sources and swaps it in. Model calls come from the
cache, so only steps whose prompt, model or input changed run again, and corrections that a person confirmed
(`./kg correct alias <name> <canonical>`) are replayed. `./kg rebuild --redo extract-facts` copies the index and redoes
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
- `packages/modules` is what a use case swaps: source adapters (docling PDF, markdown, dated log), the chunker, the ingest,
  extraction and search modules, the replacement rule, the machines that wire them, and `ingest` and `rebuild`.
- `packages/eval` generates questions with known supporting passages, answers and judges them, and computes retrieval
  metrics, as plain functions over the kernel.
- `packages/app` is the command line, the MCP server and the viewer.

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

`pnpm check` runs the type checks, the dependency rules and every test.

## Status

Working: ingest of PDFs (through kept parsed documents or the docling sidecar), markdown and dated logs; the baseline,
adjacent-chunk, facts-and-neighbours and current-state machines; rebuild with a model-call cache; the MCP tools; the
viewer; evaluation. On the stat-mech corpus the baseline machine reproduces the first build's recall for all 63 pinned
questions (`scratch/rebuild/baseline-parity.mts`).

Not built: summaries of sections or communities, a ranking walk over the graph, reranking, and verified merging of
duplicate names. Each waits for a measurement that shows room to gain (see the proposal report).
