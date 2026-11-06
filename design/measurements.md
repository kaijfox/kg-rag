# What was measured on the rebuilt system

All numbers are on the stat-mech corpus (two textbooks by two authors, one index per author), local embedding model
embeddinggemma, and the 63 reviewed questions that the first build pinned. Scripts are in this folder and print the numbers
below. Retrieval only unless stated: no answering or judging model is involved.

## 1. The baseline machine reproduces the first build exactly

`baseline-parity.mts` builds both authors' databases from the kept parsed documents and runs the 63 questions through the
`chunk-search` machine. Recall at k = 1, 3 and 5 equals the first build's stored results for **63 of 63 questions**
(Kardar: 0.57 / 0.89 / 0.94; Plischke: 0.68 / 0.84 / 0.88). The chunk counts match (223 and 89), and re-chunking the kept
documents reproduces all 102 gold chunk IDs of the pinned questions. So the pinned evaluation sets remain valid and the
rebuilt system is a drop-in baseline.

## 2. Adjacent-chunk expansion shows little to gain at k = 5 on this set

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

## 3. Fact extraction with the local model (qwen3.5), one document

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
