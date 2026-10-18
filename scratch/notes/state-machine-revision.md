# Note: state-machine revision plan (2026-10-18)

Full plan: `scratch/sprint-1/state-machine-revision.md` (plan only; no package, core, design or skeleton edit was made). Its "Decided" list at the top records the user's decisions.

Short version.
- Every multi-step pipeline becomes a hand-written XState v5 machine: search (`similarity` only in v0), ingest (run machine plus per-document child), eval run and question, question generation, judge. Decompose-fuse and critique-loop are not built (no model calls inside retrieval in v0); the plan keeps a short appendix showing the contract needs no change to add them (named pools from contract 0.3.0 are the only future-proofing). Plain functions stay plain with a one-line reason each.
- Recipe = machine name + version + typed settings + topology fingerprint (+ prompt digest for prompt-bearing machines), hashed by the existing `recipeId`. Core defaults pin the topology as a literal; a search-package test ties it to the real machine.
- No pause/resume, snapshots, checkpoints or at-least-once events.
- XState lives only in a new shared toolkit package `@kg/pipeline` (`packages/pipeline`); core stays free of it. The star-rule amendment is approved.
- Visualization: diagrams generated from the machine (Mermaid, committed and staleness-tested); optional `@statelyai/inspect` in app only (off by default, never given state values or context); the viewer vendors Mermaid and overlays the logged path using a required `state` on search steps and two new events (`pipeline.started`, `pipeline.finished`), contract 0.5.0.
- Formula handling is deferred: nothing about formulas is in contract 0.5.0. The plan's section 13 notes that v0 needs no decoding (display formulas are docling blocks rendered as `[formula]`) and sketches the later direction (formula spans recorded per version plus an embedding view setting) with its trade-offs.
- XState pin: 5.33.2 until 5.33.3 is two weeks old (2026-10-31). Implementers are Sonnet or Haiku only.
