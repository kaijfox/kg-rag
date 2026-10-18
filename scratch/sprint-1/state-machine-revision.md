# Revision plan: state machines as the backbone of every pipeline

Written 2026-10-18 against `@kg/core` 0.4.0, revised the same day after the user's decisions (see Decided). This is a plan only: no package, core or design file was edited. It replaces the spike's verdict ("keep the runner for search") with the user's binding decisions, and reuses the spike's measured results (`scratch/sprint-1/spike-state-machine/results.md`, code in its `src/`) wherever they still apply.

The five decisions this plan implements:
1. Every multi-step pipeline is a hand-written XState v5 machine, one machine per pipeline kind, consistently.
2. No generic machine interpreting a recipe config. A recipe becomes machine name + version + typed settings.
3. No pause/resume and no snapshot persistence. The spike's ingest checkpoints, snapshot store and at-least-once events are dropped.
4. Machines are visualized, and a finished session's logged steps map back onto machine states.
5. Plain descriptive names. No sprint markers in cards, READMEs, code comments or design text.

Tool and version facts below were read from the npm registry and from the packages' own `.d.ts` / README files (`npm view`, `npm pack`), not from memory. Where something could not be verified it says so.

## Decided

- v0 search has exactly one machine, `similarity`. `decompose-fuse` and `critique-loop` are not built (they need model calls inside retrieval, which is not v0); their steps (decompose, fuse, critique) are not built either. See the appendix "Future machines". Evaluation question generation and judging stay machines (model use there is not retrieval).
- A recipe is machine name + version + typed settings + topology pin.
- The shared toolkit is `@kg/pipeline` (directory `packages/pipeline`). XState is its implementation detail; `core` stays XState-free.
- Approved: the new shared package and the matching dependency-rule amendment; one small skeleton edit (a local legacy recipe type); the xstate inspector off by default and never given state values or context.
- Approved: contract 0.5.0 with the `pipeline.started` and `pipeline.finished` events and a required `state` on search-step traces.
- xstate is pinned to 5.33.2 until 5.33.3 is two weeks old (that is 2026-10-31).
- Prompt text is hashed into the recipe id.
- The viewer vendors Mermaid.
- Models for implementation: Sonnet or Haiku only, never Opus. The lead is the lead session; reviewers are Sonnet.
- Formula handling is in v0 (section 13): GLM-OCR decoding as an optional parse-recipe stage, views derived from docling's block structure, embedding view as a setting of the embedding space. This lands as a follow-up contract change (0.6.0) after the 0.5.0 foundations.
- No pause/resume, no snapshots, no generic recipe interpreter, no sprint markers in text that outlives the sprint.

---

## 1. The architecture in plain language

**What changes.** Today a search is "a list of steps run one after another by a small loop". Ingest is one long function. Anything smarter (split a question into parts, ask a model whether the evidence is enough and look again; not v0, but the same shape appears in ingest and evaluation) does not fit a list, so the contract was growing special rules to cope (a "done" flag, skipping steps, a repeat construct, a naming pattern for lists to merge).

**The new idea.** Each kind of pipeline is written as a small, explicit **state machine**: a diagram-shaped program with named stations ("states"), the allowed moves between them, and the rule that picks the move. For example, the v0 similarity search has stations *retrieve*, *cut* and *done* (and *failed* if something goes wrong). A later search that reviews its own evidence would add a *verdict* station whose rule is "if satisfied go to *cut*, otherwise go back to *retrieve*". A loop is just a move that goes backwards, so no special loop feature is needed.

**What a station does.** A station does one piece of work by calling one of our existing modules (the vector search, the language model, the chunker, the store) with named, typed settings. The modules stay ordinary functions; they do not know that machines exist. The machine only decides the order and the routing.

**What a "recipe" is now.** A recipe is no longer a list of step names with loose parameters that code has to interpret. It is three things: *which machine* (its name), *which version of that machine*, and *its settings* (a typed object such as "retrieve 100 candidates, ask model X, at most 2 rounds"). To change the shape of a pipeline you write or edit a machine in code; to tune it you change the settings. Because the shape is code, the shape is readable in one file and can be drawn.

**Why this is worth it for you.**
- *One way of building everything.* Search, ingest, evaluation runs and question generation all use the same pattern, so a new pipeline (graph walk, summaries, parse escalation) has an obvious template.
- *Pictures for free.* Because a machine is data about states and moves, we generate diagrams from the code, so the picture cannot drift from the program.
- *Better diagnosis.* The log already records what each step considered and returned. Now every logged step also names the station it came from, so the session viewer can draw the machine and light up the path one particular query took, including how many rounds a loop went around and where a failed run stopped.
- *Honest identity.* Two searches are "the same recipe" only if machine, version, settings and the machine's shape all match. Edit a machine's wiring without bumping its version and the system refuses to run it rather than silently mixing results in the evaluation.

**What it costs.** One new small library (XState, no runtime dependencies, about 13 KB gzipped for what we use) and one new shared package that holds the helpers every machine uses. Writing a pipeline now needs a little XState knowledge (a template and a checklist make this routine for cheaper models). Every change to a machine's wiring is a version bump.

**What we deliberately do not build.** Pause/resume of a half-finished ingest or search, saving machine snapshots, a generic machine that interprets a configuration, or any change to the data model (chunks, items, builds, ids).

---

## 2. Survey: which pipelines become machines

Rule used for the survey. A procedure becomes a machine when it has data-dependent branching, loops or retries, or composes steps from other modules, or emits progress events a human places in a structure. A procedure stays a plain function when it is one module's own straight-line code whose every outcome is a return value or a thrown error code, with no progress events and no loops. A plain function that later grows a loop, retry, branch on data or progress events becomes a machine (a review checklist item, section 11).

| Package | Becomes a machine | Stays a plain function (reason) |
|---|---|---|
| `search` | `similarity` (retrieve, cut), the only search machine in v0. Search machines that call a model inside retrieval are not v0 (appendix "Future machines"). | The steps themselves (`vector-knn`, `truncate`): each is one module call with typed parameters, called from a machine state. The request prelude (resolve build, recipe, space; refuse a wrong embedder): validation that either passes or throws, no branching worth showing. |
| `ingest` | `ingest` (validate, per document: identify, resolve, store artifact, chunk, embed; extra embeddings for other documents, completeness gate, commit, announce) with a per-document child machine. | The commit transaction body (`store.transaction(...)`): one atomic unit that must not be interleaved; it is a single state's work, not a machine. |
| `eval` (runner) | `eval-run` (open session, check build and staleness, per question: per condition via a child `eval-question` machine, summarize, complete). `eval-question` (build context for the condition, answer, judge, score). | Metric functions (`recallAtK`, `allGoldAtK`, aggregation, orphaned-gold check): pure arithmetic over data. |
| `eval` (prompts) | `eval-generate` (select chunks or groups, generate, parse, validate, retry on malformed output within a budget, dedupe, drafts). `judge` (call, parse, retry on malformed output, fail). Both are recipe-carrying machines (recipe kinds `eval-generate` and `eval-judge` already exist). | `answer(llm, question, context)`: one model call; it is a state of `eval-question`, not a pipeline. Output parsers: pure text-to-struct functions. |
| `api` | none | All handlers (`getItems`, `feedback`, `reportUsage`, `reportOutcome`, `snapshotBuild`, `addNote`): a validation, a store read or write and an emit; at most one conditional emit (`snapshotBuild`'s stale announcement). `search` and `ingest` handlers delegate to the machine-backed services. Revisit if a handler gains a loop or retry. |
| `mcp` | none | A one-to-one adapter: connection opens a session, each tool call forwards to `KgApi`. The SDK owns the connection lifecycle; logging lives below it. |
| `parse` (TypeScript) | none today | `SubprocessParser.parse`: spawn, wait, read, validate, verify echoed sha and recipe, map exit codes to error codes. One module's straight-line procedure; its outcomes are return or a coded error, and the caller (the ingest machine) already shows the cache / parse / import branch as states. Becomes a `parse-escalate` machine when parse escalation (a second recipe after a quality gate) is built. |
| `parse-sidecar` (Python) | none | Not TypeScript and not part of the pipeline architecture: a CLI whose contract is its exit codes. Its internals are a single docling conversion. |
| `chunk` | none | `sectionPack`: pure, synchronous, deterministic and identity-critical. A machine adds nothing and the frozen output must not depend on a framework. |
| `embed` | none | `ollamaEmbedder`: batching loop and one digest pre-check, no data-dependent routing, no events. |
| `store`, `eventlog` | none | Persistence adapters; every method is atomic or a single query. |
| `viewer` | none | Not a pipeline. It renders machines but does not run one. |
| `core` | none (no xstate in core, see section 5) | `runTool` / `createKgApi`: a fixed wrapper around every tool call whose outcome is the three logged events `tool.called`, `tool.returned`, `tool.failed`. It is the trace, not a pipeline. |
| `app` | none | Composition root and startup sequence (open database, run schema, check machine pins, wire services); it runs once and fails fast. |
| `testkit` | none | Fakes and suites. It gains suites that check machines but contains no machine. |

Future recipe kinds (`extract`, `equivalence`, `cluster`, `summarize`, graph walk) are machines by default; this is stated in the `core` README so no one has to decide again.

---

## 3. Recipes as data: identity, defaults, builds, evaluation, viewer

### 3.1 The recipe shape

```ts
// core/model.ts (replaces SearchStepSpec and the {steps} SearchRecipeSpec)
export type MachineRecipeSpec<K extends RecipeKind, S extends JsonObject = JsonObject> = {
  kind: K;                       // 'search' | 'eval-generate' | 'eval-judge' | later kinds
  version: string;               // version of the machine code, bumped on ANY behaviour change: '1', '2', ...
  spec: {
    machine: string;             // 'similarity' in v0; later machines add names
    settings: S;                 // typed per machine in the package that owns it, validated there
    topology: string;            // 16 hex chars: fingerprint of the machine's states, moves, guard names, step names
    promptDigest?: string;       // only for machines that carry prompt text: sha256 of the prompt files
  };
};
export type SearchRecipeSpec = MachineRecipeSpec<'search'>;
```

Per machine, its package exports: the `Settings` type, a strict zod `settingsSchema`, `defaultSettings`, a `recipe(settings)` builder that fills `version` and `topology`, and the machine itself. Parse and chunk recipes keep their existing shape (they describe a tool and parameters, not a pipeline).

### 3.2 Identity

- `recipeId` stays core's existing function over canonical JSON of the whole `{kind, version, spec}`. So the id covers kind, machine name, version, every setting, the topology fingerprint and, where present, the prompt digest. No change to `hashId` or its prefix.
- **Topology fingerprint** (from the spike, 16 hex chars of sha256 over the machine's `config` with functions replaced by a marker, where each state records its step name and static settings in `meta` and guards are named). It catches: a state added, removed or rewired, a guard renamed or swapped, a step swapped. It does not catch: a guard body or step implementation changed, a prompt edited. Those are covered by the version rule plus golden runs (section 10), and for prompt-bearing machines by a prompt digest (below).
- **Prompt text is part of the id.** Machines that carry prompt templates (`eval-generate`, `judge`) put `promptDigest` (sha256 over their prompt files, filled in by the machine's `recipe(settings)` builder) into `spec`, so it enters `recipeId`. Editing a prompt gives a new recipe id even if someone forgets the version bump; a package test also fails if prompt text changes without a version bump, so version and id stay in step. `pins.json` records the digest as well.
- **Registry pin check.** Each package keeps `machines/pins.json`: `{ "<machine>@<version>": { topology, promptDigest? } }`. A package test recomputes both and fails on drift. At startup the service also recomputes the topology and refuses (`precondition`) a recipe whose topology differs from the code's for that name and version. This is the spike's executor check, kept.
- **Released versions are frozen.** A behaviour change is a new version (`similarity` v2 sits next to v1 in the registry). A deprecated version may be deleted deliberately; a build whose default recipe names a deleted version still opens and serves search by passing an explicit current `searchRecipeId`; asking for the deleted version gives `not_found: machine similarity@1`.

### 3.3 `DatabaseConfig` defaults

- `DEFAULT_SEARCH_RECIPE` becomes `{ kind: 'search', version: '1', spec: { machine: 'similarity', settings: { pool: 100, kinds: ['chunk'] }, topology: '<16 hex literal>' } }`. `core` cannot compute the topology (it must not import `search`), so the literal is pinned in `defaults.ts`, exactly as the embedding model digest already is. A `search` package test asserts `similarity.topology === DEFAULT_SEARCH_RECIPE.spec.topology`, so editing the machine forces a conscious edit of core defaults, the golden id vectors and `oracle.py`.
- Default ids change (new recipe shape), so `packages/testkit/golden/ids.json` and `oracle.py` are regenerated and `DEFAULT_*` doc comment keeps the "changing any of these changes ids" warning. Chunk and parse recipe ids are unchanged.
- `DatabaseConfig.searchRecipe` is the database's default search machine; any other search recipe can be put in the store and named per request.

### 3.4 Builds

`BuildManifest.searchRecipeId` keeps its meaning (the default search recipe the build was composed with) and its type. `composeBuild` and `buildId` are untouched, but every build id changes once because the default recipe id changed (expected, golden vectors regenerated). Existing development databases written with the step-list shape are discarded: no migration, because v0 has no production data. The stored recipe row is the single source for "which machine and settings does this build default to".

### 3.5 Evaluation comparisons

- A search under test is identified by its `searchRecipeId`. Comparing two search designs is comparing two recipe ids on one frozen eval set and one build.
- `EvalRunInput` gains an optional `searchRecipes: Record<conditionName, RecipeId>` so one run can hold two retrieved conditions (for example `retrieved:k100` and `retrieved:k200`, or later a different machine) side by side. Absent means the build's default recipe, as today. `eval.run.started` gains the same optional map so the log states what was compared; `EvalRunRecord.config` carries it too.
- The run summary labels each retrieved condition with `machine@version` and a settings summary. Two recipes with the same machine and version but different settings are a parameter sweep; different machine or version are flagged "different design". The report prints a settings diff.
- Eval-set generation records its recipe the same way (`genRecipeId` already exists on `EvalSet`; it now points at an `eval-generate` machine recipe whose settings include the model and question-type mix).

### 3.6 Viewer

The viewer learns the machine from the log (section 7): `pipeline.started` names `machine`, `version`, `topology`, `recipeId`. App passes the viewer a `machineMap(machine, version)` function returning a `MachineMap` (plain JSON drawn from the registry), like `itemInfo`. A recipe whose machine is unknown to this build of the software (a deleted version) still shows the flat step list.

---

## 4. Machines: sketches

All sketches use `setup()`, typed context, input, output and events, promise actors (`fromPromise`), named guards and actions. They are sketches for implementers, not final code. Conventions common to every machine:

- Context may hold live services (`run`: environment, clock, emit function) because nothing is persisted. This removes the spike's constraint that context be JSON.
- Every state that does work is an `invoke` of a typed promise actor and carries `meta: { logs, label }` naming what it emits. Pure routing states contain only `always` transitions with named guards and carry `meta.routing: true`.
- Every invoke has `onError: '#failed'`; the machine has exactly two final states, `done` and `failed`. `failed` keeps the original error in context so the kit can rethrow the same `KgError` code.
- Rule for authors, enforced by lint (section 10): a state that calls a module does so only through a kit actor factory (`stepActor` for search, `loggedActor` for others), never a bare `fromPromise` in a machine file. That is what guarantees logging.

### 4.1 The pipeline toolkit (`@kg/pipeline`, new)

```ts
// packages/pipeline/src/index.ts
export { setup, assign, createActor, fromPromise, toPromise, and, or, not, assertEvent } from 'xstate';
export type { ActorRefFrom, SnapshotFrom, EventFrom } from 'xstate';

export interface PipelineRun {                 // everything a pipeline needs from the outside
  ctx: Ctx;                                    // core: emit, clock, ids
  tag: { searchId?: SearchId; buildId?: BuildId };   // envelope fields for emit
}

export interface PipelineIdentity { pipeline: 'search' | 'ingest' | 'eval-run' | 'eval-generate'; machine: string; version: string; topology: string; recipeId: RecipeId | null }

/** Runs a machine to its final state. Emits pipeline.started first and pipeline.finished last. Rethrows the KgError held by `failed`. */
export function runPipeline<M extends AnyStateMachine>(
  machine: M, input: InputFrom<M>,
  o: { run: PipelineRun; identity: PipelineIdentity; inspect?: Observer<InspectionEvent> },
): Promise<OutputFrom<M>>;

/** MachineMap (core type) drawn from a machine definition. */
export function machineMapOf(machine: AnyStateMachine, id: { machine: string; version: string }): MachineMap;
export function toMermaid(map: MachineMap): string;
export function topologyOf(machine: AnyStateMachine): string;   // 16 hex, spike algorithm
```

`runPipeline` creates the actor with `createActor(machine, { input, inspect })`, awaits it with `toPromise`, and detects a stopped actor explicitly (the spike found `toPromise` resolves on `stop()`). The state name for `pipeline.finished` comes from the final snapshot's `value`. The `inspect` option is how the developer inspector (section 6.2) attaches without touching a machine.

### 4.2 Search: shared pieces (package `search`)

```ts
// packages/search/src/machines/kit.ts
import { fromPromise } from '@kg/pipeline';

export interface SearchRun { env: StepEnv; ctx: Ctx; tag: { searchId: SearchId; buildId: BuildId }; nextIndex: number }
export interface StepInput<P> { run: SearchRun; at: string; state: SearchState; params: P }

/** The single logging point: runs the step, emits one search.step with the state name. */
export function stepActor<P>(make: (p: P) => SearchStep) {
  return fromPromise(async ({ input }: { input: StepInput<P> }): Promise<SearchState> => {
    const step = make(input.params);
    const t0 = input.run.ctx.clock.monotonicMs();
    const out = await step.run(input.state, input.run.env);
    input.run.ctx.emit('search.step', {
      trace: { ...out.trace, state: input.at, stepIndex: input.run.nextIndex++,
               durationMs: Math.max(0, input.run.ctx.clock.monotonicMs() - t0) },
    }, input.run.tag);
    return out.state;
  });
}
```

Steps are the existing `SearchStep` objects built by typed constructors: `vectorKnn(p: { pool: number; kinds: ItemKind[] })` and `truncate(p: { k?: number })`. No `JsonObject` parameters and no `StepFactory` registry remain. Pool naming stays as in contract 0.3.0; v0's one machine does not use named pools beyond the default one.

### 4.3 `similarity` (retrieve, cut)

```ts
export interface SimilaritySettings { pool: number; kinds: ItemKind[] }
type Ctx = { run: SearchRun; settings: SimilaritySettings; state: SearchState; error?: KgError };
type In  = { run: SearchRun; settings: SimilaritySettings; state: SearchState };

export const similarity = setup({
  types: { context: {} as Ctx, input: {} as In, output: {} as SearchState },
  actors: { retrieve: stepActor(vectorKnn), cut: stepActor(truncate) },
}).createMachine({
  id: 'similarity',
  context: ({ input }) => input,
  initial: 'retrieve',
  output: ({ context }) => context.state,
  states: {
    retrieve: {
      meta: { logs: 'search.step', step: 'vector-knn' },
      invoke: {
        src: 'retrieve',
        input: ({ context }) => ({ run: context.run, at: 'retrieve', state: context.state,
          params: { pool: context.settings.pool, kinds: context.settings.kinds } }),
        onDone: { target: 'cut', actions: assign({ state: ({ event }) => event.output }) },
        onError: { target: '#failed', actions: assign({ error: ({ event }) => toKgError(event.error) }) },
      },
    },
    cut: { /* same shape, actor 'cut', params {}, onDone -> 'done' */ },
    done: { type: 'final' },
    failed: { id: 'failed', type: 'final' },
  },
});
```

### 4.4 and 4.5 Other search machines: not built

The earlier sketches of `decompose-fuse` and `critique-loop` are removed (decision: no model calls inside retrieval in v0). Short sketches live in the appendix "Future machines" only to show the contract needs no change to add them.

### 4.6 The search service and where each event is emitted

```ts
// packages/search/src/service.ts (plain function; resolves inputs, then runs one machine)
export function createSearch(d: { store; embedder; llm?; machines?: SearchMachineRegistry }): SearchService {
  return { async search(ctx, req) {
    const { buildId, recipe, rid, space } = resolve(d, req);          // refuses: no build, unknown, wrong embedder, unknown machine,
    const entry = registry.get(recipe.spec.machine, recipe.version);   //          topology mismatch, settings fail the strict schema
    const searchId = ctx.ids.ulid('sr_') as SearchId; const tag = { searchId, buildId };
    ctx.emit('query', { query: req.query, k: req.k, searchRecipeId: rid }, tag);
    const run: SearchRun = { env: { store: d.store, embedder: d.embedder, space, llm: d.llm }, ctx, tag, nextIndex: 0 };
    const end = await runPipeline(entry.machine, { run, settings: entry.parse(recipe.spec.settings), state: initialState(req, buildId) },
      { run: { ctx, tag }, identity: { pipeline: 'search', machine: entry.name, version: entry.version, topology: entry.topology, recipeId: rid } });
    return finish(d, ctx, tag, end, req);                              // cut to k, texts, stale flag, emits search.result
  } };
}
```
Event order for a search: `query`, `pipeline.started`, N x `search.step` (each with `state`), `pipeline.finished`, `search.result`. Failure: `pipeline.finished` with `status: failed` and the state, then the thrown `KgError` becomes `tool.failed` as before.

### 4.7 `ingest` (validate, per-document child machine, extras, gate, commit, announce)

Events and the single transaction are unchanged from the 0.4.0 contract; only the structure is explicit. No persistence, no checkpoint, no snapshot store, no planning stage before commit (that stage existed only so a resumed run reported the revert flag correctly), so the run is the skeleton's order in machine form.

```ts
type Entry = { kind: 'file' | 'artifact'; path: string; docKey?: string };
type DocOut = { docKey: DocKey; docVersionId: DocVersionId; previous: DocVersionId | null; unchanged: boolean; inserted: number; reused: number; dropped: number;
                rows: { itemId: ChunkId; vector: Float32Array }[]; drafts: ChunkDraft[]; version: Omit<DocVersion, 'createdAt'> };

// child: one document. Branches are states, so the viewer shows cache / parse / import.
const documentMachine = setup({
  types: { context: {} as DocCtx, input: {} as { entry: Entry; seen: ReadonlySet<string>; deps: IngestDeps; run: PipelineRun }, output: {} as DocOut },
  actors: { identify, readArtifact, findCached, parseFile, storeArtifact, chunk, embed },     // each created with loggedActor(...)
  guards: { isFile: ({ context }) => context.entry.kind === 'file', cached: ({ context }) => context.cachedArtifact !== null,
            duplicate: ({ context }) => context.seen.has(context.docKey!) },
}).createMachine({
  initial: 'route', output: ({ context }) => context.out!,
  states: {
    route:        { meta: { routing: true }, always: [{ guard: 'isFile', target: 'identifying' }, { target: 'importing' }] },
    identifying:  { meta: { logs: 'ingest.started' }, invoke: { src: 'identify',    onDone: { target: 'checkDuplicate', actions: 'adopt' }, onError: '#failed' } },
    importing:    { meta: { logs: 'ingest.started' }, invoke: { src: 'readArtifact', onDone: { target: 'checkDuplicate', actions: 'adopt' }, onError: '#failed' } },
    checkDuplicate:{ meta: { routing: true }, always: [{ guard: 'duplicate', target: '#failed' /* invalid_input */ }, { guard: 'isFile', target: 'lookup' }, { target: 'storing' }] },
    lookup:       { meta: { routing: true, label: 'artifact cached?' }, entry: 'findCachedArtifact',
                    always: [{ guard: 'cached', target: 'storing' }, { target: 'parsing' }] },
    parsing:      { meta: { logs: '' }, invoke: { src: 'parseFile', onDone: { target: 'storing', actions: 'adopt' }, onError: '#failed' } },
    storing:      { meta: { logs: 'ingest.parsed' }, invoke: { src: 'storeArtifact', onDone: { target: 'chunking', actions: 'adopt' }, onError: '#failed' } },
    chunking:     { meta: { logs: 'ingest.chunked' }, invoke: { src: 'chunk', onDone: { target: 'embedding', actions: 'adopt' }, onError: '#failed' } },
    embedding:    { meta: { logs: 'ingest.embedded' }, invoke: { src: 'embed', onDone: 'done', onError: '#failed' } },
    done: { type: 'final' }, failed: { id: 'failed', type: 'final' },
  },
});

// parent: the whole request. Sequential, documents in request order.
export const ingestMachine = setup({
  types: { context: {} as RunCtx, input: {} as RunIn, output: {} as IngestReport },
  actors: { prepare, document: documentMachine, extras, commit, announce },
  guards: { moreDocuments: ({ context }) => context.index < context.entries.length,
            complete: ({ context }) => context.gateOk },
}).createMachine({
  id: 'ingest', initial: 'preparing',
  states: {
    preparing: { meta: { logs: '' }, invoke: { src: 'prepare', onDone: { target: 'nextDocument', actions: 'adopt' }, onError: '#failed' } },   // embedder serves space? putRecipe x3, putSpace
    nextDocument: { meta: { routing: true }, always: [{ guard: 'moreDocuments', target: 'document' }, { target: 'extras' }] },
    document: { invoke: { src: 'document', input: ({ context }) => ({ entry: context.entries[context.index]!, seen: context.seen, deps: context.deps, run: context.run }),
                          onDone: { target: 'nextDocument', actions: 'collectDocument' }, onError: '#failed' } },
    extras:   { meta: { logs: 'ingest.embedded', label: 'embed other current documents lacking vectors in this space' },
                invoke: { src: 'extras', onDone: { target: 'gate', actions: 'adopt' }, onError: '#failed' } },
    gate:     { meta: { routing: true, label: 'every item has a vector?' }, always: [{ guard: 'complete', target: 'committing' }, { target: '#failed' /* precondition */ }] },
    committing: { meta: { label: 'one transaction: doc versions, vectors, pointers, build' },
                  invoke: { src: 'commit', onDone: { target: 'announcing', actions: 'adopt' }, onError: '#failed' } },
    announcing: { meta: { logs: 'ingest.completed build.created' }, invoke: { src: 'announce', onDone: 'done', onError: '#failed' } },
    done: { type: 'final' }, failed: { id: 'failed', type: 'final' },
  },
  output: ({ context }) => context.report!,
});
```
Logging: `loggedActor(name, fn)` wraps a promise actor so the actor's body calls a typed `emit` (the events listed under `meta.logs`); the same lint rule as search applies. Events and their order are identical to the skeleton's, with `pipeline.started` first and `pipeline.finished` last. The `gate` guard duplicates, and does not replace, the store's own completeness check at `putBuild`.

### 4.8 Evaluation machines (sketch level)

```
eval-run:      opening -> checkingBuild -> (stale and not allowed ? failed) -> pinning(putRun, eval.run.started)
               -> nextQuestion -> (more ? question : summarizing) ; question = invoke child eval-question per (question, condition)
               -> summarizing(orphaned gold, summary) -> completing(eval.run.completed) -> done | failed
eval-question: route(condition kind) -> contextNone | contextGold | contextRetrieved(api.search, nested tool call) | contextOracle
               -> answering(loggedLlm) -> judging(child judge) -> scoring(eval.question.scored, repo.putResult) -> done | failed
judge:         calling -> parsing -> (malformed and tries left ? calling : failed) -> done
eval-generate: selecting -> generating -> parsing -> (malformed and tries left ? generating : failed) -> validating(dedupe, no wording reuse) -> done
```
The condition branch is a named-guard routing state per condition kind; unknown condition names are `invalid_input` before the run starts. Settings for `eval-generate` and `judge` are typed (model, temperature, question-type mix, retry budget); prompts live in files and are hashed into the recipe id.

---

## 5. Where XState lives

**Decision: `core` stays free of XState. XState is a dependency of exactly one new package, `@kg/pipeline`, and pipeline packages use it only through that package.** `@kg/pipeline` is the shared toolkit for building and running pipelines; XState is an implementation detail inside it.

What is in it: the run wrapper (`runPipeline`: starts a machine, writes the two bracket events, rethrows the original error), the logged-actor factory, the generator for the machine map, the topology fingerprint and the Mermaid text, pin-check helpers, test helpers and the how-to-write-a-pipeline template. What is not in it: any pipeline of ours (search, ingest and eval own their machines), any domain type (core owns those), and any call to a model, store or parser.

Why not in core: core is the contract that every package, the viewer and the MCP adapter import. Putting XState there would force a runtime library onto packages that never run a pipeline and tie the contract to one library version. Core needs only plain data about machines (the recipe shape, the machine map, two events). Why not a direct dependency in each pipeline package: search, ingest and eval would each keep their own copy of the logging wrapper and failure handling, the copies would drift, and the rule "all logging goes through one factory" would have no home. Why one package that re-exports XState's few functions: one pinned version, one import path, one place for the template.

Dependency changes:
- `packages/pipeline/package.json` (new, name `@kg/pipeline`): dependencies `@kg/core: workspace:*`, `xstate: 5.33.2` (exact). Version note: the spike used 5.33.3, published 2026-10-17, which is under the repository's two-week rule for pins; 5.33.2 (2026-09-15) is the newest release old enough. The implementer confirms the spike's API subset (`setup`, `createActor`, `fromPromise`, `assign`, `toPromise`, `xstate/graph`) behaves identically and moves to 5.33.3 or later once it is two weeks old. A 6.0.0 alpha series is publishing; stay on 5.x.
- `@kg/search`, `@kg/ingest`, `@kg/eval`: add `@kg/pipeline: workspace:*`. No direct `xstate`.
- `@kg/app`: `@kg/pipeline`, and as a devDependency only `@statelyai/inspect` 0.7.2 (published 2026-06-14; peer `xstate ^5.5.1`; brings `ws`, `partysocket`, `superjson` and others, so it must stay out of the library packages).
- `@kg/viewer`, `@kg/mcp`, `@kg/api`, core, store and the rest: no change; none import XState.
- `@kg/testkit`: no XState (it imports core only today and keeps doing so). Machine-in-isolation helpers that need XState live in `@kg/pipeline` (`@kg/pipeline/testing`), imported only from package tests.

Dependency-cruiser changes (`.dependency-cruiser.cjs`). These are to be written by an implementer and each verified by adding a deliberately violating import and watching the run fail:
1. `star-rule`: add `^packages/pipeline/` to the allowed `to` paths for packages other than app and core (so `search`, `ingest`, `eval` may import it). Narrow it to those three with a dedicated rule (next item) so other packages cannot start importing it.
2. New `pipeline-kit-importers`: `from` any package other than `machine`, `search`, `ingest`, `eval`, `app`; `to` `^packages/pipeline/`; error.
3. New `pipeline-imports-core-only`: `from ^packages/pipeline/`, `to ^packages/` except itself and core; error (testkit allowed only under `^packages/pipeline/test/`).
4. New `xstate-only-in-pipeline`: `from` paths other than `^packages/pipeline/` (and `^packages/app/` for the inspector devDependency, listed separately), `to` `{ dependencyTypes: ['npm', 'npm-dev'], path: 'node_modules/(xstate|@xstate|@statelyai)/' }`; error. The exact `path` form for npm targets must be tested against dependency-cruiser 17.4.3 output; treat the pattern as a first draft.
5. `core-runtime-deps` already restricts core to zod and node builtins; unchanged and now also enforces "no xstate in core".
6. Docs: `architecture-proposal.md` states the star rule as design text. The amendment (a shared toolkit package that depends only on core) is approved; the edit to the design text is made together with the rule in wave 1.

The new `packages/pipeline` also needs a `CARD.md` in the same shape as the others.

---

## 6. Visualization

### 6.1 Generated diagram from the machine definition (primary, always on)

- **What is generated.** `machineMapOf(machine, id)` produces a `MachineMap`: plain JSON (defined in core, zod-checked) with nodes (`id`, `parent`, `kind`: work / routing / final, `label`, `logs`: event types it emits, `step`: module call name, `loop`: whether it is the target of a back edge) and edges (`from`, `to`, `event` as `done` / `error` / `always`, `guard` name). It is built from `toDirectedGraph(machine)` exported by XState's `xstate/graph` subpath (verified present in `xstate@5.33.3`: `toDirectedGraph`, `getStateNodes`, `getShortestPaths`, `getSimplePaths`, `createTestModel`), enriched with each state's `meta`. To verify in implementation: that edges for invoke `onDone`, `onError` and `always` all appear in `toDirectedGraph`'s edge list with usable labels; if any is missing the fallback is reading `machine.config` directly, which the spike's topology fingerprint already did successfully.
- **Mermaid.** `toMermaid(map)` (about 40 lines, no dependency) writes a `stateDiagram-v2` block. `@statelyai/graph` 2.6.0 can also turn an XState machine into a graph (`@statelyai/graph/xstate`: `createGraphFromMachine`) and export Mermaid state diagrams (`toMermaidState`), but `createGraphFromMachine` explores every reachable snapshot (a state-space graph, with context in node ids), not the static wiring, and it carries many optional peers; it is not adopted for the primary path.
- **Where it lands.** `pnpm machines:diagrams` writes `docs/machines/<machine>@<version>.mmd` and `.json` for every registered machine. A test regenerates them in memory and fails if the committed files differ, so a diagram can never be stale. GitHub and Obsidian (this repository is an Obsidian vault) render Mermaid code blocks, so the `.mmd` content is also embedded in each machine package's README between markers that the same script maintains.

### 6.2 Live developer inspector (secondary, opt-in)

- Package `@statelyai/inspect` 0.7.2. API as documented in its README: `createBrowserInspector()` (browser) or, for Node, `createInspectorServer()` from `@statelyai/inspect/server` plus `createWebSocketInspector({ url })`, and `createActor(machine, { inspect: inspector.inspect })`. `createWebSocketInspector` accepts `filter`, `serialize`, `sanitizeEvent`, `sanitizeContext`.
- Wiring: `runPipeline` takes an optional `inspect` observer (section 4.1). `app` builds one only when `KG_INSPECT=1`, and the observer is filtered so it never sends state values or context (only that an actor exists and which events it saw, if even that). Library packages never import it.
- Decided: the inspector is off by default and is never given state values or context. The Stately documentation does not say what the hosted UI at stately.ai does with the data, and that stays unknown, so the safe setting is the only setting.
- The inspector is for watching a run in development. It is not the record: finished sessions are reviewed from the event log (below), never from inspector data.

### 6.3 How a finished session maps back onto states (viewer)

Inputs: the session's events and the `MachineMap` named by `pipeline.started`.

- **Mapping events to states.** A `search.step` event maps to the node whose `id` equals `trace.state` (new field, section 8). An ingest event maps to the node whose `meta.logs` contains the event type; a document lane is chosen by `docKey`. Pipelines nest: an eval run contains searches (parent link via `parentId`, already in the log); each nested pipeline has its own `pipeline.started` and its own map.
- **Reconstructing the path.** The logged steps give the sequence of work states visited. Between two consecutive logged states, the unlogged routing states are filled by walking the map edges: for a routing state with several outgoing edges, the next logged state selects the edge. The map lint (section 10) guarantees this is unambiguous: every routing state's outgoing edges lead to different next work states.
- **What the overlay shows.** Visited nodes highlighted with a visit count (`retrieve x2`), traversed edges highlighted with the guard name that held, the loop's round count, the final state, and for a failed run the state recorded in `pipeline.finished` marked as the stop. Clicking a node opens that visit's `search.step` payload (considered, output, pools, query variants, details) which the viewer already renders. Un-visited nodes stay grey so a skipped branch is visible.
- **Live sessions.** The viewer already polls `after=<last seq>`; the overlay updates incrementally, and the current node is the last logged state's successor until `pipeline.finished` arrives.
- **Rendering.** Decided: the viewer vendors Mermaid. The viewer stays one static page that loads nothing from a CDN (local-first); a committed, version-pinned Mermaid bundle (older than two weeks, with its licence file) is served by the viewer server from its own origin. The page renders `toMermaid(map)` from `GET /api/machines/<machine>@<version>` and then marks visited nodes and traversed edges (classes on the rendered SVG; to verify in implementation: that node and edge identities survive Mermaid's rendering so the overlay can address them, with `classDef` and `linkStyle` as the fallback). No hand-written layout code.
- **Degradation.** An unknown machine or version, a log written before this change (no `pipeline.started`), or a missing `state` field falls back to today's flat timeline.
- **Why logging is the source of truth.** Everything shown comes from the event log plus the immutable map of a frozen machine version; nothing is read from live actors, so any old session can be redrawn.

---

## 7. Logging contract changes (summary; exact list in section 8)

- `search.step` trace gains `state` (the state id that ran the step) and keeps `stepType` (the module call) and `stepIndex` (execution counter, which now exceeds the number of states when a loop runs).
- Two new events, emitted only by `runPipeline`: `pipeline.started { pipeline, machine, version, topology, recipeId }` and `pipeline.finished { status: 'done' | 'failed', state, error? }`. `pipeline.started` is the first domain event after `query` (search) or after `tool.called` (ingest, eval); `pipeline.finished` is the last before `search.result` / the tool's return. Failed pipelines still produce `tool.failed` with the original code.
- Envelope rules: both events carry the same `buildId` / `searchId` tags as the pipeline's other events (search required, ingest and eval as today).

---

## 8. Exact change list

### 8.1 `core` (contract version 0.4.0 to 0.5.0)

1. `model.ts`: remove `SearchStepSpec` and the `{ steps }` form of `SearchRecipeSpec`; add `MachineRecipeSpec`, `SearchRecipeSpec = MachineRecipeSpec<'search'>`; add `MachineMap`, `MachineNode`, `MachineEdge` types; `DatabaseConfig.searchRecipe` type follows.
2. `schemas.ts`: replace the search-recipe schema with a strict `{ kind, version, spec: { machine, settings (object), topology (16 hex), promptDigest (optional, 64 hex) } }`; add `machineMapSchema`; `stepTraceSchema` adds required `state: string` (non-empty); `recipeSpecSchema` unchanged for other kinds.
3. `events.ts`: add `pipeline.started` and `pipeline.finished` payload schemas; add `searchRecipes` (optional record condition name to recipe id) to `eval.run.started`; mark both new events as allowed with or without `searchId`; update the catalog doc comment. `BUILD_REQUIRED` gains `pipeline.started` and `pipeline.finished` for search and eval (build-pinned pipelines); ingest runs before a build exists for the first ingest, so `buildId` is optional for ingest pipeline events. Settle the exact required/optional rule in the core change and test it (this is the one subtle envelope rule).
4. `ports/search.ts`: remove `StepFactory` (JsonObject parameter form); keep `SearchStep`, `StepEnv`, `Candidate` and the pool semantics (named pools from 0.3.0 stay; they are the only future-proofing the contract needs, see the appendix); add required `state` to `StepTrace`; remove the `done` flag and the runner-semantics text (skip once done, unrolled loops, "runner ignores done"); `seeds` stays reserved for graph walk. The port comment no longer describes `decompose`, `fuse` or `critique` steps.
5. `ports/ingest.ts`: doc comment rewritten to describe the ingest machine and its states; the interface (`IngestService`, `IngestRequest`, `IngestReport`) does not change; add a sentence that ingest has no resume.
6. `defaults.ts`: new `DEFAULT_SEARCH_RECIPE` (section 3.3); doc comment on the pinned topology literal.
7. `evalTool.ts` / `model.ts`: `EvalRunInput.searchRecipes?`; `EvalRunRecord.config` records it (no type change, `config` is a JSON object).
8. New `machineMap.ts` (types and `validateMachineMap`), exports in `index.ts`, `CONTRACT_VERSION` 0.5.0, `package.json` version, README section "Pipelines are machines".
9. `ids.ts`: no change to `recipeId`; update the header comment sentence about recipes ("the plan") to name machine recipes. `schema.sql`: no change (recipes table already stores the spec JSON); confirm in the core change; no snapshot or checkpoint tables are added.
10. Tests: `core.test.ts` golden ids; `testkit/golden/ids.json` and `oracle.py` regenerated for the new default search recipe; zod round-trip tests for the new events and `MachineMap`.

### 8.2 `pipeline` (new package)

`src/index.ts` (re-exports, `runPipeline`, `PipelineRun`, `PipelineIdentity`), `src/map.ts` (`machineMapOf`, `topologyOf`, `toMermaid`), `src/logged.ts` (`loggedActor`, `toKgError`), `src/pins.ts` (pin file read and check helpers), `src/testing.ts` (`@kg/pipeline/testing`: `drive`, `pathOf`, `withActors`, below), `scripts/diagrams.ts`, `README.md` ("how to write a machine here" with a template and the authoring checklist), `CARD.md`, `test/`. About 250 lines of source in total.

### 8.3 `testkit`

- `fakes/search.ts`: `ScriptedSearchService` and the static steps emit `pipeline.started` / `pipeline.finished` and set `state`.
- `fakes/llm.ts`: unchanged (`ScriptedLlm` already queues outputs).
- `harnesses.ts`: `miniSearchHarness` builds the default machine recipe; add `machineSearchHarness(recipe)`; `miniStepHarness` unchanged apart from typed parameters.
- `conformance/search.ts`: `searchServiceConformance` adds: event order (query, pipeline.started, steps, pipeline.finished, result), every step trace has `state`, `stepIndex` contiguous from 0, `pipeline.finished.state` is a final state, failed search emits `pipeline.finished` with `failed`; a case "a machine that does not log fails the suite". `searchStepConformance` unchanged except parameters become typed objects.
- `conformance/ingest.ts`: scenarios unchanged; add the bracket events, and a case that an ingest failing at a stage reports that stage in `pipeline.finished.state`.
- New `conformance/machine.ts`: `machineMapConformance(map)` (structure lint: exactly one initial, finals reachable, every non-final reachable and can reach a final, every routing state's outgoing edges lead to distinct next work states, guard names present on guarded edges, `logs` event types exist in the catalog, state ids unique) and `machineLogConformance(map, events)` (every logged step names an existing work state, consecutive steps connect through routing states, the run ends in a final state). Pure data checks on core types; no XState.
- `fixtures/log/*.jsonl`: regenerate with the new events and `state`; add a session with a failed ingest; update `fixtures/log/README.md`.
- `broken/index.ts`: add `SilentMachineSearch` (invokes a bare promise, no `search.step`), `WrongStateNameSearch` (logs a state that is not in the map), `EagerCommitIngest` stays.
- `minicorpus.ts`, `fixtures.ts`: recipes built through the new default.
- `test/meta.test.ts`, `test/fakes.test.ts`: the new broken variants must be caught by the matching suites.

### 8.4 Package cards (every `CARD.md`)

Every card touched also gets its sprint markers rewritten as descriptive text (a CI check in section 10 prevents regressions). Per card:
- `search`: implements `createSearch`, `SearchMachineRegistry`, the `similarity` machine and its settings type, typed step constructors (`vectorKnn`, `truncate`; both keep their behaviour), `stepActor`; tests: existing three suites plus `machineMapConformance` for `similarity`, path tests, pin test; forbidden: direct `xstate` import, bare `fromPromise` in machine files; open question: which machine comes after `similarity`.
- `ingest`: implements `createIngest` as `ingestMachine` plus `documentMachine`; behaviour list rewritten as states; scenarios unchanged; adds bracket events and failure-state tests; states plainly that there is no resume.
- `eval`: runner as `eval-run` / `eval-question`; prompts as `eval-generate` / `judge` machines with typed settings; `searchRecipes` option; summary labels recipes; tests: existing runner conformance plus machine map and path tests.
- `pipeline` (new): as above.
- `api`: handlers unchanged; card says why no machines (section 2 reason); `search` and `ingest` delegate to the machine-backed services; note on `pipeline.*` events being emitted below the handler.
- `mcp`: one sentence on why it stays an adapter; no code change.
- `parse`: one sentence on when `parse-escalate` becomes a machine; no code change.
- `parse-sidecar`, `store`, `eventlog`: contract version bump; one-line "stays a plain function because ..." entry copied from section 2; no code change. `store`: confirm no new tables.
- `chunk`: stays a plain function; card change is the marker clean-up only. No code change.
- `embed`: no code change; marker clean-up only.
- `viewer`: map endpoint, overlay, flat fallback, tests on fixture sessions; see 8.6.

### 8.5 `eval` (code)

Rewrite the runner and the prompt package as machines per 4.8 behind the same function signatures (`runEval`, `generateQuestions`, `judge`), so the existing `evalRunnerConformance` and metrics fixtures still pass unchanged; add `searchRecipes` handling and recipe labels in the summary; keep replay caching (`ReplayLlm`).

### 8.6 `viewer`

`createViewerServer(reader, o)` gains `o.machineMap?: (machine: string, version: string) => MachineMap | null` and `GET /api/machines/<machine>@<version>`; the page gains the overlay (6.3); `renderTimeline` keeps one text line per event and prefixes the state name for steps; tests: endpoint equality, overlay path reconstruction (pure function `overlayOf(map, events)` exported and unit-tested on the fixtures, including a failed run), fallback when no `pipeline.started`.

### 8.7 The hidden skeleton (read-only oracle)

The skeleton keeps its plain runner and linear ingest. It is not updated to machines. Its roles:
- Oracle for behaviour: an `app` test runs the skeleton and the machine services on the same fixtures with the same `FixedClock` and `SeqIds` and compares event logs after normalizing the intended differences (drop `pipeline.*`, drop `trace.state`, map recipe ids). `similarity` and `ingest` must match event for event; the eval machines have no skeleton counterpart and are checked by golden runs instead.
- Oracle for the 0.4.0 pointer fields (previous document version, revert flag): covered by the same comparison.
- One unavoidable skeleton edit: its `createSearch` reads `recipe.spec.steps`, which no longer exists in core. The minimal edit is a local `LegacyStepRecipe` type inside `skeleton/search.ts` and a legacy default recipe in the skeleton for the oracle test only. This touches a hidden file; the user has approved it (see Decided).

### 8.8 `app`

Wire `machine` registries into `createSearch` / `createIngest` / `runEval`; add `machines:diagrams` script, pin check at startup, optional inspector wiring behind `KG_INSPECT`; pass `machineMap` to the viewer; the oracle test (8.7).

---

## 9. The two earlier proposals

**"Repeat loop construct in recipe data": unnecessary, confirmed.** A loop is a cycle in a machine guarded by a counter in context, so there is no recipe data to extend. v0 has loop-shaped retries only in `judge` and `eval-generate` (a move back from parsing to calling while tries are left). The unrolled-loop rules go away: the "skip remaining steps once done" rule, the `final` marker on `truncate`, and the idea of a `searched` marker on query variants. `SearchState.done` has no remaining reader and is removed in 0.5.0. The merge-on-retrieve rule stays in the port (a second retrieval must not replace the first round's candidates); v0 never needs it, a future loop would.

**"fuse.from prefix pattern": unnecessary, confirmed.** The gap only appears when a model chooses how many sub-questions there are, and v0 has no such machine. If one is built later, the machine computes the pool names from the live query variants it holds (appendix), so nothing enters the contract.

---

## 10. Testing a machine in isolation, and keeping machines honest

A machine under test receives fakes through its input (`run.env` with `InMemoryCorpusStore`, `HashEmbedder`, `ScriptedLlm`, `FixedClock`, `SeqIds`) or has actors replaced with `machine.provide({ actors: {...} })` (present in `xstate@5.33.3` `.d.ts`; `createMachine` options are marked deprecated in favour of `setup` / `provide`).

Test layers, cheapest first:
1. **Map lint.** `machineMapConformance(machineMapOf(machine))` for every machine. Pure data, runs in milliseconds.
2. **Pin test.** Recomputed topology and prompt digest equal `pins.json`; `DEFAULT_SEARCH_RECIPE.spec.topology` equals `similarity` topology; diagrams regenerate to the committed files.
3. **Path tests with stubbed actors** (`@kg/pipeline/testing`): `withActors(machine, { generate: scripted([...outputs]) })`; `drive(machine, input)` runs to a final state and returns `{ output, visited: string[], events }`; assertions on `visited`, e.g. "`judge` given two malformed outputs then a valid one with a retry budget of 2: calling, parsing, calling, parsing, calling, parsing, done". Also one test per guard direction and per failure edge (actor throws a `KgError`: ends in `failed` with that code).
4. **Service conformance.** Existing and extended suites run the machine through the real service with fakes and check the log: shipped as `searchServiceConformance`, `searchFixtureSuite`, `ingestScenarios`, `evalRunnerConformance`.
5. **Log-versus-map check.** `machineLogConformance(map, events)` on every produced log.
6. **Golden run per machine.** One scripted run per machine whose event-log hash is committed. This is the only thing that catches a guard body or step implementation change that keeps the topology, and it is required, not optional (the spike demonstrated the `<` versus `<=` blind spot).
7. **Lints in `app/test/architecture.test.ts`:** no `fromPromise` in files under `machines/`; no `ctx.emit('search.step'` outside `stepActor`; no `xstate` import outside `@kg/pipeline`; and a marker check: a regular expression over cards, READMEs and `src` comments rejecting sprint-marker codes (one or two capital letters, an optional hyphen and a number or short id, with letter-suffixed variants), with scratch notes and the hidden skeleton excluded.
8. **Nesting.** One test through the real `createKgApi` / `runTool` that a step calling `api.getItems` inside a running machine still links to the search's `tool.called` (the spike showed context is inherited from whoever starts the actor; never keep a long-lived actor across tool calls; `runPipeline` creates and finishes the actor inside the handler).

Friction from the spike that the template must address, because a cheap model will hit it: generic helper typing needed casts (use explicit per-machine configs and the `stepActor` factory with real generics, not a clever config builder), events in `assign` are untyped without per-state typing (use `assertEvent` or read `event.output`), a self-looping `always` re-evaluates (route states only point forward or into a work state), child snapshots are invisible to the parent's subscription (irrelevant now that nothing is persisted, but relevant to the inspector wiring), and a stopped actor looks finished (handled in `runPipeline`).

---

## 11. Work breakdown for cheap-model implementers

Models: Haiku for mechanical edits with a precise card and a suite to pass; Sonnet for anything that designs types or machines and for every review. Never Opus. The lead is the lead session: it coordinates and checks the gates. Reviewers are Sonnet agents. Each task states the suite that defines done.

**Wave 0: prerequisites (lead session, before any code).** Write the machine-authoring checklist; confirm in a half-day check that `toDirectedGraph` yields edges for `onDone`, `onError` and `always`, and that `xstate` 5.33.2 behaves like the spike's 5.33.3 for the API subset used. Decisions are recorded in Decided.

**Wave 1: contract (serial, one Sonnet agent, Sonnet reviewer).** Core changes 8.1, regenerated golden vectors, README. Gate: core tests and typecheck pass, `pnpm depcruise` passes, every other package typechecks against 0.5.0 (they will fail on removed types; the failures are the to-do list for wave 2).

**Wave 2: foundations (parallel, after wave 1).**
- A. `machine` package (Sonnet): kit, map, mermaid, topology, pins, testing helpers, template, CARD. Needs core only.
- B. `testkit` updates (Sonnet for conformance/machine.ts and the fixtures; Haiku for fake and broken-variant edits, fixture regeneration). Needs core only; its suites are checked by the meta test against the broken variants.
- C. Dependency-cruiser rules (Haiku, with the violating-import checks), architecture lint (Haiku), pnpm workspace entry.
Gate: kit tests pass; `machineMapConformance` runs on a toy machine; depcruise rules each demonstrably fail on a violating file.

**Wave 3: pipelines (parallel, each needs A and B).**
- D. `search`: Haiku ports the two existing steps to typed constructors and writes `truncate` / `vector-knn` tests; Sonnet writes the kit and `similarity` (gate: the three existing suites pass and the log equals the skeleton's).
- E. `ingest` (Sonnet): document machine, run machine, bracket events. Gate: `ingestScenarios` unchanged and passing; log equals skeleton's.
- F. `eval` runner (Sonnet) and `eval` prompts (Sonnet for prompts and the two machines, Haiku for parsers; a Sonnet reviewer checks the prompts). Gate: `evalRunnerConformance`, expected-metrics fixtures.
- G. `viewer` (Sonnet for overlay and the Mermaid vendoring, Haiku for endpoint and tests). Needs only fixtures (B) and the `MachineMap` type (wave 1), so it can start as soon as B has the fixtures.
- H. Cards for packages without code changes (Haiku): section 2 reasons, version line, marker clean-up. Any time after wave 1.

**Wave 4: integration (serial, Sonnet plus Sonnet review).** `app` wiring, skeleton oracle test, golden runs per machine, diagram generation and staleness test, optional inspector, end-to-end run on the real corpus as in the sprint brief, cross-package review for duplicated toolkit logic and log gaps.

Parallelism summary: wave 1 serial; A, B, C parallel; D, E, F, G, H parallel; wave 4 serial. Estimated sizes: `pipeline` about 250 source lines; `search` about 100; `ingest` about 300 (the spike's 245 minus persistence plus branch states); eval machines about 300; viewer overlay about 150.

Instructions every implementer prompt must carry: read `.claude/skills/xstate/SKILL.md`; use `setup()` and typed actors; never `createMachine` without `setup`; no direct `xstate` import; no sprint markers anywhere; do not edit design files or the skeleton.

---

## 12. Risks, and what the plan deliberately leaves open

**Risks.**
1. *Authoring burden.* Cheap models writing machines will hit typing friction (spike: 3 casts in search, 9 in ingest). Mitigation: the kit's typed factories, a copy-and-edit template, the map lint and path tests as fast feedback, Sonnet for new machines, review by the lead.
2. *Logging can be forgotten.* The compiler does not enforce it. Mitigation: one factory, a lint forbidding bare `fromPromise` in machine files, `SilentMachineSearch` in the broken variants, and the conformance case. This is weaker than the runner design where logging was structurally unforgettable, and the plan accepts that.
3. *State name drift.* `at: 'retrieve'` in an invoke input can disagree with the state key. Mitigation: `machineLogConformance` and a lint test that compares each work state's `at` with its key (read from the map).
4. *Identity blind spots.* Guard bodies, step implementations and the toolkit do not enter the topology (prompt text does enter the recipe id). Mitigation: version rule, golden runs. A change of the kit itself (for example how failures are rethrown) is covered only by the conformance suites.
5. *Frozen old versions accumulate.* Each behaviour change leaves an old machine in the registry for as long as builds may point at it. Mitigation: deliberate deletion and the explicit-recipe override; revisit when there are more than a handful.
6. *Contract churn.* 0.5.0 removes types the cards, fixtures and the skeleton use, and changes every default id and build id once. Mitigation: the removal list is explicit in 8.1; wave 1 is serial and gated.
7. *`toDirectedGraph` coverage* of invoke and `always` edges is unverified; the fallback (reading `machine.config`) is known to work from the spike but is more code.
8. *XState version.* The latest 5.x is one day old (under the two-week pin rule) and a 6.0 alpha series is publishing; the plan pins 5.33.2 and defers any 6.x move.
9. *Inspector data handling is unknown* (docs silent), hence off by default and never given state values or context (decided).
10. *Async context.* Long-lived actors lose the parent-call link; the rule "one actor per tool call, finished inside the handler" must be kept. The inspector wiring must not keep actors alive.
11. *Vendored Mermaid.* A large static file in the viewer package, and the overlay depends on addressing rendered nodes and edges (to verify). Accepted by decision.
12. *Cost of dropping persistence.* A crashed ingest repeats its work. The spike measured the value as bounded (parse is already stored the moment it exists and cached by sha256). Embedding the in-flight batch is redone. Accepted by decision.

**Deliberately left open.**
- The exact `pipeline.*` envelope rule for ingest before a first build exists (settled in the core change, tested there).
- The graph-walk and summary machines (shape unknown until Phase 4+); they follow the template.
- Whether `api` handlers ever become machines (only if they gain loops or retries).
- Parse escalation as a `parse-escalate` machine (future).
- Whether eval conditions should become a structured type instead of open strings (this plan only adds the optional recipe map).
- Cross-process or remote execution of machines (not needed; would revisit the context-holds-live-services choice).

**Needs the user.** Nothing is open; everything is in Decided.

## 13. Formula handling in v0

Decided: v0 decodes display formulas with GLM-OCR (4-bit, MLX, one model, one pass, docling's default crop margin) for any database whose corpus has formulas. Multi-model voting and multi-crop comparison are future work. Decoding is a setting of the parse recipe, not an always-on step.

**Principle: views are derived from docling's block structure, never from markup we add to text.** The parse artifact already holds the whole document tree (block labels, text, pages, boxes), and the chunker already works from it; only the `chunk` package reads that structure (the existing rule). Decoding therefore just fills in the `text` of the `formula` blocks of a new artifact. Nothing is inserted into any text, so there are no delimiters, no spans to store and nothing to sniff back out.

**Pieces.**
- *Decoding stage* (parse sidecar, Python + MLX): reads the artifact and the source PDF, crops each `formula` block from its page and bounding box, decodes it, and writes a new artifact. The new parse recipe records the decoder model and revision, the prompt, and the crop margin, so it is a new recipe and new chunk ids by the usual rule. Inline formulas are not blocks (docling leaves them as glyph names inside text) and stay out of scope.
- *Ingest machine*: a conditional "decode formulas" state between parse and chunk, taken when the database's parse recipe asks for it. Needs the source PDF at that point.
- *Chunk text* is the full text, with decoded LaTeX where a formula block was decoded and the placeholder `[formula]` where not. This is what readers and free extraction later see.
- *Embedding view*: a `formulaView` setting on the embedding space spec, `placeholder` (default) or `full`. The `chunk` package provides one function that renders a chunk's blocks (found through the block refs recorded for the document version) under a view, using the same joining rules as chunking, so `full` equals the stored chunk text by construction. Ingest's embed state calls it, so the embedder never sees docling structure. A different view is a different space (the space id hashes the whole spec), and re-embedding under another view needs the parse artifact, which the artifact cache keeps.
- *Chunk boundaries*: the chunker should measure a formula block at placeholder length when packing, so boundaries do not move between decoded and undecoded parses (the pilot saw 312 chunks become 440 when LaTeX counted). Chunk ids still change where text changed. Recommended; the chunk implementer verifies it against the packing rules and the length limits.

**Why this is cheap.** All structure access stays inside `chunk`; core gains one field on the space spec and one on the parse recipe; the embed package is unchanged.

**Open, small.** Whether readers should also get a rendering with formulas marked (an extra view of the same function); not needed for v0.


---

## Appendix: Future machines (not built in v0)

Decided: v0 search has exactly one machine, `similarity`. The two sketches below are not work items; they exist to show that adding such machines needs no change to the contract. They would call a model inside retrieval, which is why they are out of v0.

- `decompose-fuse`: split (model call adds sub-question variants) -> retrieve per variant into pools named after the variant -> fuse (rank-merge over those pools; the machine computes the pool names from the variants it holds) -> cut.
- `critique-loop`: retrieve -> review (routing: rounds left?) -> critique (model call) -> verdict (routing: satisfied?) -> back to retrieve, or cut. The loop is the move back; the round counter lives in the machine context; a later retrieval merges into earlier candidates (the existing port rule) and can be restricted to variants not yet searched by a step setting.

Why the contract needs no change: the 0.5.0 recipe shape already holds any machine name with its own typed settings and topology pin; `search.step` traces already carry the `state` that ran them; `pipeline.started` and `pipeline.finished` are not specific to any machine; and the named pools introduced in contract 0.3.0 already let one step write a candidate list that another step reads. **Named pools from contract 0.3.0 stay; they are the only future-proofing the contract needs, and nothing else (no `only` option, no done flag, no repeat construct, no pool-name pattern) is added for them.** Adding such a machine later means new machine code, a registry entry, a settings schema and a pin, plus a change to core defaults only if it becomes the default.

---

## Sources


Spike results and code: `scratch/sprint-1/spike-state-machine/` (`results.md`, `src/machines.ts`, `src/ingest-machine.ts`, `src/service.ts`). Earlier pipeline spike: `scratch/sprint-0/pipeline-recipes.md`. Lifecycle and invariants: `scratch/sprint-1/lifecycle.md`. Core ports and events: `packages/core/src/ports/search.ts`, `ports/ingest.ts`, `events.ts`, `defaults.ts`, `model.ts`, `conditioning.ts`, `runTool.ts`. Skeleton: `packages/app/src/skeleton/search.ts`, `ingest.ts`, `viewer.ts`. Cards: `packages/*/CARD.md`. Tools checked against the registry and package contents on 2026-10-18: `xstate` 5.33.3 and 5.33.2, `@statelyai/inspect` 0.7.2, `@xstate/graph` 3.0.4 (standalone package; the same graph API ships inside `xstate` as the `xstate/graph` subpath), `@statelyai/graph` 2.6.0, `@xstate/test` 0.5.1 (peer `xstate ^4`, therefore not usable with v5 and not adopted). Two earlier proposals that this plan retires, cited for traceability only: the repeat construct in recipe data and the `fuse.from` prefix pattern (section 9), plus the ingest resume storage, which the no-persistence decision drops.
