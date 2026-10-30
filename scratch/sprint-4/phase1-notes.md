# Sprint 4, Phase 1 notes (written 2026-10-30 13:56, stopped at the user's deadline before any code change)

State: sprint 3 committed (16ec03c), plan committed (685445e), `pnpm check` green at that point, working tree clean. No code changed in sprint 4 yet. `design/` untouched; the approved module concept is not yet written as an amendment (draft it from `scratch/sprint-3/nano-graphrag-comparison.md` and get the user's yes on the text, since AM-9 to AM-13 were not explicitly approved either).

## What the code already has (checked)
- `SearchStep` (`core/src/ports/search.ts`) is the module shape for search: `run(state, env) -> { state, trace }`. `vectorKnn` and `truncate` copy every slot and hand-build `considered` and `output`.
- Machines are XState; `machineMapOf` (`pipeline/src/map.ts`) already yields nodes with `meta.step` and edges, enough for a wiring check.
- The search recipe already stores a derived topology fingerprint; `pins.json` is only a second copy checked in tests. The service refuses a stored recipe whose topology no longer matches (`search/src/service.ts`).
- The service picks the machine from the recipe, so a second request machine is a second registered machine plus a recipe. `searchRecipeId` is already a tool argument.
- `derivedItemId` throws `not_implemented` (`core/src/ids.ts:218`): the id formula for derived items was deferred. The first derive module needs it.
- Tables exist for mappings, derivation runs, relation nodes, summary members; `putMappings` exists on the store; `putItems` already takes relations and nodes and enforces Rule 1. No read of "relations touching a node" exists. Relations carry their `nodes`, so only `relationsOfNode` and a node-name read are missing for the graph view.
- Recipe kinds lack `derive` and `resolve` (`extract` and `equivalence` exist and could be reused; decide).
- Ollama is running locally with qwen3.5; the baseline databases are local (gitignored) at `scratch/sprint-2/*.kg.sqlite`.

## Design choices made for the contract (to implement next)
1. **Trace derivation lives in a module factory, not in the runner.** `defineSearchModule({ name, version, reads, writes, scope }, run)` returns `{ descriptor, make(params): SearchStep }`. The step author returns `{ patch, trace? }`; the factory builds the full next state (no hand copying), rejects a patch to a slot not declared in `writes`, and fills `output` (ranked candidates after) and `considered` (fuseMax of input and output candidates, which equals the old values for both existing steps). The existing `SearchStep` type and the testkit conformance suites stay valid, so the blast radius is small. `truncate(p)` and `vectorKnn(p)` stay as exported constructors over the new modules.
2. **Wiring check** `checkWiring(map, modules, provided = ['queries'])` in core: every work state's `meta.step` must name a registered module, and every slot it reads must be provided initially or written by a state that can reach it. This catches "cut before retrieve" and, later, "walk with no seeds". Recipes gain `modules: { step: 'name@version' }` (optional on old recipes, so stored baseline recipes still run); a changed module version changes the recipe id (Rule 4 now covers step code, which the topology alone did not).
3. **Delete `pins.json` and its tests for search only** after the above; keep the runtime topology refusal.
4. **Derived item id** (decide and log): hash of kind, recipe id, sorted source chunk ids and normalised text. Text is included because producers are models: the same inputs can yield different statements, and an id that ignored text would raise an immutability violation instead of making a new item.
5. **Derive and resolve kernels** (new core files, pure over the store port): `runDerive` validates drafts (non-empty text, sources a subset of the chunks given, at least one node), assigns ids, writes items and nodes in one transaction, and returns rejected drafts with reasons (nothing skipped silently; this is the nano-graphrag lesson). `runResolve` records a derivation run (recipe, hash of the state it saw, base build) and mappings.
6. **Graph view** = `relationsOfNode(nodeId, buildId)`, `getNodes(ids)`, `itemsBySourceChunk` (exists). Add the first two to the store port, sqlite store, testkit fake and conformance.
7. **Request machines**: `DatabaseConfig.requests` maps a name to a search recipe; `search` accepts `request` and the service resolves it; the CLI gets `--request`. One generic seam, no per-use-case tools.
8. **Parity test** (done criterion 1 and 2): keep the old step code as a reference copy in the search tests and assert identical state and trace on the testkit fixtures; if Ollama stays available, also re-run the 63 pinned questions on a baseline database and compare ranked chunk ids.

## Work packages once the contract compiles (disjoint directories)
A search modules and wiring (search); B derive and resolve kernels (core, new files only); C graph view (store, testkit fake and conformance); D requests config, service, CLI and MCP argument (search service, app, api); E cleanups touching the same files. Core type additions (store port methods, recipe kinds, id formula, module types, version 0.7.0) are done first, by the lead, so the agents only fill implementations.

## Phase 3 reminder
Project-history fixture: `scratch/decision-log.md` (one chunk per dated entry), rule-based supersession from the wording, a `current_state` machine; report kernel files touched (target zero).

## Update 13:57: first code landed (before the stop)
- `packages/core/src/module.ts` (new, additive, exported from core): `defineSearchModule`, `checkWiring`, `assertWiring`, `modulesOf`, slot and descriptor types. Tests in `packages/core/test/module.test.ts` (6, passing); core typechecks.
- `truncate` in `packages/search/src/steps/truncate.ts` now runs on `defineSearchModule` (14 lines of logic, down from about 40). Parity evidence: search package 92 of 92 tests pass unchanged, including the shared conformance suite, and app tests pass. This is the first confirmation that runner-built `considered` and `output` equal the hand-built ones for a cut step.
- Not done: port `vectorKnn` (the `into` pool path is the part to check), register modules and call `assertWiring` where machines load, add `modules` to the recipe, delete `pins.json`, full `pnpm check`, everything from the work-package list.
