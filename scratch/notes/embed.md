# embed package notes

## What was done
- `packages/embed/src/index.ts`: `ollamaEmbedder` with batching, normalization, dimension checks, error mapping and the optional digest check against `/api/tags`.
- `packages/embed/test/conformance.test.ts`: exactly the text from the card.
- `packages/embed/test/ollama.test.ts`: batching (3 texts, batchSize 2 gives two requests), default batch size, empty input, 500, network error, wrong dimension, wrong vector count, non-numeric entries, digest match/mismatch/missing model/failed tags request/no-digest case.
- `packages/embed/README.md`: behavior, assumptions, gaps.

## Results
- `pnpm --filter @kg/embed test`: 20 tests passed.
- `pnpm --filter @kg/embed typecheck`: clean.
- `KG_OLLAMA=1 pnpm --filter @kg/embed test`: 26 tests passed, including the live conformance suite against embeddinggemma:latest with tol 1e-4.

## Assumed
- Digest matching is by `name` only, as the card says. The live tags response has both `name` and `model` fields with the same value.
- Constructor validation: `dims` and `batchSize` must be positive integers (`invalid_input` otherwise). The card did not specify this.
- The digest check result is cached after success only.

## Surprised by / would flag
- The live embeddinggemma digest on this machine matches the card value (85462619...79f1).
- No contract change proposal was needed; the card and core's `Embedder` interface agree.
- Ollama's `/api/tags` lists `qwen3.5:latest` and others, but no other embedding models were checked against (out of scope per the card).

## Review fixes
- The embed request sets `truncate: false`; Ollama's context-length refusal (400) is raised as `upstream` with `details.contextLength` and Ollama's text in the message. Other non-2xx messages now include the response text too. 22 tests.
