# Sprint 3 proposed amendments (for the user to accept; design/ is not edited)

Each entry gives the placement and the text. Nothing here is applied to `design/`.

**AM-9 · Replay cache deferred (design "Stack settled", 2026-10-18).** (`review/B-processing.md` F2; user decision 2026-10-28)
Placement: the "Stack settled" amendment, the sentence "results are cached for replay".
Text: replace "the model client is provider-neutral and results are cached for replay" with "the model client is provider-neutral; a replay cache is deferred until debugging needs it, because a stored copy of every response costs storage".

**AM-10 · Shared SQLite layer and the star rule (Phase 0 architecture, architecture-proposal section 1).** (`review/A-data-and-contracts.md` finding 7; decision log 2026-10-28)
Placement: the architecture note for the star dependency rule; the design doc needs no change unless it names the package list.
Text: `@kg/sqlite` is a shared package that owns opening, configuring and migrating a database file. `@kg/store` and `@kg/eventlog` may import it; no other package may.

**AM-11 · Schema version held once (design "Builds are part of v0" and "Rule 4 for chunks", contract 0.4.0).** (`review/A-data-and-contracts.md` finding 1)
Placement: Core Concepts, "Database" or the storage note.
Text: a database file's schema version is `PRAGMA user_version`; migrations are an append-only list in `@kg/sqlite`. The version is not stored as a row.

**AM-12 · v0 is user-invokable (v0 section and v0 implementation roadmap, Phase 3).** (user decision 2026-10-28, "v0 should be as close to usable as possible")
Placement: the v0 section, a new item after 6 "Eval harness", and the roadmap's Phase 3 review criteria.
Text: v0 includes a command line (`./kg`) with ingest, search, status, serve mcp, serve viewer, and eval generate and run, over one database file. Options and environment variables select the database, the parse artifacts, the parser and the embedding digest. Scripts remain for experiments only.

**AM-13 · Viewer diagram shows what the log records (v0 item 4, "Event log", and the state-machine amendment).** (`review/C-surfaces-and-tooling.md` F2; user decision 2026-10-28)
Placement: the state-machine amendment, where the viewer is described.
Text: a machine run is drawn from the states it logged, with visit counts and the edges between them. Unlogged states are not inferred.
