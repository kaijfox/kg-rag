# Beta preparation: where this stopped, and why

Written 2026-11-06 at the end of a long session. Nothing is committed. The tree is **not green**: see "Unfinished" below.

## What we are doing and why

We are getting the rebuilt system ready for beta testers who will use it on papers, library documentation, project logs and a
codebase map. The constraints the user set along the way:

- kg-rag indexes what it is pointed at. It does not manage corpora. Adapters and small helpers are the extension point.
- Extraction must be on in the beta, and may run on a faster machine; the transferable thing is the model-call cache file.
- No agent tool for appending to a project log: a prompt teaches the user's agent the format instead.
- A code map is **generated documentation only** (Sphinx, pdoc, TypeDoc output built from docstrings), ingested as it is.
  No raw source code, no source-line mapping, no converters of ours, no per-language work. HTML ingestion is wanted as a
  general feature, not specialised for code docs.
- The old design was superseded, not patched. Package READMEs are light indexes. No numbered labels (D1, Q8) anywhere.

## Done and checked (before the last direction change)

- Documentation base: `CLAUDE.md`, `design/architecture.md`, `design/decisions.md`, `design/measurements.md`,
  `design/archive/`, package READMEs, `docs/beta/`, `CHANGELOG.md`, and a test that fails when a document names a command,
  option, machine or file that does not exist (`packages/app/test/docs.test.ts`).
- Beta features, with tests: folder sources and retirement of vanished files, `exclude` and `pattern` filters, cache export and
  import and `--cache-only`, shadow-run logging of the baseline, `kg export` / `report` / `doctor` / `version`, questions from
  real use (`eval from-log`, `eval label`, `--retrieval-only`), `serve mcp --watch`, MCP instructions, format stamp.
- Checked with the real models: moving extraction between two databases (0 model calls on the second), and a live
  `serve mcp --watch` process that re-read a new note and extracted its facts.
- A bug found and fixed: a reused chunk's metadata was never refreshed (matters for a log entry whose `entryKey` shifts).

## Changed direction late in the session (code done, docs not)

The earlier code-map route (a TypeDoc-to-markdown converter, a `symbol-docs` adapter with `Source: path:line` lines, source
locations in chunk metadata) was **removed**. In its place:

- A plain `html` adapter (`packages/modules/src/adapters/html.ts`, uses `parse5`): headings are the section path, text under
  them becomes passages, navigation and scripts are skipped, `<main>` is preferred. A section under 120 characters is folded
  into its parent with its heading text in front.
- `markdownPieces` is now fence-aware (a `#` line inside a code fence is not a heading), and `packParagraphs`
  (`adapters/pack.ts`) cuts any block longer than 1,500 characters. Reason: one huge code block with no blank lines crashed an
  ingest by exceeding the embedding model's context. The markdown/HTML chunk recipe is now `markdown-pack/2`.
- `exclude` filter for folder sources, `.html` recognised by `adapterFor`.
- Removed: `packages/modules/src/helpers/typedoc.ts`, `kg helper typedoc`, `typedoc.json`, `tsconfig.docs.json`, the root
  `typedoc` dependency, source-line fields in MCP results (only `date` and `title` remain).
- Real pages from pdoc, Sphinx and TypeDoc were run through the adapter. TypeDoc (headings per member) chunks well. Sphinx
  chunks coarsely (no headings per symbol). pdoc embeds each module's whole source in "View Source" blocks, which become
  passages. TypeDoc pages carry an "On This Page" menu and "Preparing search index..." text as noise.

## Unfinished

1. **Documents still describe removed features.** `docs/beta/code-map-prompt.md` (TypeDoc converter, `Source:` lines,
   `kg helper`), `docs/beta/post-commit.sh`, `docs/beta/setup.md` (table row for `symbol-docs`), `CHANGELOG.md`,
   `packages/modules/README.md` (helpers, symbol-docs), `CLAUDE.md` and `design/architecture.md` (the rule that a source
   location goes in metadata and not text), root `README.md`. The docs drift test fails on these until they are rewritten.
   Rewrite the code-map guide as: write docstrings, run your generator, `kg add <output folder> --exclude '<site noise>'`, with
   the limits above stated.
2. **`design/decisions.md` needs a new entry** reversing the code-map decision (append, do not edit the old one), and
   `design/measurements.md` needs a note that the earlier code-map result (19 of 20 for both, 4.6 times less text) was for the
   removed route.
3. **The self-test is unresolved.** `experiments/code-map-selftest.mts` now ingests only the TypeDoc HTML site (686 passages).
   It reported 0 of 20, which is almost certainly a bug in how it maps a result's `docKey` to a file (the search returned
   text), not a real result. A `DEBUG_KEYS` line was added to print the keys of the first question; the output was never read.
   Remove that line once fixed. Do not quote 0 of 20 anywhere.
4. **Memory file** `project-scope-rules.md` should record: generated documentation only, no source mapping, HTML adapter
   stays general.
5. Run `pnpm check` at the end; it was green before the direction change and has not been run since.

## Open decisions for the user

- `kg init` makes `facts-and-neighbours` the default although facts are unproven; the baseline is shadow-logged to settle it.
- The sidecar's Python tests point at paths removed in the rebuild and do not run.
