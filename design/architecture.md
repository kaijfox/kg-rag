# Architecture

kg-rag gives coding and research agents background knowledge from document corpora and project histories, through MCP
tools. Similarity search over chunks is the baseline. Every other layer (extracted facts, links between records,
summaries) is built on that baseline and kept only if a measurement shows it beating the baseline. This document is the
current design. The first design and the reasoning that led here are in `design/archive/`, and each choice made while
building is in `design/decisions.md`.

## What a database holds

A **chunk** is a passage of a source document. Its ID is computed from the document key, the heading path, the passage
text and how many times the same text occurred earlier in the document, so unchanged text keeps its ID when a document is
read again. Metadata is not part of the ID. Evaluation questions and feedback name chunk IDs, so an ID that stays stable is
what keeps them valid.

A **derived item** is anything a module produces from chunks. A *fact* is one self-contained sentence, with qualifiers such
as species or conditions written into the sentence, plus the names it mentions. A *summary* cites many chunks. Each item
cites the chunks it came from, and the store refuses an item that cites none. The ID of an item is computed from its kind,
the module name and version that made it, its source chunks and its text. Text is part of the ID because a model gives
different sentences for the same input, and a different sentence should be a different record.

A **mention** joins a fact to a normalised name. A name has no record of its own, so the graph is the facts joined through
shared names. A **link** relates two records without changing either. There are two kinds. `replaces` runs from a newer
record to the older one, and a search that uses the current-state machine drops what has been replaced. `alias-of` runs from
one name to the canonical name for the same thing. Deleting a link undoes the relation and leaves both records as they were.

A document whose source has gone is **retired**: its chunks stay stored but stop being current, so searches no longer return
them, and the document returns if its file does. A source may be a folder, which stands for the files in it and is read again
on every ingest.

## Where the data lives

A database is a directory. Each part has a different lifetime, and the split is what makes upgrading safe.

| File | Holds | Fate on rebuild |
|---|---|---|
| `index.sqlite` | documents, chunks, derived items, mentions, links, embeddings | replaced by a new file |
| `history.sqlite` | event log, sessions, notes, evaluation runs and results, corrections a person confirmed | untouched |
| `cache.sqlite` | model responses keyed by a hash of model, prompt and input | reused, pruned to a size cap |
| `artifacts/` | parsed documents (docling output) | reused, because a rebuild starts from them |
| `kg.json` | configuration and the list of sources | read |

Improved extraction prompts change every extracted fact. The first design kept old and new results side by side at the cost
of six extra tables. This design instead discards the old index and rebuilds from the kept sources. The cost is rebuild
time, and the cache removes most of it: a rebuild whose model calls are all cached took 4.9 s where the first
extraction took 1,122 s (`design/measurements.md`). The history is keyed to chunk IDs and names, never to derived-item IDs,
so it survives. Every logged event records the index it ran against.

An embedding space (model, its weights digest, dimensions and the text templates) is stored with the vectors. The embedder
refuses to run when the digest differs, because vectors from two model versions cannot be compared.

## Modules and machines

A **module** is one function with a name, a version, and a declaration of which intermediate results of a request it needs
and which it adds. A **machine** is a short list of states, each calling one module, with a route to the next state (a
state name, the end, or a guarded choice). A loop is a route back to an earlier state.

The kernel checks every machine when it loads. A machine in which a step needs something that no earlier step provides on
every path to it is refused, and so is an unreachable state. The runner then executes the steps. A module may set only the
results it declares in `adds`. It never writes to the index itself: it returns writes, and the runner applies them and
stamps them with `name@version`. Every step is logged with the ranked lists it received and returned, so a failed query can
be diagnosed from the log alone.

A new way of answering is a new machine over existing modules. A new kind of source is a new adapter. A new step is a new
module. The shipped machines are listed by `./kg machines`:

| Machine | Does |
|---|---|
| `chunk-search` (default) | nearest passages by embedding similarity: the baseline |
| `chunk-search-adjacent` | the baseline plus passages next to the best three |
| `facts-and-neighbours` | nearest facts, then facts sharing a name with them, then the passages they cite |
| `current-state` | nearest passages and facts, leaving out what a later entry replaced |
| `build` | read sources, cut chunks, extract facts, embed, replay corrections, link replaced entries |

Modules are marked per-chunk (run on new chunks only) or whole-collection (recompute when the collection changes).
Extraction is per-chunk, so changing one source file costs model calls only for the chunks that changed.

## Rules the code enforces

1. Every derived item cites at least one chunk. The store refuses one that does not, inside the commit, so a failed module
   leaves nothing behind.
2. Derived items and links are never edited. A changed module version produces new records, and a rebuild replaces the index.
3. A merge or a replacement is a link, which can be deleted. The records it joins are not touched.
4. Each derived item records the module and version that made it, so a change to a module identifies exactly what to
   regenerate.
5. A fact whose cited chunks are all out of date is reported as stale.
6. Feedback and evaluation questions key to chunk IDs, and every logged event names the index it ran against.
7. Source locations (file path, line) go in chunk metadata and never in chunk text, because the text is part of the chunk
   ID and a shifted line number would give every chunk below an edit a new ID.

`pnpm check` runs the type checks, the dependency rules (the kernel imports nothing else in `packages/`, modules import the
kernel only, evaluation source imports the kernel only, and the app may import all three) and every test.

## Scope

kg-rag indexes what it is pointed at. It does not fetch, convert, deduplicate or organise a corpus. The extension points are
source adapters (docling PDF, markdown, dated log, symbol documentation) and optional helper modules, such as the docling
runner. A helper is added when users ask for it. This keeps the core small, and it keeps the question "is retrieval good?"
separate from the much larger question of corpus management.

Extraction runs once per chunk with a local model and is slow on a laptop (about 29 s per chunk with qwen3.5 in the trial).
It can run on a different machine from the one that serves searches, because its output is cached by request hash and a
rebuild replays the cache (`docs/beta/moving-extraction.md`).

## Measurement

Evaluation questions have known supporting chunks. Questions also come from real use: a search whose results an agent used
becomes a question whose gold is the chunks it reported using, which is weaker than a reviewed gold and is run with retrieval
only. A search rated badly is written out for a person to label. Every agent search also runs a second machine (the baseline
by default) and logs what it returned without returning it, so that the machine in use can be compared with the baseline on
real questions. `kg report` summarises both. A run reports whether the supporting chunks were retrieved (recall at k)
and answer quality under three conditions: no context, the gold passages, and retrieved context. Agent sessions and
evaluation runs both go through `Kg.search`, so they write the same events. The pinned question sets for the stat-mech
corpus are in `test/corpa/stat-mech/eval/`, and a test checks that re-chunking the kept documents reproduces every gold chunk
ID they name.

The measured state is in `design/measurements.md`. In short: the baseline is strong on single-hop questions (95% with every
supporting passage in the top five), the question set is too easy to rank improvements (answers written with no context
already score 0.73 to 0.80), and topic-level questions are the one visible weakness (36%).

## Failure modes and their remedies

Each failure has a signature in the evaluation results or logs. Each remedy that adds a layer has a pre-check: a
measurement taken first that shows how much the baseline leaves to gain. A layer is deferred when its pre-check shows
little room.

| Failure | Signature | Remedy | Pre-check |
|---|---|---|---|
| Evidence split across chunks | fails with retrieved context, passes with gold, gold chunks adjacent | adjacent-chunk expansion, chunking revision | share of questions with adjacent gold (14 of 63) |
| Not extracted | a gold chunk has no fact covering the gold content | prompt revision, a second extraction pass | pilot extraction: how many gold facts exist and are retrieved |
| Retrieved but ranked low | gold appears in candidates outside the top k | reranking | recall at small k against large k |
| Multi-hop failure | recall of all gold chunks well below single-hop | graph walk, query decomposition | gap on a hard multi-hop set (none exists yet) |
| Topic-level failure | topic questions well below the ceiling | one summary per document section | gap to the ceiling on topic questions |
| Fragmentation | several names or facts for one object | verified merging of names and facts | duplicate rate on a sample |
| Conflicting facts | contradictions or revisions | replacement links | conflict rate on a sample |
| Phrasing failure | recall differs between paraphrases of a query | query rewriting | original query against the best of several paraphrases |
| Corpus gap | recall low even at large k, low agent ratings | add sources | none |

## Not built

Each item waits for a measurement that shows room to gain.

- **Summaries of sections or communities.** Gate: topic-level recall against the 36% baseline. Adjacent-chunk expansion did
  not move it, so one summary per heading is the next candidate. Clustering applies only to sources without headings.
- **A ranking walk over the graph.** Gate: a multi-hop question set hard enough that the baseline fails it.
- **Reranking.** Gate: a rank distribution showing gold outside the top k.
- **Verified merging of duplicate names and facts.** The trial found about 10% duplicate names, and several paraphrases of one
  point within a chunk. Plain `alias-of` links are applied at query time in the meantime.
- **Concept frameworks.** Not scoped by either design. The cheapest probe is a model-proposed taxonomy, reviewed by a person
  and stored as a new kind of link.
- **An approximate-nearest-neighbour index.** Search is brute force. Revisit when latency crosses a threshold.

## Where to look

| To know | Read |
|---|---|
| why something is built this way, or what is allowed | this file |
| why a specific choice was made | `design/decisions.md` |
| what was measured, and the script that measured it | `design/measurements.md`, `experiments/` |
| what a package holds and which file to open first | `packages/<name>/README.md` |
| what to give a beta tester | `docs/beta/` |
| the first design and the reasoning that replaced it | `design/archive/` |
