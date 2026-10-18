# Open questions for the user

Each entry gives: the question, the options, what each implies for scope, cost and later layers, a recommendation, and what stays blocked until it is answered.


## Q1. Builds in v0 (2026-10-17)
Question: add builds to v0, although the design's v0 section does not mention them?
Options: (a) yes, content-addressed builds created by every changing ingest; (b) no, and search filters by a "current chunks" view.
Implications: (a) satisfies Rule 6 (events record the build), keeps superseded chunks out of results, and exercises the recipe/build model before the relation layer needs it; costs one modest package. (b) is smaller but Rule 6 then has nothing to record, and the first expansion would have to retrofit builds under pressure.
Recommendation: (a). Blocks: the store schema and `ingest`.

## Q2. Logging below the MCP layer (2026-10-17)
Question: may logging live in the shared tool layer that MCP exposes one-to-one, rather than in the MCP adapter?
Options: (a) log at the tool contract (`KgApi`), MCP a thin adapter, eval calls the same API; (b) log in the MCP server and run eval through an in-process MCP client.
Implications: both give one path for agent and eval events. (a) keeps MCP trivial and makes tests need no transport; it amends the design sentence "logging is a property of the MCP tool layer". (b) keeps the sentence literal and adds transport to every eval run.
Recommendation: (a). Blocks: the `api` and `mcp` contracts.

## Q3. LLM for eval generation and judging (2026-10-17)
Question: which provider writes eval questions and judges answers?
Options: (a) Claude API behind a replay cache; (b) local Ollama model; (c) Claude for generation and judging, local model for answering.
Implications: (a) gives better questions and a more trustworthy judge, small per-run cost, reruns free via the cache; needs an API key. (b) is free and offline, but leakage of passage wording and a weaker judge risk Phase 4 conclusions; the judge must still pass hand-scored validation. (c) is a middle path.
Recommendation: (a). Blocks: eval prompt work and Phase 4 only; the metrics code is unaffected.

## Q4. May the project pull more Ollama embedding models for a comparison? (2026-10-17, Phase 1)
Question: Phase 1 was told not to pull models, so only embeddinggemma (the one installed) was measured. Should a
later phase pull two or three candidates (e.g. bge-m3, nomic-embed-text, qwen3-embedding:0.6b) and compare them
on the same 31 queries and, better, on the Phase 4 eval set?
Options: (a) yes, before Phase 4, on the hand queries (about 1-2 GB of downloads, an hour of work); (b) yes, but only
after the Phase 4 baseline, as an embedding-model experiment against the pinned eval set; (c) no, stay with
embeddinggemma until the GPU server exists.
Implications: the embedding space is keyed by model and templates, so a switch re-embeds 312 chunks (about 8 s
here) and changes no chunk ID or eval question; the only cost is disk and time. (a) risks tuning to my 31 queries;
(b) measures on the real eval set, but the baseline numbers would then be for embeddinggemma; (c) costs nothing now.
Recommendation: (b). Proceeding provisionally with embeddinggemma:latest and its retrieval prompts (DEFAULT_SPACE).
Blocks: nothing before Phase 4.

## Resolved 2026-10-17
Q1 yes (builds in v0). Q2 yes (log below MCP). Q3 local Ollama for all LLM calls for now. Q4 resolved by the lead under the standing cheap-option instruction: option (b), more embedding models after the Phase 4 baseline. See decision log.

## Q5. What to do with the finished skeleton code that duplicates five Phase 2 packages (2026-10-17, Phase 1 review S7)
Question: `packages/app/src/skeleton` holds working versions of `chunker`, `ingest`, `search`, `api` and the Ollama embedder (about 640 lines) that already pass the required suites. Should Phase 2 re-implement those packages from their cards, or start from this code?
Options: (a) promote the files into their packages, so Phase 2 for those five becomes review plus the missing tests; (b) keep them under `app/src/skeleton`, tell implementers not to read them, and use them as a reference to diff implementer output against; (c) delete them once the packages exist.
Implications: (a) is cheapest and fastest but removes the roadmap's measurement of whether cheap models can build a package from card, core and testkit alone, and carries any hidden coupling the skeleton author brought. (b) keeps the measurement and adds a free oracle, at the cost of five cheap-model package builds. (c) is (b) with less safety.
Recommendation: (b) for `chunk` and `search` (the two most consequential), and your call on the rest. Provisional default: (b) for all five; moving files later is a few minutes. Blocks: the Sprint 1 plan only.

## Resolved 2026-10-18
Q5 option (b): skeleton stays hidden under `packages/app/src/skeleton`, implementers do not read it, and it is used as a reference oracle (user approved the recommendation).
