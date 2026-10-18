# @kg/ingest (WP7, Haiku)

Contract: `@kg/core` CONTRACT_VERSION 0.6.1. You need this card, `core`, `@kg/pipeline` (README and `src`), `testkit`, and
`.claude/skills/xstate/SKILL.md` (XState v5 only); nothing else. Do not read `packages/app/src/skeleton`.

Ingest is a state machine: a parent machine for the whole request and a child machine per document. Pausing and resuming are not
supported and not needed: a run either finishes or fails, and the single commit transaction keeps a failure from leaving partial state.

## Implements (core `ports/ingest.ts`, `IngestService`)
`createIngest(d: { store: CorpusStore; parser: Parser; chunker: Chunker; chunkView: ChunkViewRenderer; embedder: Embedder; config: DatabaseConfig; formulaDecoder?: FormulaDecoder }): IngestService`
(`FormulaDecoder` = `(artifact, sourcePath, recipe) => Promise<ParseArtifact>`, defined in the ingest package; `chunkView` and
`formulaDecoder` are 0.6.0).
Everything arrives by injection: you never import store, parse, chunk or embed.

## The machines (`src/machines/ingest.ts`, `src/machines/document.ts`; kit helpers from `@kg/pipeline`)
Build with `setup()`; every state that does work invokes a `loggedActor(...)` (no bare `fromPromise` in files under `machines/`); routing states only have
`always` moves and `meta: { routing: true }`; two final states per machine, `done` and `failed` (`failed` has id `failed`, keeps the `KgError` in context under
`error`, and `onError` of every work state goes there). `meta.logs` names the events a state emits, `meta.step` the module it calls. Events and their order are
exactly those in Behaviour below, with `pipeline.started` first (pipeline `ingest`, machine `ingest`, version `1`) and `pipeline.finished` last; the run is
started with `runPipeline` inside the tool handler. The module calls are plain injected functions (`parser`, `chunker`, `chunkView`, `embedder`, `store`,
`formulaDecoder`); the machines only decide order and routing.

Document machine (one per entry, documents in request order):
`route` (routing: file or artifact) -> `identifying` (file: sha, emits `ingest.started`) | `importing` (artifact file, emits `ingest.started`) ->
`checkDuplicate` (routing: a docKey named twice -> `failed` with `invalid_input`) -> file: `lookup` (routing: artifact cached?) -> `parsing` or on to `afterParse`;
artifact: on to `afterParse` -> `afterParse` (routing: recipe has `formulaDecoding` and the artifact does not carry it -> `decoding`, else `storing`) ->
`decoding` -> `storing` (emits `ingest.parsed`) -> `chunking` (emits `ingest.chunked`) -> `embedding` (emits `ingest.embedded`) -> `done`.
Parent machine: `preparing` (recipes, space, embedder check) -> `nextDocument` (routing) <-> `document` (invokes the child) -> `extras` (embed other current
documents lacking vectors) -> `gate` (routing: every item has a vector, else `failed` with `precondition`; the store's own check at `putBuild` stays authoritative) ->
`committing` (the one transaction) -> `announcing` (emits `ingest.completed` per document and `build.created`) -> `done`.
Sketch of the child (adapt only what the compiler forces; the parent is the same pattern):
```ts
const documentMachine = setup({
  types: { context: {} as DocCtx, input: {} as DocIn, output: {} as DocOut },
  actors: { identify, readArtifact, findCached, parseFile, decodeFormulas, storeArtifact, chunk, embed }, // each a loggedActor(...)
  guards: { isFile, cached, duplicate, wantsDecoding },
}).createMachine({
  initial: 'route', output: ({ context }) => context.out!,
  states: {
    route: { meta: { routing: true }, always: [{ guard: 'isFile', target: 'identifying' }, { target: 'importing' }] },
    identifying: { meta: { logs: 'ingest.started', step: 'identify' }, invoke: { src: 'identify', onDone: { target: 'checkDuplicate', actions: 'adopt' }, onError: { target: '#failed', actions: 'keepError' } } },
    // importing, checkDuplicate, lookup, parsing, afterParse, decoding, storing, chunking, embedding follow the same pattern
    done: { type: 'final' }, failed: { id: 'failed', type: 'final' },
  },
});
```
Tests of the machines: `machineMapConformance` on both maps, `machineLogConformance` on the events of real runs, path tests with `drive` and
`withActors` (cache hit skips `parsing`; a duplicate docKey ends in `failed` with `invalid_input`; a recipe with `formulaDecoding` visits `decoding`, one without never does; the
embedder failing ends in `failed` with the embedder's code), pins in `machines/pins.json` with a regenerate-and-compare Mermaid diagram test (`docs/ingest.mmd`,
`docs/document.mmd`), and one golden run per machine (normalized event types and states asserted literally). Topology literals appear in the
`pipeline.started` event only; no core default pins them.

## Behaviour (the scenarios in testkit check every line)
1. Refuse (`precondition`) if `embedder.model/dims` differ from `config.space`; only then ensure recipes and space exist
   (`putRecipe` parse/chunk/search and the plain parse recipe, `putSpace`), so a refused request leaves the store untouched.
2. For each entry, in request order (a docKey named twice -> `invalid_input`):
   - source file: `identify` -> emit `ingest.started` -> `store.findArtifact(sha, parseRecipeId)`; on a hit use
     it (origin `cache`), else `parser.parse(..., config.parseRecipe)` (origin `parsed`) and check the echoed
     sha and recipe. docKey = entry.docKey or `defaultDocKey(path)`.
   - artifact file: `parser.readArtifact` -> `ingest.started` (`parseRecipeId` is the plain recipe, as on the file path) -> origin `imported`; any parse recipe is accepted and `composeBuild` flags the build `mixedRecipes` when recipes differ;
     docKey = entry.docKey or `defaultDocKey(artifact.sourceName)`.
   - **Decode formulas (0.6.0, conditional state between parse and chunk).** Taken only when
     `config.parseRecipe.spec.formulaDecoding` is present. The artifact the parse produced (or the cache returned) is the
     plain-docling one under the recipe without `formulaDecoding`; the state looks up the cache for the artifact under
     the full recipe (`findArtifact(sha, fullRecipeId)`), else runs the decoder on the artifact and the source PDF and
     checks the result's recipe equals `config.parseRecipe`. It needs the source file: an entry given as an artifact
     file (no PDF) fails `precondition` unless that artifact already carries the full recipe. The decoder arrives by
     injection as an optional `formulaDecoder` in the dependencies (a thin wrapper over `kg-parse decode-formulas`, built in
     the parse package's wave); absent while the recipe asks for decoding -> `precondition`. Both artifacts are stored. With no
     `formulaDecoding` the state is skipped and nothing changes.
   - `putArtifact` now (a finished parse is never thrown away), emit `ingest.parsed`.
   - `chunker(artifact, docKey, config.chunkRecipe)`; doc version id (`dv_`, the id of the derivation: chunk recipe applied to the artifact) via core `docVersionId`; compute
     inserted / reused (chunk ids already in the store) / dropped (in the previous current version, not in
     this one); emit `ingest.chunked`.
   - embed only `store.missingEmbeddings(space, chunkIds)`. The text is rendered under the space's `formulaView`: ingest
     calls the injected `ChunkViewRenderer` (`renderChunkView` from the chunk package) with the artifact, the chunk's block
     refs for this version (for other documents, drawn again with the chunker from the version's artifact), the stored chunk text and `config.space.formulaView`, then conditions the result with core `renderDocument` (the
     embedder never sees parse structure). With no formulas in the document both views give the stored text. Re-embedding
     under another view needs the parse artifact (the artifact cache keeps it);
     emit `ingest.embedded`.
3. Embed, in `config.space`, every chunk of every OTHER current doc version that lacks a vector
   there (texts via `store.getItems`, conditioned with `renderDocument`; emit `ingest.embedded` for that docKey
   when it embedded anything). A build never holds items search cannot see; `putBuild` refuses with
   `precondition` otherwise.
4. In ONE `store.transaction`: `putDocVersion`, `putEmbeddings`, `setCurrentDocVersion` for every document,
   then `composeBuild` (core) over `currentDocVersions()` with parent = previous current build, `putBuild`,
   `setCurrentBuild` if the id changed. `putDocVersion` throws `immutable_violation` if the same `dv_` was stored with another chunk list (a chunker change without a recipe version bump); let it propagate, the transaction undoes everything. A throw anywhere before or inside leaves no doc version, no pointer
   change and no build (artifacts may remain).
5. Emit `ingest.completed` per document with `previousDocVersionId` (the document's current version before this
   ingest, `null` if none), then `build.created` once if the build changed (pass `{ buildId: newId }` to
   `ctx.emit`), with `parentId` = previous current build and `revert: true` iff the build id already existed
   before `putBuild` (the old and new pointer values are in the log). Return the report (`docs` in request order).

## package.json
Already created (core, pipeline, testkit). Do not run `pnpm install` and do not add dependencies.

## Tests you must pass
`test/scenarios.test.ts`, exactly:
```ts
import { ingestScenarios, registerSuite } from '@kg/testkit/conformance';
import { fixtureChunker } from '@kg/testkit';
import { createIngest } from '../src/index';
registerSuite(ingestScenarios((d) => createIngest(d), fixtureChunker));
```
The scenarios (plus the pipeline-event bracket checks): first ingest; event order; documents embedded through the space template (headings included);
a space switch followed by a one-document ingest yields a fully embedded build; unchanged re-ingest writes and
embeds nothing; artifact cache; v1 -> v2 counts and staleness; artifact import equals source ingest; embedder
failure mid-ingest; failure on a fresh database; incremental documents. `broken.EagerIngestService` shows what failing looks like.
Command: `pnpm --filter @kg/ingest test`.

## Fixtures you may read
`testkit/fixtures/mini-corpus/*` (through testkit's loaders).

## Forbidden imports
Any `@kg/*` other than core and pipeline (testkit in tests). No direct `xstate` import.

## Decisions already made
Builds in v0, content-addressed, created by every changing ingest; all-or-nothing per call; recipes come from the DatabaseConfig, not the request.

## Open questions (note, do not decide)
Partial success for multi-document ingests (commit the good ones) is not supported; parse escalation (OCR
as a second recipe) is future work.
