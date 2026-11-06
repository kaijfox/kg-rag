# @kg/modules

What a use case swaps. Source adapters, the chunker, the build and search modules, the machines that wire them, and the two
operations `ingest` and `rebuild`. It imports `@kg/kernel` only.

## Open first

| To change | File |
|---|---|
| a way of answering (a machine is a list of steps) | `src/machines.ts` |
| a step of answering: nearest passages, nearest facts, expansion by names, dropping replaced entries | `src/modules/search.ts` |
| how sources are read, cut into chunks, embedded and linked | `src/modules/ingest.ts` |
| fact extraction and the checks that refuse a fact | `src/modules/extract.ts` |
| a kind of source: docling PDF, markdown, HTML, dated log | `src/adapters/index.ts` (HTML in `src/adapters/html.ts`) |
| how a folder or a file becomes documents; retiring missing ones | `src/adapters/sources.ts`, `retireMissing` in `src/modules/ingest.ts` |
| how a dated entry is linked to the entry it replaces | `src/rules/replaces.ts` |
| how PDF chunks are cut (changing this changes chunk IDs) | `src/chunk/chunker.ts` |
| parsed PDFs and the docling call | `src/parse/artifacts.ts` |
| `ingest` and `rebuild` | `src/build.ts` |
| the cut of a long block into passages (markdown and HTML) | `src/adapters/pack.ts` |
| the Ollama clients | `src/services/ollama.ts` |

To add a way of answering, write a machine in `src/machines.ts` out of existing modules. To add a kind of source, write an
adapter and register it in `defaultAdapters`. To add a step, write a module that declares what it needs and what it adds.

## Worth knowing

- Changing the chunker, or the markdown or docling adapters' recipes, changes chunk IDs and invalidates evaluation questions
  pinned to them. `test/modules.test.ts` fails when the pinned questions' chunks are no longer reproduced.
- The markdown and HTML adapters cut with the same recipe (version 2 of the markdown packing): a `#` line inside a code fence is not a
  heading, and a block longer than 1,500 characters is cut, because one huge block once exceeded the embedding model's context.
- `ingest` keeps documents whose source path is missing and retires documents whose file left a folder or whose source was
  removed. `rebuild` refuses to run with a missing source, because it would drop their documents.

## Tests

`test/modules.test.ts` covers the chunker and pinned IDs, adapters, extraction, machines and rebuild.
`test/beta.test.ts` covers folder sources and retirement, moving a cache between machines and the shadow machine. `test/helpers.ts` has a word-hash embedder and a scripted model, so no test needs Ollama.
