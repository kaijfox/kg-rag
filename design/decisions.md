# Decisions

An append-only log of the choices that shaped the current architecture, each with its reason and what it replaces. A new
entry goes at the end under a heading with its date and a short title, so entries can be referred to by name. Entries under
"Decisions" and "Decisions made while building" were written during the rebuild on 2026-11-06 and are not dated individually.

The rebuild followed the proposal in `design/archive/proposal-report.html`. Standing constraints from the working
preferences: edits to `design/` need the user's approval; local Ollama for every model call; cheap options first; plain words
in documents that outlive the work, with no sprint markers in READMEs or code comments.

## Plan

1. Commit the old state (done: commit 04f2913), then replace the 17 packages with four: `kernel`, `modules`, `eval`,
   `app` (plus the Python `parse-sidecar`, unchanged).
2. `kernel` holds what every use case shares: IDs, the three SQLite stores (index, history, cache), the module and
   state-machine types with the load-time check, the runner, and the model and embedding interfaces.
3. `modules` holds the things a use case swaps: chunker, parser adapters, ingest and search modules, fact extraction,
   the "replaces" rule, the machines that wire them, and `rebuild`.
4. `eval` keeps the question generator, answerer, judge and metrics, as plain functions over the kernel.
5. `app` holds the `kg` command line, the MCP server and the session viewer.

## Decisions

**Four packages instead of seventeen.** The reviews found that package boundaries followed our implementation
(parse, chunk, embed, store) and not what varies between use cases. The seams that matter are now module kinds, not
packages. Replaces: api, chunk, core, embed, eventlog, ingest, mcp, parse, pipeline, search, sqlite, store, testkit,
viewer. The import rule shrinks to: kernel imports nothing in `packages/`; modules imports kernel; eval imports kernel
and modules; app imports all three.

**Own state-machine runner, no XState.** A machine is plain data: states, each naming a module and a next state or
a guarded route. The runner checks at load that every module exists and every slot a state needs is provided by the
start or added by a state on every path to it (a small data-flow check), and logs each step. XState cost 258 lines of
toolkit, a topology fingerprint that moved every saved index when a label changed, and a 5.5 MB diagram library for the
viewer. The machines are still explicit, nameable and drawable from their plain data. Loops are a route back to an
earlier state. Replaces: `@kg/pipeline`, xstate, the pinned topology files.

**A database is a directory.** `kg.json` (configuration and the source list), `index.sqlite` (rebuildable),
`history.sqlite` (durable: event log, feedback, evaluation results, confirmed corrections), `cache.sqlite` (optional:
model responses), `artifacts/` (parsed documents, kept). `rebuild` writes `index.<id>.sqlite.tmp`, then renames it over
`index.sqlite`; the old file is deleted unless `--keep-old`. Replaces: one file holding everything, builds, snapshots.

**Chunk IDs and the chunker are unchanged.** The 63 pinned evaluation questions cite chunk IDs, so the ID formula
and the section-pack chunker move over untouched. A test checks that re-chunking the real artifacts gives the IDs that
the pinned evaluation sets name.

**Derived items are `facts` and `summaries`, one table.** ID = hash of kind, the module name and version, the
sorted source chunk IDs and the normalised text. Text is in the hash because models give different sentences for the
same input and a new sentence must be a new record. A derived item with no source chunk is refused by the store
(inside the commit, so a failed module leaves nothing behind).

**Mentions are a plain table; names are normalised strings.** No node table. `normName` from the first build is
reused.

**Links have two kinds, `replaces` and `alias-of`.** `refines` is left out: it was motivated only by the concept
framework demand, which is deferred. A link records the module that made it. `replaces` runs from the newer record to
the older one. Confirmed corrections (aliases a person approved) live in the history and are replayed by rebuild.

**Facts come from one extraction call per chunk.** The model returns `{"facts": [{"text", "names"}]}`. A fact must
be a standalone sentence; the module rejects empty text, empty names and text copied verbatim from the chunk beyond a
length (nothing is dropped silently: rejected drafts are logged with a reason). The first build's pilot found a second
"anything missed" pass raises coverage; it is a setting, off by default, because it doubles cost.

**Vector search is brute force through sqlite-vec's `vec_distance_cosine`.** Same as the first build. Revisit when a
measurement says so.

**Evaluation is plain functions.** The eval-set JSON format and the prompt files are unchanged, so the pinned
sets keep working. The five XState machines (run, question, generate, judge, retry) become async functions with the
same retry-with-corrective-instruction behaviour for malformed judge replies.

**Formula decoding leaves the core.** The default parse recipe never used it. The `[formula]` placeholder view of
a chunk (used in embeddings) stays, because the baseline's embeddings depend on it.

## Decisions made while building

**The module context carries no model client of its own.** `ctx.services` is an opaque bag; the modules package
defines what it expects (`ModuleServices`). Search runs put the embedder, the index's embedding space and a cached,
logged model client there. Build runs add the artifact store, adapters and confirmed corrections. Keeps the kernel free
of any module's needs.

**A parsed document found in an extra directory is copied into the database's `artifacts/`.** A rebuild starts from
kept sources, so it must not depend on a directory that may go away.

**Evaluation source imports the kernel only.** The first draft of the four-packages decision allowed it to import modules; it did not need to.
Its tests build an index with modules, which the dependency rules allow.

**`chunk` drafts of non-PDF sources go through `assignChunkIds`.** Adapters hand over text pieces with a section path
and meta; the segment module assigns IDs with the same formula as the chunker, so a document of any kind has the same ID rule.

**Fact extraction is off by default.** `extract.enabled` in `kg.json` turns it on. With it off, the build machine
still runs the step and logs that it was skipped, so the machine's shape does not depend on configuration.

**The `replaces` rule runs on chunk meta, not on facts.** Dated-log entries carry `entryKey`, `date` and `title`. A
fact is hidden by `drop-replaced` when every chunk it cites has been replaced by a later current chunk. Item-level
`replaces` links are supported by the store and the drop step but nothing writes them yet.

**Evaluation conditions name search machines.** `retrieved` uses the database's default machine; any other name that is
a registered machine runs that machine. This replaces the first build's per-condition search recipe ids.

**A question or condition that fails is recorded and the run goes on.** Failed ones are left out of the means and
counted. The first build ended the whole run at the first failed model call.

**The viewer reads a fresh index handle for record text.** A rebuild swaps the index file under a running viewer, so it
opens the current file for each records request instead of holding one.

**Not carried over from the first build, on purpose:** the diagram library and path-overlay code in the viewer (a
machine is drawn as its list of steps, with the steps a run visited highlighted); formula decoding, which stays in the
Python sidecar's CLI but is no longer in the TypeScript side; the oracle copy of the system; the testkit and its conformance
suites (replaced by tests that run the real code on small fixtures); the `design/` amendments about builds, topology pins
and machines (see `design/archive/proposed-amendments.md`).

## 2026-11-06: The first design is superseded, not patched

The first design (a 27 KB roadmap and its amendments) is mostly about builds, recipes and snapshots, which no longer exist.
Patching it with eight amendments would leave an agent reading a long document that is mostly wrong. The current design is
`design/architecture.md`, and the old documents are in `design/archive/` under a banner. What survives from the old design (the
records, the rules, the failure-mode table, the cost of each demand) was carried into the new document. Replaces: the
proposed-amendments approach.

## 2026-11-06: Documentation is layered by lifetime

`CLAUDE.md` routes an agent to what it needs, `design/architecture.md` holds the design, the decision log and the measurements
are append-only, and each package has a short README that indexes its files. Component guides with worked examples wait until
the structure stops moving, because they would be rewritten with every change. A test fails when a document names a command,
option, machine or file that does not exist, so drift is caught where it happens. Replaces: giving every agent all of `design/`.

## 2026-11-06: kg-rag indexes what it is pointed at

The core does not fetch, convert, deduplicate or organise a corpus. Source adapters and optional helpers carry that work, and a
helper is added when users ask for it. Reason: the question being answered is whether retrieval is good, and corpus management
is a much larger problem that would absorb the project. HTML and web documents are therefore left to the user's own converter
for the beta.

## 2026-11-06: Extraction is on for the beta, and the baseline runs beside it

A new database turns extraction on and answers with `facts-and-neighbours`. Facts have not been shown to beat plain search (six
questions could not separate them), so every agent search also runs the baseline and logs what it would have returned, with
no effect on the answer. `kg report` then compares the two against the passages agents say they used. The comparison is
one-sided, because an agent can only report using what it was shown, and that limit is stated in the report's wording.
`--baseline` turns extraction off for a user who wants plain search. Replaces: extraction off by default.

## 2026-11-06: Extraction moves between machines as a cache file

Extraction is slow on a laptop (about half a minute per passage) and many users have a faster machine. The model-call cache is
already keyed by a hash of model, prompt and input, so exporting it and importing it elsewhere is enough: no server and no
synchronisation. `--cache-only` makes a machine without the result stop with a message instead of starting hours of
extraction. Checked once end to end with the real model: two passages, 8 facts, 0 model calls on the second database.

## 2026-11-06: No tool for an agent to append to a project log

An append tool would put kg-rag in the business of maintaining a log, which is corpus management. The project-log use case is
served by a prompt that tells the user's agent how to write entries so that the replacement rule and fact extraction work, and
by `--watch`, which makes new entries searchable. Replaces: the idea of a write tool in the MCP server.

## 2026-11-06: A code map is built from doc comments, with locations in metadata

One line per file is too little, and an agent-written separate map goes stale because nothing prompts anyone to update it. Doc
comments sit next to the code they describe, a documentation tool collects them with no model involved, and each symbol becomes
a passage that carries its file and line. The location is stored in the chunk's metadata and never in its text, because the
text decides the chunk ID: a line number in the text would give every symbol below an edit a new ID, forcing re-embedding and
re-extraction and invalidating feedback pinned to the old IDs. A comment must be checkable from its own function's body, so
that it can only go stale when that function changes. Cross-file flow goes in a short `CODEMAP.md` per directory.

## 2026-11-06: A folder is a source, and a missing source is not an error for ingest

Hundreds of generated documentation files cannot be added one by one, and a code map changes with every commit. A folder entry
is expanded on every ingest. A document whose file left the folder, or whose source was removed from the list, is retired: its
chunks stay stored but stop being current, and it returns if the file does. A source whose path does not exist keeps its
documents (a drive may be unmounted), and `kg rebuild` refuses to run in that state because it would drop them. Folder
documents are keyed by their path below the folder, so a renamed file is a new document with new chunk IDs.

## 2026-11-06: Questions from real use have weak gold, and failures are labelled by a person

A search whose results an agent used becomes a question whose gold is the chunks it reported using. That is weaker than a
reviewed gold, since the agent may have used less than the best passage, so these questions are run with retrieval only and
have a separate type. A search rated badly gives no gold at all, so it is written out with what was retrieved, and a person
fills in the chunks that should have been found. Reason: the pinned question set is too easy to rank improvements, and real
questions are the only source of hard ones that does not cost a model call.

## 2026-11-06: Feedback is a folder, and text can be left out

`kg export` writes a folder with a consistent copy of the history, the configuration and the index, because the maintainers need
the traces and the testers should not have to read them. `--no-text` leaves the index out so that no passage of a private corpus
leaves the machine. Queries, agent notes and source file names remain, and the command says so.

## 2026-11-06: A format number guards the database

The index carries a format number, and a program refuses a database with a higher one. Everything else that changes (prompts,
modules, embedding models) is handled by `kg rebuild`, and the changelog says which release needs one. The index also records
which version built it, and `kg status` and `kg doctor` show it.

## 2026-11-06: A code map is the HTML a documentation tool writes, with no link back to the source line

This replaces the code-map decision above.

The goal is that a coding agent can ask "how does the cache work?" and get back a short, accurate description of the relevant
code. The description comes from the comments that developers already write above their functions. A documentation tool
(TypeDoc for TypeScript, pdoc or Sphinx for Python) collects those comments and writes them out as a folder of web pages, and
kg-rag reads those pages.

The first version did something more elaborate. It took TypeDoc's data output, converted it to markdown, and put a line like
`Source: src/cache.ts:42` under each function, so that a search result could point at the exact line. It had two problems. It
worked for TypeScript only, and every other language would have needed a converter written by us, which is the work of
converting other people's formats that kg-rag avoids by design. It also needed extra machinery to keep line numbers out of the
passage text, so that an edit above a function did not give every function below it a new identity.

The new version has no converter. The project runs its own documentation tool, and kg-rag reads the pages it writes with a
general HTML reader. The reader treats headings as section titles and the text under a heading as the passage, and it skips
menus and scripts. It knows nothing about which tool made the page.

What this gives up: a result names the page and heading, not the file and line, so the agent finds the code by searching for
the function's name. The tools also write pages differently. TypeDoc gives each function its own heading, which works well.
Sphinx groups several functions under one heading, so its passages are coarser. pdoc puts each module's full source code into
the page, which fills the index with raw code. The beta guide says this.

One related fix: a very long code block with no blank lines used to become a single passage that was too long for the
embedding model, and the ingest crashed. Markdown and HTML now cut any block over 1,500 characters, and a `#` line inside a
code block is no longer taken for a heading. This changes the passage identities of markdown that has such blocks, which the
changelog says.
