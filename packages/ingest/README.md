# @kg/ingest

The ingest service: turns source files or parse artifacts into a build. Two state machines run each request. The
`ingest` machine walks the request: it prepares, runs one `document` child per entry in request order, embeds the other
current documents that lack vectors, checks that the new build is complete, and commits in one transaction. The
`document` machine runs one entry: identify or import, check for a duplicate docKey, read the parse artifact from the
cache or parse it, decode formulas when the recipe asks for it, chunk, and embed the chunks that lack a vector.

Everything arrives by injection (`IngestDeps`: store, parser, chunker, chunk view, embedder, config, optional
formula decoder). The package imports only `@kg/core` and `@kg/pipeline`.

## Layout

- `src/service.ts`: `createIngest`. Runs `ingest` through `runPipeline`; the `preparing` state checks the embedder against the space and only then writes the config's recipes and space (`ensureConfig` in `steps.ts`), so a refused request leaves the store untouched.
- `src/machines/ingest.ts`: the request machine. `src/machines/document.ts`: the per-document child.
- `src/steps.ts`: the step functions the machines invoke (identify, import, parse, decode, chunk, embed, extras, commit).
- `src/deps.ts`: the dependency type, the plain parse recipe, the decoding test, the embedded text.
- `src/machines/pins.json`, `docs/ingest.mmd`, `docs/document.mmd`: the pinned topologies and generated diagrams.
  `test/machine.test.ts` fails if either drifts.

## Assumptions

- Formula decoding: the parser runs under the configured parse recipe without its `formulaDecoding` (the plain recipe,
  which is what the parse cache is keyed by); the decoder then produces the artifact under the full recipe, cached
  under that id. Both artifacts are stored. `ingest.started.parseRecipeId` names the recipe the parse ran under (plain
  when decoding is on).
- An artifact file may be under any parse recipe. One that is neither the configured recipe nor its plain form is accepted and the build is flagged `mixedRecipes` (core `composeBuild`). `ingest.started.parseRecipeId` is the plain recipe on the file and the import path alike.
- An artifact file that needs decoding (plain, decoding on) is `precondition`: no source file, no decoder input. An
  artifact that already carries the full recipe is accepted as it is.
- Duplicate docKeys in one request are detected after the document is identified or imported, so the events of the
  first document are logged before the run fails.
- The configured embedder model and dimensions must match the space (`precondition` otherwise); the digest is not
  checked here (the embedder interface does not carry one).
- `ingest.embedded` is logged for each requested document even when it embedded nothing (`embedded: 0`), and for each
  other document only when it embedded something.
- The build's parent is the build current before the run; `build.created.revert` is true when the build id already
  existed.
- Chunk text for the embedder goes through `chunkView` (the space's formula view); it is a required dependency. For
  the other current documents the version's chunks are drawn again with the chunker from the version's artifact, so the
  view gets the block references of that version, not the first-seen ones kept on the item.

## Known gaps

- Partial success is not supported: any failure rolls the whole request back (card decision).
- Parse escalation (OCR as a second recipe) is not built.
- Three rules of the card are met differently: `preparing` is a routing state (pure embedder check, then the recipes
  and space are written in the transition), because a work state must log an event and preparation logs none; the commit and the announcements are
  one state (`committing`, with `ingest.completed` and `build.created` after the transaction), for the same reason;
  parsing, decoding and reading log `ingest.parsed` only when the artifact is final (a decoding run logs it once, after
  decoding).
- The declared-logs test in `test/machine.test.ts` checks that every emitted event is declared by a work state.

## Tests

`pnpm --filter @kg/ingest test`: the card's scenario suite (13), the machine map conformance for both machines, pins and
diagrams, paths with `drive` and `withActors` (cache hit skips parsing, duplicate docKey, formula decoding on and off,
embedder and parser failures, space mismatch), a golden run of one document, and the declared-logs check.
