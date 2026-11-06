# Setup

## Install

You need Node 22 or newer, [pnpm](https://pnpm.io), and [Ollama](https://ollama.com) running locally. To parse new PDFs you
also need [uv](https://docs.astral.sh/uv/).

```sh
pnpm install
ollama pull embeddinggemma
ollama pull qwen3.5            # fact extraction; skip on a machine that will only replay another's results
(cd packages/parse-sidecar && uv sync)    # only for PDFs
./kg doctor
```

`./kg doctor` checks each requirement, says what to do about anything missing, and prints the line that registers the
database with your agent. Run every command from the repository root.

## Create a database and add sources

A database is a folder. Give each project its own.

```sh
./kg init --db ~/kg/myproject
./kg add ~/papers ~/more/paper.pdf --db ~/kg/myproject
./kg ingest --db ~/kg/myproject
./kg search "what does the paper assume about the bath" --db ~/kg/myproject
```

`add` takes files and folders. A folder stands for every file in it that the source type can read, and the next `ingest`
picks up files added later and retires documents whose file was deleted. To stop using a source, run `./kg remove <path>`
and then `./kg ingest`.

`init` turns extraction on and makes `facts-and-neighbours` the search machine, with the plain search logged beside it. Use
`./kg init --baseline` for plain search with extraction off, or `./kg init --machine current-state` for a project log.

| Source | Command |
|---|---|
| PDFs | `./kg add papers/` (the `docling-pdf` source type is chosen from the `.pdf` ending) |
| markdown or text | `./kg add docs/` (`markdown`) |
| a dated project log | `./kg add PROJECT_LOG.md --adapter decision-log` (see `project-log-prompt.md`) |
| HTML pages, such as generated code documentation | `./kg add site/ --adapter html` (see `code-map-prompt.md`) |

If you set `--db` every time is tedious, set `KG_DB=~/kg/myproject` in your shell instead.

## Register it with your agent

`./kg doctor` prints the command for Claude Code, and the same entry as JSON for other clients:

```sh
claude mcp add kg -- /path/to/kg-rag/kg serve mcp --db ~/kg/myproject
```

Add `--watch` to the `serve mcp` arguments to have the server re-read your sources when files change. The server then also
runs one pass when it starts, which picks up changes made while it was off.

The agent can use `search`, `get_chunks`, `feedback`, `report_usage`, `report_outcome` and `status`. The server tells the
agent how to report; `agent-instructions.md` makes that more reliable.

## Upgrading

`./kg status` shows which version built your index. When `CHANGELOG.md` says a release needs a rebuild, run `./kg rebuild`.
It builds a new index from your sources, replays model results from the cache, and keeps your history and corrections.
A running `serve mcp` still reads the old index, so restart it afterwards.
