# @kg/embed (WP4, Haiku)

Contract: `@kg/core` CONTRACT_VERSION 0.2.0. You need this card, `core`, and `testkit`; nothing else.

## Implements (core `ports/embed.ts`, `Embedder`)
`ollamaEmbedder(model: string, dims: number, o?: {baseUrl?: string; batchSize?: number; fetch?: typeof fetch}): Embedder`.
`POST {baseUrl}/api/embed` with `{"model": model, "input": [texts...]}`; response `{"embeddings": number[][]}`.
Batches of `batchSize` (default 32), order preserved, each vector `l2normalize`d (core) and checked to have
`dims` components (else `KgError('upstream')`); network errors and non-2xx -> `upstream`. `embed([])`
resolves `[]` without a request. Texts arrive already conditioned (core `renderDocument`/`renderQuery`);
never add prefixes here.

## package.json to create
dependencies `@kg/core: workspace:*`; devDependencies `@kg/testkit: workspace:*`. Use global `fetch`; inject it
in tests (the HashEmbedder-backed stub below), no msw/nock needed.

## Tests you must pass
`test/conformance.test.ts`:
```ts
import { embedderConformance, registerSuite } from '@kg/testkit/conformance';
import { ollamaEmbedder } from '../src/index';
import { HashEmbedder } from '@kg/testkit';
// a stub /api/embed backed by HashEmbedder (not recorded Ollama output, which would be circular)
const hash = new HashEmbedder(768);
const stubFetch = (async (_url: string, init: { body: string }) => {
  const { input } = JSON.parse(init.body) as { input: string[] };
  const embeddings = (await hash.embed(input)).map((v) => Array.from(v, (x) => x * 3)); // unnormalized on purpose
  return new Response(JSON.stringify({ embeddings }), { status: 200 });
}) as unknown as typeof fetch;
registerSuite(embedderConformance(() => ollamaEmbedder('embeddinggemma:latest', 768, { fetch: stubFetch })));
const live = process.env.KG_OLLAMA === '1';
if (live) registerSuite(embedderConformance(() => ollamaEmbedder('embeddinggemma:latest', 768), { tol: 1e-4 }));
```
plus: a 3-text batch with batchSize 2 makes two requests; a 500 response rejects with `upstream`; a wrong
dimension rejects. Command: `pnpm --filter @kg/embed test` (`KG_OLLAMA=1` for the live suite).

## Fixtures you may read
none (the stub fetch above stands in for Ollama).

## Forbidden imports
Any `@kg/*` other than core (testkit in tests). Do not pull Ollama models.

## Decisions already made
- Model: `embeddinggemma:latest` (768 dims), provisional (decision log 2026-10-17, Phase 1 embedding spike);
  space `DEFAULT_SPACE` with the model's retrieval prompts `title: {headings} | text: {text}` and
  `task: search result | query: {query}` (recall@10 0.81 vs 0.68 without them on 31 hand queries).
- Measured: 312 chunks in 8.0 s (~39 chunks/s, ~31k chars/s) on the M2 Pro; embed is batch-invariant.

## Open questions (note, do not decide)
Other models were not compared (none installed: nomic-embed-text, mxbai-embed-large, bge-m3, qwen3-embedding).
Ollama truncates inputs beyond the model context (2048 tokens) silently; chunks are <= 1500 chars, so fine.
