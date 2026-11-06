> **Archived, 2026-11-06.** This describes the first build, which used seventeen packages, builds, recipes and snapshots. It was replaced by `design/architecture.md`. Kept as history; do not follow it for current work.

# Proposed amendments to the design documents

`design/` is not edited without the user's approval. These are the places where the rebuilt system departs from
`design/260916_initial-roadmap.md` (including its dated amendments). Each entry names the passage, what the code does now,
and the text that would replace it. The reasoning is in `scratch/proposal-report.html`.

**1. Core Concepts, "Item", "Node and relation", "Equivalence".**
Now: a derived item is a *fact* (one standalone sentence that cites its chunks and lists any number of names) or a
*summary*. There is no node record. A name is a normalised string in a `mentions` table. Equivalence and replacement are
`links` of kind `alias-of` or `replaces`, each naming the module version that made it. `refines` is not built.
Replacement text: "A fact is an item whose text is a self-contained sentence, with qualifiers stated in the sentence.
It lists the names it refers to. The graph is the facts joined through shared names. An entity has no record of its own."

**2. Core Concepts, "Recipe and build"; Rule 4; amendment "Builds are part of v0"; "Pointer moves are events".**
Now: no builds, snapshots, manifests or recipes tables. Each derived item and link carries `made_by` (module name and
version). One index per database. An upgrade rebuilds the index from the kept sources and swaps it in; the previous index
can be kept as a file. `rebuild.started`, `rebuild.finished` and `rebuild.redo` events record the move.
Replacement text for Rule 4: "Each derived item records the module and version that made it, so a change to a module
identifies exactly what to regenerate." Rule 5: "A fact that cites no current chunk is reported as stale." Rule 6: "Feedback
and evaluation questions key to chunk IDs, and logged events record the index they ran against."

**3. Amendment "Every producer a recipe depends on is pinned or guarded".**
Now: the embedding space still records the model digest and the embedder refuses a mismatch. A chunker or parse-recipe
change still changes chunk IDs and invalidates pinned evaluation questions. Topology fingerprints no longer exist.

**4. Amendment "Pipelines are explicit state machines; a recipe names its machine".**
Now: machines are plain data (states, each naming a module, with a next state or a guarded choice), checked when they load
for unknown modules, unreachable states, and steps that need an intermediate result no earlier step provides. There is no
XState and no topology fingerprint. A logged run maps back onto its machine by state name. Loops are a guarded move back.

**5. Amendment "Logging lives in the tool contract, not in MCP".**
Now: the kernel's runner and the history store log every step; the MCP server and the evaluation runner both go through
`Kg.search`, so agent sessions and evaluation runs write the same events. `KgApi` and `runTool` are gone.

**6. Amendment "Formula handling in v0".**
Now: formula decoding is not in the TypeScript code. The sidecar's command line still offers it. The placeholder view of a
chunk (formulas as `[formula]`) is stored with the chunk and used for embeddings, which keeps the baseline's vectors.

**7. v0 item 2 ("Store") and Stack settled.**
Now: one directory per database holding `index.sqlite`, `history.sqlite` and `cache.sqlite`, plus kept `artifacts/`. "Results
are cached for replay" is implemented as the model-call cache. TypeScript, SQLite with sqlite-vec, docling in a Python sidecar
and local Ollama are unchanged.

**8. v0 roadmap, Principles and Phase 2 (packages).**
Now: four packages (`kernel`, `modules`, `eval`, `app`) instead of seventeen. The package cards, conformance suites and
testkit are replaced by tests that run the real code on small fixtures.
