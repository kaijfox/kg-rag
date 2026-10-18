# @kg/ingest notes

## What was done
- Parent machine `ingest` (preparing, nextDocument, document, extras, gate, committing) and child `document` (identifying or
  importing, checkDuplicate, lookup, reading or parsing, afterParse, decoding, chunking, embedding), both built with
  `setup()`; every work state invokes a `loggedActor`.
- Service `createIngest` runs the machine through `runPipeline`; `preparing` checks the embedder, then writes recipes and space.
- Scenario suite (card, exact file) passes: 13 of 13. Machine tests: 30 (map conformance on both machines, pins, diagrams,
  paths, golden run, declared logs).
- Pins: `ingest@1` 784934be1274be90, `document@1` 084ec9ebf38d26dd.

## Assumed
- The parse under formula decoding runs under the plain recipe (config minus `formulaDecoding`); the decoder output is cached
  under the full recipe.
- `chunkView` is required (testkit deps carry it since 0.6.1).
- A duplicate docKey is found after identify/import, as the card's state order says.

## Surprised by
- Root-level `output` on a machine overrides a final state's own `output` in this xstate version (the success path returned
  nothing when outputs were on final states). Outputs are on the root, computed from context.
- A work state's `error` edge is needed even for states that cannot fail in practice (conformance requires it).
- `drive` records the state reached during init: the first entry of the visited list can repeat (routing states are left
  inside the start step). Tests pin the list as produced.
- `machineLogConformance` checks `search.step` only, so it cannot pass for any non-search machine.

## Would flag
- The card's state list cannot satisfy the map conformance rule (a work state must log) for parsing, committing and
  preparation; see the change proposal and the README.
- Pins changed once: the write of recipes and space is an action of the `preparing` transition.
