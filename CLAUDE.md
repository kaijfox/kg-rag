# kg-rag: working guide

kg-rag retrieves background knowledge for coding and research agents from document corpora and project histories, through
MCP tools. Similarity search over chunks is the baseline, and every other layer must beat it in a measurement to stay.
Read `design/architecture.md` first. It is short and current. Everything in `design/archive/` describes a replaced design
and must not be followed.

## Where to look

| To know | Read |
|---|---|
| why something is built this way, what rules the code enforces, what is deliberately not built | `design/architecture.md` |
| why a specific choice was made | `design/decisions.md` |
| what was measured, and which script reproduces it | `design/measurements.md`, `experiments/` |
| what a package holds and which file to open first | `packages/<name>/README.md` |
| what testers receive: setup, prompts, recipes, expectations | `docs/beta/` |

## Commands

Run everything from the repository root.

- `pnpm check` runs the type checks, the dependency rules and every test. Run it before reporting work as done.
- `./kg --help` lists the commands. `./kg machines` lists the ways of answering as steps.
- Real-model scripts in `experiments/` need Ollama with `embeddinggemma` and `qwen3.5`. The tests need neither.

## Constraints

- Edits to `design/` need the user's approval: show the change and get a yes first.
- Every model call uses local Ollama. Prefer the computationally cheap option when there is a choice.
- kg-rag indexes what it is pointed at. It does not fetch, convert, deduplicate or organise corpora. Add an adapter or an
  optional helper when users ask for one, and keep the core free of corpus management.
- A source location (file path, line) goes in chunk metadata and never in chunk text, because the text decides the chunk ID.
- Chunk IDs, the chunker and the markdown and docling adapters are pinned by evaluation questions. A change to any of them
  invalidates `test/corpa/stat-mech/eval/`, and a test fails when it does.

## When a change is made

- A change that alters a rule or the contract of a module appends an entry to `design/decisions.md` in the same commit,
  under a heading with the date and a short title.
- A new measurement is added to `design/measurements.md` as a dated section, with the script in `experiments/`.
- A change to a command, machine or package layout updates the README that mentions it. A test fails when a README names a
  command or file that does not exist.

## Writing documents

Documents that outlive the work are read by someone who has only the page.

- Put each claim's reason in the same sentence or the next. Do not rely on the reader holding the whole document in mind.
- Define a term where it first appears, use few terms, and give a concrete example before an abstract rule.
- A figure or a table appears only with the sentence that says what to see in it and what it means.
- Use plain words. Do not use sprint markers, numbered labels for decisions or open questions, or names that only the author knows.
- Cut announcing, restating and decoration. Never cut the reasoning.
