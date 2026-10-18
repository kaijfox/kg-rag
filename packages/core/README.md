# @kg/core (contract 0.6.1; 0.1.0 frozen at fan-out)

The shared contract every package imports, and the only package with no `@kg/*` dependency (runtime dep: zod).
Read in this order: `src/model.ts` (data model), `src/ids.ts` (every ID derivation), `src/ports/*` (the
interfaces between packages; each method documents its error codes), `src/events.ts` (event catalog and
envelope rules), `src/api.ts` + `src/runTool.ts` (the tool contract and the single logging path),
`src/scoring.ts` and `src/conditioning.ts` (rules every step and store must share), `src/schema.sql`.
Changes go through a change proposal and bump `CONTRACT_VERSION`. Tests: `pnpm --filter @kg/core test`
(schema.sql on real SQLite, scoring, conditioning, runTool failure paths, JSON Schema freshness); the ID
functions are checked against `packages/testkit/golden`.

## Pipelines are machines

Every multi-step pipeline (search, ingest, evaluation runs, question generation and judging) is a hand-written state
machine in the package that owns it; `core` holds only plain data about machines and has no state-machine library.
A recipe for such a pipeline is `MachineRecipeSpec`: `kind`, `version` (of the machine code), and
`spec = { machine, settings, topology, promptDigest? }`. `topology` is a 16-hex fingerprint of the machine's states,
moves, guard names and step names; `promptDigest` is present only for machines that carry prompt text. `recipeId` hashes
the whole recipe, so changing the wiring, the settings or a prompt gives a new id. `DEFAULT_SEARCH_RECIPE` pins the
`similarity` machine's topology as a literal (core cannot compute it); the search package must assert that its machine
computes the same value. The topology literal is provisional until that machine exists.
Logging: a pipeline run is bracketed by `pipeline.started` and `pipeline.finished`; each `search.step` trace names the
machine `state` that ran it. `MachineMap` (checked by `machineMapSchema` and `validateMachineMap`) is the plain-data
drawing of a machine that the viewer uses to map a logged session back onto states. Future recipe kinds (`extract`,
`equivalence`, `cluster`, `summarize`, graph walk) are machines by default. Ingest has no pause or resume.

The `search` tool's `k` is optional and defaults to `DEFAULT_K` (10); the MCP input schema shows it as optional with that default.

## Formulas (0.6.0)

`EmbeddingSpaceSpec.formulaView` (`placeholder` default, or `full`) says how display formulas enter the embedded text;
it is part of the space id. `ParseRecipeSpec.spec.formulaDecoding` (optional: decoder `model`, `revision`, `prompt`,
`cropMargin`) turns on decoding of `formula` blocks; absent means off and leaves the recipe id unchanged.
`ChunkViewRenderer` (`ports/parse.ts`) is the function type, implemented by the `chunk` package and called by ingest,
that renders a chunk's text under a view from the parse artifact and the chunk's block refs.
