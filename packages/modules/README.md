# @kg/modules

What a use case swaps. Depends on `@kg/kernel` only.

- `adapters/`: a source adapter turns a file into a document. `docling-pdf` (a parsed docling document, cut by the
  chunker), `markdown`, and `decision-log` (one chunk per dated entry, with the date and title in the chunk's meta).
- `chunk/`: the section-pack chunker and the placeholder view of formulas that embeddings use. Changing either changes
  chunk IDs, which invalidates evaluation questions pinned to them.
- `parse/`: the kept parsed documents (`ArtifactStore`) and the docling sidecar call.
- `modules/ingest.ts`, `modules/extract.ts`, `modules/search.ts`: the modules. Fact extraction rejects a fact that starts with
  a pronoun, refers to "the chapter" or an equation number, is too short, or copies the passage, and logs each rejection.
- `rules/replaces.ts`: the rule that links a dated entry to the entry it says it replaces. No model.
- `machines.ts`: the shipped machines and `createRegistry()`.
- `build.ts`: `ingest` (into the current index) and `rebuild` (a new index file, audited before it is swapped in).

To add a way of answering, write a machine in `machines.ts` out of existing modules. To add a kind of source, write an
adapter. To add a step, write a module that declares what it needs and adds.
