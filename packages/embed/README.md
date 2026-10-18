# @kg/embed

Embedder backed by a local Ollama server. Exports `ollamaEmbedder(model, dims, options?)`, which returns a core `Embedder`.

## Behavior

- Calls `POST {baseUrl}/api/embed` with `{ model, input }` in batches (default 32, order preserved).
- Every vector is L2-normalized with core's `l2normalize` and must have exactly `dims` finite numbers.
- Network errors, non-2xx responses, non-JSON bodies, a wrong vector count or a wrong dimension reject with `KgError('upstream')`.
- `embed([])` resolves `[]` without any request.
- No prefixes or formula handling here: texts arrive already conditioned by core and rendered by the chunk package.

## Digest check

When `digest` is passed, the first `embed` call with at least one text reads `GET {baseUrl}/api/tags` and finds the entry whose `name` equals `model`.
A missing entry or a different digest rejects with `KgError('precondition')`; a failed `/api/tags` request is `upstream`.
A successful check is cached per embedder instance; a failed one is retried on the next call. Without `digest` there is no tags request.

## Assumptions

- Ollama is reachable at `http://localhost:11434` by default.
- The model is matched by its exact tag name (`embeddinggemma:latest`), not by a shortened name.
- Batches are sent sequentially.

## Known gaps

- The live suite (`KG_OLLAMA=1`) needs a running Ollama with `embeddinggemma:latest`; the default run uses a stub backed by `HashEmbedder`.
- No retries, timeouts or backoff on requests.
- Input length is not checked here. The request sets `truncate: false`, so Ollama rejects an input beyond the model context and the embedder raises `upstream` (the message includes Ollama's error text).
- Only the Ollama wire format is supported.
