# @kg/ingest (WP7, Sonnet)

Contract: `@kg/core` CONTRACT_VERSION 0.2.0. You need this card, `core`, and `testkit`; nothing else.

## Implements (core `ports/ingest.ts`, `IngestService`)
`createIngest(d: { store: CorpusStore; parser: Parser; chunker: Chunker; embedder: Embedder; config: DatabaseConfig }): IngestService`.
Everything arrives by injection: you never import store, parse, chunk or embed.

## Behaviour (the scenarios in testkit check every line)
1. Ensure recipes and space exist (`putRecipe` parse/chunk/search, `putSpace`); refuse (`precondition`) if
   `embedder.model/dims` differ from `config.space`.
2. For each entry, in request order (a docKey named twice -> `invalid_input`):
   - source file: `identify` -> emit `ingest.started` -> `store.findArtifact(sha, parseRecipeId)`; on a hit use
     it (origin `cache`), else `parser.parse(..., config.parseRecipe)` (origin `parsed`) and check the echoed
     sha and recipe. docKey = entry.docKey or `defaultDocKey(path)`.
   - artifact file: `parser.readArtifact` -> `ingest.started` (its own parse recipe id) -> origin `imported`;
     docKey = entry.docKey or `defaultDocKey(artifact.sourceName)`.
   - `putArtifact` now (a finished parse is never thrown away), emit `ingest.parsed`.
   - `chunker(artifact, docKey, config.chunkRecipe)`; doc version id via core `docVersionId`; compute
     inserted / reused (chunk ids already in the store) / dropped (in the previous current version, not in
     this one); emit `ingest.chunked`.
   - embed only `store.missingEmbeddings(space, chunkIds)`, conditioning with core `renderDocument`;
     emit `ingest.embedded`.
3. S2 (R-24): embed, in `config.space`, every chunk of every OTHER current doc version that lacks a vector
   there (texts via `store.getItems`, conditioned with `renderDocument`; emit `ingest.embedded` for that docKey
   when it embedded anything). A build never holds items search cannot see; `putBuild` refuses with
   `precondition` otherwise.
4. In ONE `store.transaction`: `putDocVersion`, `putEmbeddings`, `setCurrentDocVersion` for every document,
   then `composeBuild` (core) over `currentDocVersions()` with parent = previous current build, `putBuild`,
   `setCurrentBuild` if the id changed. A throw anywhere before or inside leaves no doc version, no pointer
   change and no build (artifacts may remain).
5. Emit `ingest.completed` per document, then `build.created` once if the build changed (pass
   `{ buildId: newId }` to `ctx.emit`). Return the report (`docs` in request order).

## package.json to create
dependencies `@kg/core: workspace:*`; devDependencies `@kg/testkit: workspace:*`.

## Tests you must pass
`test/scenarios.test.ts`, exactly:
```ts
import { ingestScenarios, registerSuite } from '@kg/testkit/conformance';
import { fixtureChunker } from '@kg/testkit';
import { createIngest } from '../src/index';
registerSuite(ingestScenarios((d) => createIngest(d), fixtureChunker));
```
11 scenarios: first ingest; event order; documents embedded through the space template (headings included);
a space switch followed by a one-document ingest yields a fully embedded build; unchanged re-ingest writes and
embeds nothing; artifact cache; v1 -> v2 counts and staleness; artifact import equals source ingest; embedder
failure mid-ingest; failure on a fresh database; incremental documents. `broken.EagerIngestService` shows what failing looks like.
Command: `pnpm --filter @kg/ingest test`.

## Fixtures you may read
`testkit/fixtures/mini-corpus/*` (through testkit's loaders).

## Forbidden imports
Any `@kg/*` other than core (testkit in tests).

## Decisions already made
Builds in v0, content-addressed, created by every changing ingest (user decision Q1); all-or-nothing per
call (contract-revisions R-09); recipes come from the DatabaseConfig, not the request (R-08).

## Open questions (note, do not decide)
Partial success for multi-document ingests (commit the good ones) is not supported; parse escalation (OCR
as a second recipe) is future work.
