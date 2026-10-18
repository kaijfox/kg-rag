# Spike: state machines for search and ingest (2026-10-18)

Full findings, numbers and code: `scratch/sprint-1/spike-state-machine/results.md`. Tests: 95 passing there.

Short version.
- Search: keep the current runner design (rule fails on "shorter or clearly easier": 104 machine lines vs 15 for the runner, 22 with a `repeat` loop construct). Machines did work: logging, `AsyncLocalStorage` nesting and event logs are identical to the runner's. Two real gaps in the current contract came out of the spike: loops need a construct (`repeat`) instead of unrolling plus the deferred `done` skip, and `fuse.from` cannot name a model-chosen number of sub-question pools.
- Ingest: the rule is met. Per-document actors with JSON snapshots (max 2 KB) resume correctly from every one of 50 simulated crash points; events unchanged (identical to the skeleton's 0.4.0 log), no event lost, events duplicated across a crash window. It needs a vector checkpoint and a snapshot store, and +99 lines. The user decides whether v0 needs it.
- Baseline note: core moved to 0.4.0 while the spike ran; results are against 0.4.0.
- XState 5.33.3: 0 runtime dependencies, 13 KB gzip for the used API; robot3 1.4.0 fits the search loop in 29 lines but has no snapshot or child-actor support.
