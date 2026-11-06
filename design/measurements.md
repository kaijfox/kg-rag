# Measurements

All numbers are on the stat-mech corpus (two textbooks by two authors, one index per author), local embedding model
embeddinggemma, and the 63 reviewed questions that the first build pinned. The scripts that print the numbers are in `experiments/`.
New results are added as dated sections at the end. Retrieval only unless stated: no answering or judging model is involved.

## The baseline machine reproduces the first build exactly

`baseline-parity.mts` builds both authors' databases from the kept parsed documents and runs the 63 questions through the
`chunk-search` machine. Recall at k = 1, 3 and 5 equals the first build's stored results for **63 of 63 questions**
(Kardar: 0.57 / 0.89 / 0.94; Plischke: 0.68 / 0.84 / 0.88). The chunk counts match (223 and 89), and re-chunking the kept
documents reproduces all 102 gold chunk IDs of the pinned questions. So the pinned evaluation sets remain valid and the
rebuilt system is a drop-in baseline.

## Adjacent-chunk expansion shows little to gain at k = 5 on this set

`adjacent-gate.mts` and `adjacent-sweep.mts` compare the baseline with machines that add the chunks next to the best ones.
Cells are recall@5 / share of questions with every gold chunk in the top 5.

| machine | single-hop (40) | multi-hop (12) | topic (11) |
|---|---|---|---|
| baseline | 0.95 / 0.95 | 0.96 / 0.92 | 0.73 / 0.36 |
| best 3, radius 1, neighbour at 0.9 × seed | 0.95 / 0.95 | 0.96 / 0.92 | 0.75 / 0.36 |
| best 2, radius 1, neighbour at 0.99 × seed | 0.95 / 0.95 | 0.96 / 0.92 | 0.73 / 0.36 |
| best 2, radius 2, neighbour at 0.99 × seed | 0.95 / 0.95 | 0.93 / 0.83 | 0.73 / 0.45 |
| best 1, radius 2, neighbour at 0.99 × seed | 0.95 / 0.95 | 0.96 / 0.92 | 0.76 / 0.45 |

The best setting moves one of 11 topic questions into the "all gold in the top 5" group, which is within noise for this
sample, and a wider setting costs multi-hop questions. The earlier pre-check said 14 of 63 questions have adjacent gold
chunks; with only five slots, neighbours rarely displace chunks that already score higher. The stage's gate (topic-level
recall against the 36% baseline) shows little to gain here. A test at larger k, or with a question set where answers span
sections, could still show a gain. The module stays; the machine `chunk-search-adjacent` is not the default.

## Fact extraction with the local model (qwen3.5), one document

`extraction-trial.mts` builds ThermoPlischke (39 chunks) with extraction on and one model call per chunk.

- **Time:** 1,122 s for the whole build (about 29 s per chunk, mostly generation).
- **Yield:** 234 facts kept and 67 rejected by the checks, with 765 mentions and no malformed replies. Of the first 25
  rejections logged, 13 referred to the document instead of naming the thing ("the equation", "the chapter"), 10 copied the
  passage verbatim, 1 started with a pronoun and 1 was too short. So about one fact in four is refused, and the refusals
  are the kinds the first build's pilot found in its unfiltered output.
- **Quality, by reading a sample of eight:** most are standalone and carry their quantities, for example "The first law of
  thermodynamics partitions the change in energy of a system into two pieces, heat and work." Several state the same point
  in different words ("the difference between dQ and dW is the same for any process" three times from one chunk), so
  duplicate facts within a chunk are common. Verified merging of duplicates, deferred in the proposal, would address this.
- **Retrieval:** on the 6 pinned questions whose gold chunks lie wholly in this document, recall@5 was 0.89 for the baseline
  and for adjacent expansion and 0.83 for `facts-and-neighbours`. Six questions cannot separate the machines. The
  statement that facts do or do not help needs the harder question set (the first build's open question about a stronger
  generator) and extraction over a whole corpus.
- **Cache:** the 40 stored responses occupy 20 KB, about 0.5 KB per chunk, so 10,000 chunks need about 5 MB. The proposal
  report's estimate (1 to 9 MB per 1,000 chunks) was too high.
- **Rebuild from the cache:** `./kg rebuild` on this database took 4.9 s instead of 1,122 s and produced the same 234 facts.
  No model call was made, because every extraction request was already stored.

The database is left at `kg-data/trial-thermo-plischke` (not committed) for inspection with `./kg status`, `./kg search
--machine facts-and-neighbours` and `./kg serve viewer`.

## 2026-11-06: Code map built from doc comments, on this repository

Script: `experiments/code-map-selftest.mts`. Two databases were built from the same 50 source files with the real embedding
model: one from documentation generated out of the doc comments (TypeDoc, then the `symbol-docs` adapter; 451 passages), and one
from the raw source files cut into passages with the file path as the heading (252 passages). Twenty questions about this
codebase, each with the file or files that answer it, were searched in both. A search succeeds at k when one of the top k results
comes from an answering file. The author of the code wrote the questions, and most use words that appear in the code or its
comments, so the test shows that the path works and not how well it generalises.

| | top 1 | top 3 | top 5 | text returned per search | file and line on each result |
|---|---|---|---|---|---|
| documentation from doc comments | 17 of 20 | 19 of 20 | 19 of 20 | 1,161 characters | 100 of 100 |
| raw source files | 17 of 20 | 19 of 20 | 19 of 20 | 5,395 characters | none |

The two find the same files and miss the same question. The documentation returns about a fifth of the text and names the
line. A repository of 50 files is small enough that locating a file is easy either way, so a gain in finding would need a larger
repository or questions that do not echo the code's own words. The comments in this repository are uneven, so the result also
reflects them, not the quality of comments written to the prompt in `docs/beta/code-map-prompt.md`.

## 2026-11-06: Moving extraction between databases, with the real model

Run by hand on two notes (two passages) with qwen3.5. Ingest with extraction made 2 model calls and produced 8 facts in 22 s.
The cache was exported, imported into a second database with the same sources, and `ingest --cache-only` made 0 model calls and
produced the same 8 facts. Before the import, the same command stopped with a message naming the missing request and the model.
A test also covers the replay offline (`packages/modules/test/beta.test.ts`). The earlier measurement of a 39-passage rebuild
(4.9 s against 1,122 s) is the larger case.

## 2026-11-06: The server process, end to end

Script: `experiments/mcp-smoke.mts`. A real `kg serve mcp --watch` was started as an agent client would start it. The client
received the instructions and the six tools, searched, reported usage and feedback, then a new note was written into the source
folder. The watcher read it, extracted 4 facts from it, and the next search returned it. `kg report` showed the comparison with
the baseline on the 7 searches made.

## 2026-11-06: Code map read from generated HTML, on this repository

Script: `experiments/code-map-selftest.mts`. TypeDoc built an HTML site from the doc comments of the 50 source files (256 pages
after leaving out the listing pages, 674 passages), the general HTML reader ingested it, and the same twenty questions as in the
earlier code-map measurement were searched. A search succeeds at k when one of the top k results is a page about a file that
answers the question. A page is matched to a file by its module name, so a result can be credited to the wrong package.

| | top 1 | top 3 | top 5 | text returned per search |
|---|---|---|---|---|
| generated HTML, general reader | 13 of 20 | 14 of 20 | 15 of 20 | 1,578 characters |
| earlier route (markdown with source lines) | 17 of 20 | 19 of 20 | 19 of 20 | 1,161 characters |

This route finds fewer answering files and returns more text, and its results carry no file or line. The earlier numbers are
for a route that has been removed (see the decisions entry of the same date).

The five misses were looked at. Pages that only list other pages were taking result slots in four of them; leaving those pages
out did not change the score. In one miss, the question about where parsed documents are kept, the top results came from a
neighbouring file with a similar name (`parse_artifact`, the answer is in `parse_artifacts`), so the gold may be too strict. In
the other four, the pages for the answering file (the viewer, the machines list, the runner, the command line) did not reach the
top five, and results came from related files instead. Whether those pages hold thin comments or the questions use different
words than the comments was not checked. The questions were written by the author of the code and the comments in this
repository are uneven, so the result shows that the route works and not how good a map is.
