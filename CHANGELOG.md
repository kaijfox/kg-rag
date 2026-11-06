# Changelog

Each release says whether an existing database needs `./kg rebuild`. A database that is only a version behind keeps working;
a rebuild is needed when the release changes what is stored for a passage, a fact or a link.

## 0.3.0: first beta

**Rebuild needed: only for markdown sources that contain code blocks.** Existing databases open unchanged, and PDF and
dated-log passages keep their IDs. Markdown is now cut with a new rule (see "Changed"), so a database that holds markdown
with a `#` line inside a code block, or a block over 1,500 characters, has different passage IDs after the next `./kg ingest`
and is best rebuilt with `./kg rebuild`. The first open stamps the index with its format number, and `./kg status` shows which
version built it.

Added:

- Folders as sources. `./kg add <folder>` reads every file in it that the source type can read (`--pattern` keeps only matching
  file names, `--exclude` leaves out matching paths). The next `./kg ingest` picks up new files and retires documents whose
  file was deleted. `./kg remove` takes a source off the list.
- The `html` source type, which reads any HTML page by its headings, and a recipe for a code map built from generated
  documentation (`docs/beta/code-map-prompt.md`).
- Moving extraction between machines: `./kg cache export` and `./kg cache import`, `--cache-only` on `ingest` and `rebuild`,
  and a count of model calls made and answered from the cache.
- Every agent search runs the baseline beside the chosen machine and logs what it would have returned. `./kg report` compares
  them with what agents reported using.
- `./kg export` (a folder to send for review, with `--no-text` to leave out passage text), `./kg report`, `./kg doctor` and
  `./kg version`.
- Questions from real use: `./kg eval from-log` and `./kg eval label`, and `./kg eval run --retrieval-only`.
- `./kg serve mcp --watch`, which re-reads sources when files change.
- The MCP server sends instructions on reporting usage and outcomes, and search results carry `date` and `title` when the source has them.

Changed:

- `./kg init` turns extraction on and chooses `facts-and-neighbours`. `--baseline` keeps plain search with extraction off.
- `./kg ingest` no longer stops when a source path is missing: it warns and keeps that source's documents. `./kg rebuild`
  still stops, because it would leave those documents out.
- A reused chunk now has its metadata refreshed on every ingest, so a log entry whose position in its file moved is not left with stale metadata.
- Markdown and HTML are cut with a new recipe (version 2 of the markdown packing): a `#` line inside a code fence is no longer a heading, and
  a block over 1,500 characters is cut. Chunk IDs of markdown text that has such blocks change, and the pinned PDF questions
  are unaffected.
- The build machine has a new step, `retire`.

Documentation: the first design moved to `design/archive/`. `design/architecture.md` is the current design, and each package
has a README that indexes it.
