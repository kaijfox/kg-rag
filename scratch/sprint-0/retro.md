# Sprint 0 retro (Phase 0 architecture, Phase 1 skeleton)

Written by the lead agent, 2026-10-17. The user was away for the last stretch and had delegated the remaining decisions (standing instruction in the decision log: cheap option, reserved where unsure).

## What happened
- Spikes (docling parse, OCR on/off, formulas, JSON round-trip, SQLite + sqlite-vec, ID stability) ran before any architecture was written; results are in design-feedback.
- Three agents drafted architectures independently (minimal / extensible / testable lenses); the lead reviewed and synthesized, the user signed off (builds in v0, logging below MCP, local Ollama for all LLM calls).
- One agent built `core`, `testkit`, 12 package cards and a walking skeleton. An independent reviewer on the strongest model found no blockers, 7 should-fix items and 12 surviving mutants; all were fixed. Contract is 0.2.0, 278 tests pass.

## Retro questions
**Did the assumptions the architecture rests on hold?**
- Chunk-ID stability: yes for text-preserving changes (insertion test, round trip). The drafts' feared failure (heading instability) did not occur; text changes under OCR did, as the design allows. Greedy packing can still renumber a whole section after one insertion (L1); acceptable for the static baseline, not for project databases.
- Parse artifact portability for a later GPU server: held. Saved docling JSON (0.3-1.0 MB) re-chunks to identical IDs.
- Brute-force vector search: held (1.7 ms for 20k x 384; corpus is 312 chunks).
- "Docling defaults are fine": did not hold. OCR on cost 15x time and corrupted text on one PDF; formula decoding is slow on CPU and unsupported on MPS. Parser settings need a recipe and a quality gate (design-feedback).
- A linear search pipeline can express later layers: partly. Decomposition with per-subquery fusion cannot be written without named pools (P-1, deferred); the critique loop can by unrolling.

**Easier or harder than the design implied?**
- Easier: storage and the portable-artifact idea.
- Harder: Rule 6 (build on every event) and Rule 5 (staleness) turned out to need explicit machinery and mutation testing to enforce; the first skeleton enforced both weakly.
- The design's v0 omits builds, but Rules 5 and 6 are not satisfiable without them.

**Which contracts needed changes, and what does that say?** 32 revisions (R-01..R-32). Most were small precision fixes found by building (R-01..R-22) or by review (R-23..R-32). The substantive ones were all about builds and event tagging: build names as labels, `stale` on every search, item IDs in the build ID, build-membership on `getItems`. We understood the entities but under-specified how builds interact with events and embeddings. Next time, write the build/event invariants as executable properties before the skeleton.

**Where did agents get stuck or read sibling code?** Single-agent skeleton, so little evidence. The reviewer's S7 finding means the skeleton now contaminates the independence test (Q5 parked).

**Model assignments:** Opus for drafting and the skeleton, the strongest model for review: the review found real defects (S2 silent unsearchable chunks, S5 whitespace-dependent IDs) that the author's own tests missed, and mutation testing found 12 weak spots. Worth repeating for every contract-bearing phase. Cost: the skeleton agent ran about 1.4M tokens across sessions and hit a rate limit once, resuming cleanly.

**Process notes**
- Distributed drafting worked: the three drafts agreed on most structure, and the differences were informative. The drafts all overran their length cap (8-9k words); give a tighter cap or a template next time.
- The agent-written hand-back messages are summaries; verifying (rerunning checks, reading the log) caught nothing wrong this time but remains cheap.
- `design/` was never edited by agents. Amendments the user must record: logging below MCP (Q2), builds in v0 (Q1), chunk reading of Rule 4 (chunks are ground truth; parse/chunk recipes recorded on the document version), "current ingest" definition for Rule 5.

## Carry-forward to Sprint 1
See `brief.md`.
