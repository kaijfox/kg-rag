# Spike results: explicit state machines (XState v5) for search and ingest

Run 2026-10-18. Code and tests: this directory (`src/`, `test/`; run `../../../node_modules/.bin/vitest run` from here; 95 tests, all passing; `tsc` is clean for `src/`, the test files are only run, not typechecked). Nothing outside this directory, `scratch/notes/spike-state-machine.md` and the append-only entries in design-feedback, decision-log, open-questions and contract-proposals was touched.

## Verdicts (against the rule set in `spike-state-machine.md`)

| | Rule | Result | Verdict |
|---|---|---|---|
| **Search** | adopt only if all four hold | 1 logging/nesting: holds. 2 identity at least as strong: holds only after adding a topology pin the machine design did not have by itself. 3 adding a step about the same cost: roughly (step file identical; machine design adds a 4-line machine definition and a recipe family, and any change to a pipeline's shape becomes a code change plus version bump instead of a data edit). 4 definition shorter or clearly easier to read than runner plus unrolled loop: **fails** (104 lines of machine code vs 15 for the runner; 22 for a runner extended with a real loop). | **Keep the current design**, plus one small modification: a `repeat` construct in recipe data (22-line runner) instead of the unrolled loop and the `done`-skip rule. Contract proposal CP-SM-1. |
| **Ingest** | adopt if resumable per-document stages work with persisted snapshots and the event catalog is unchanged | Both hold, measured with two crash sweeps (below). Conditions: needs two small storage additions (vector checkpoint, snapshot store), events become at-least-once across a crash, +99 lines (+68%). | **The rule is met: adopt, in modified form** (conditions listed in section 5). The value in v0 is bounded (parse is already durable and cached); the decision to pay for it is the user's. See "Needs the user". |

"Keep the current design" is a legitimate result for search and it is what the numbers say.

## Setup and honesty notes

- Libraries, versions from the registry (`npm view`), APIs checked against the installed `.d.ts` and the Stately docs (persistence page: restore with `createActor(machine, {snapshot})`, invoked promises restart on restore, entry actions do not re-run): `xstate@5.33.3` (MIT, modified 2026-10-17, zero runtime dependencies), `robot3@1.4.0` (BSD-2). Both installed only in this directory (`node_modules` 2.6 MB, not committed; `.gitignore` added). Nothing added to `core` or any package.
- Baseline moved during the spike: the task said `@kg/core` 0.3.0; by the time I ran, core and the skeleton were at **0.4.0** (R-34: `ingest.completed.previousDocVersionId`, `build.created.revert`, `putDocVersion` `immutable_violation`). I re-read the skeleton ingest and implemented the 0.4.0 events; the shipped conformance suites report `[contract 0.4.0]`. Everything below is against 0.4.0.
- Acceptance checks: the shipped suites run unchanged against my services: `searchServiceConformance`, `searchFixtureSuite`, `searchStepConformance` (incl. the P-1 `into` case, for my `vector-knn` which implements `into`; the skeleton's does not), and `ingestScenarios` (I-1..I-10). Plus event-for-event equality with the skeleton (same `FixedClock`/`SeqIds`).
- Limits: LLM is a scripted queue (no Ollama), embedder is `HashEmbedder`, store is the in-memory fake. A "crash" is a hard stop of the actor plus a dead-process flag (no emits, no checkpoint writes after it); a restart is a new service over the same store, parser, embedder and log. No SQLite and no real process kill. I did not run a cheap model against the machine code; learning burden is argued from the concept list and from the friction I hit.

## 1. Search as a machine

The three pipelines, as machines with settings as data (`src/machines.ts`, steps unchanged plain functions from `src/steps.ts`, invoked through one actor):

```ts
'knn-truncate':   retrieve -> cut -> done
'decompose-fuse': split -> retrieve(into 'sub:{queryId}') -> fuse(from = live query ids) -> cut -> done
'critique-loop':  retrieve -> review --budget--> critique -> verdict --satisfied--> cut ; else -> retrieve
```
```ts
// the loop, with its guard (the whole machine is 16 code lines)
retrieve: stage(vectorKnn, { pool, kinds: ['chunk'] }, 'review'),
review:   route({ guard: 'budget', target: 'critique' }, { target: 'cut' }),
critique: stage(critique, { model, maxNewQueries }, 'verdict', (c) => ({ round: c.round + 1 })),
verdict:  route({ guard: 'satisfied', target: 'cut' }, { target: 'retrieve' }),
cut:      stage(truncate, {}, 'done'), done: { type: 'final' },
```
Results (all tests, `test/search.test.ts`):
- `knn-truncate` produces an event log **identical** to the skeleton runner's (modulo the recipe id).
- Decomposition: runner (steps list, P-1 pools) and machine give identical results and identical per-step traces (considered, output, pools).
- Critique loop: runner with the loop **unrolled** (N=2: `knn, critique, knn, critique, knn, truncate`, needing the `done` skip plus a `final` marker, i.e. P-2a, which is not in the contract) and the machine give identical steps and results, both when never satisfied (6 steps) and when satisfied at round 1 (3 steps). The machine needs no skip rule and no `final` marker: `done` just takes the exit transition.
- **Contract gap found (affects the current design, not just machines):** the documented `fuse` takes a static `from: [...]` list and a missing pool is `invalid_input`. With decomposition the number of sub-questions is decided by the LLM, so a recipe written for 3 pools fails when the model returns 2 (`fuse: no pool sub:q2`, test "GAP"). The machine avoids it by computing `from` from the live query variants. Without machines the fix is contract text (CP-SM-2).
- The generic runner must also exist as a machine (`pipelineExecutor`, 16 lines) so `{steps}` recipes of existing builds keep working; all shipped service/fixture suites pass on it too.

## 2. Logging and nesting

Every `search.step` field (stepIndex, stepType, params, considered, output, queries, pools, durationMs, plus envelope searchId and buildId) is emitted from the machine; full event logs equal the runner's for decomposition and for the loop.

Where logging lives:
- Runner: in the loop (`emitStep` after each `step.run`). Cannot be forgotten by a step author, and a pipeline author has no choice.
- Machine: in the single `runStep` actor that every `stage()` uses (`machines.ts`, one line). A machine author who invokes a bare promise instead skips logging; that is **caught** by `searchServiceConformance` (test "a machine that forgets the logging actor"), but not by the compiler. So the runner design is structurally harder to forget; the machine design is one rule plus a test. (An `inspect` observer could log from outside the machine; I did not build it.)

`AsyncLocalStorage` nesting (R-27), tested through the real `createKgApi`/`runTool` with a step that calls `api.getItems` across a timer:
- Actor started inside the tool handler: every nested call links to the search's `tool.called` (after each actor transition and a 5 ms timer). Three concurrent searches in one session each keep their own parent.
- **Context is not lost through the scheduler; it is inherited from whoever causes the transition.** An actor started outside any handler and fed an event from outside sees `undefined` for its whole remaining run (test "context is inherited..."). Inside the handler every later hop still sees it, because XState registers its promise callbacks in the context that started the work. Consequence: never keep a long-lived actor or actor system across tool calls, and a resumed ingest runs under the resuming call's context (fine, that is what we want). No loss in the design as built here.
- Errors: a `KgError` thrown by a step keeps its code through the actor and `runTool` records `tool.failed` with it.

## 3. Recipe identity

Recipe = `{kind:'search', version: 'critique-loop/1', spec:{machine, settings, topology}}`, hashed by core's `recipeId` unchanged (it hashes any `RecipeSpec`).
- Stable: same id across two processes (`rc_cl5b4jyepoqikbsrn75i` for `critique-loop` with `{model:'m', maxRounds:2}`), key order irrelevant (canonical JSON).
- Changing a setting, the version string, or the machine name changes the id (tests).
- `topology` = hash of `machine.config` with functions replaced by `fn`, where each stage records its step name and static params in `meta` and guards are named (16 hex chars; `c30035c000d5c0ad` for `critique-loop`). The executor refuses a recipe whose topology no longer matches the code (test: a "simplified" machine under the same version is rejected with `no longer has the topology`).
- **Not caught by the fingerprint:** a guard body changed from `<` to `<=` (same topology, same id). Only a golden run catches it (event-log hash 85d829a9901a vs 9513ae2d3998 in the test). The runner design has the same blind spot for a *step implementation* change (test shows recipe id unchanged, result changed), and also for runner semantics. So: at least as strong as today **only with** the topology pin, and with one more unhashed code surface (guards and routing). Mitigation for both designs: a golden-run test per recipe family in CI plus the shipped conformance suites.

## 4. Modularity: add a reranker

| | Runner | Machine |
|---|---|---|
| New step file `rerank` (14 code lines) | same | same |
| Registration | 1 line in the step map | the machine definition itself is the registration |
| Pipeline | data: one more `{type:'rerank'}` entry in a recipe, **no code, no version** | code: a 4-line machine definition (below) or an edit of an existing machine plus a version bump, which invalidates old recipes' topology |
| Files touched | 2 (+ recipe data) | 2 (+ recipe data) |
| Lines touched | about 15 | about 18 |

```ts
const def: MachineDef = { version: 'knn-rerank-truncate/1', build: (s, run) => {
  const { stage, make } = define(run, {});
  return make({ retrieve: stage(vectorKnn, {pool:50,kinds:['chunk']}, 'rerank'), rerank: stage(rerank, {weight:0.05}, 'cut'), cut: stage(truncate, {}, 'done'), done: {type:'final'} }, 'retrieve');
} };
```
Both give identical results (test). A step implementer needs to know nothing about XState (steps are unchanged), so a cheap model implementing a step from its card is unaffected. The cost lands on whoever writes pipelines, and it is the loss of "a recipe can reorder steps without code changes" for every shape that is not already a machine.

## 5. Ingest as per-document actors

`src/ingest-machine.ts`: run machine `preparing -> nextDoc -> document(child machine: identifying -> resolving -> chunking -> embedding) -> extras (S2) -> gate (R-24 guard) -> planning -> committing -> announcing -> done | failed`. Same events, same single store transaction as the skeleton.

- **Events unchanged:** the event log of three ingests (v1, v2, back to v1 = revert) is **identical** to the skeleton's, including the 0.4.0 `previousDocVersionId` and `revert` fields. `ingestScenarios` passes with persistence on (I-1..I-10, incl. embedder failure and the space-switch S2 case); I-11 (duplicate docKey) and an R-24 test pass too.
- **Snapshots are JSON:** 39 snapshots for a two-document ingest, largest 1,978 bytes. They hold ids, counts, and stage names only. Vectors never go into a snapshot (17 chunks x 4096 floats would be about 700 KB of JSON for the mini corpus alone); chunk text is recomputed by the pure chunker from the stored artifact.
- **Resume, measured with two crash sweeps** (killing after every persisted snapshot: 39 crash points; and right after every emitted event, before that stage was persisted: 11 points). After each crash a fresh service resumed the same request (auto-detected by request hash, no API change): the final build id, current document versions and chunk lists equal the uninterrupted run in **all 50** cases; **no event is ever lost**. Costs of a crash: events are **at-least-once** (sweep A: 6 duplicate `ingest.chunked`; sweep B: 16 duplicates across `started/parsed/chunked/embedded/completed/build.created`, from the window between emitting and persisting the stage), and the embedding batch that was in flight is redone (at most 9 texts, one document). Completed documents' vectors are not recomputed.
- **R-24 as a guard:** yes, `gate` is a guard (`embeddedForBuild`) that every item the build would hold has a vector in the store or the checkpoint; with the extras stage disabled the run stops at the gate with `precondition` before any write (test). It duplicates, and does not replace, the store's own `putBuild` S2 check.
- Things the design had to add or hit (each is a cost or a risk):
  1. **A vector checkpoint** (embedded-but-uncommitted vectors) separate from the store: `putEmbeddings` needs the items to exist, items arrive only in the commit transaction (I-7: a failed ingest leaves no doc version). Needs a store/ingest-owned side table or files (CP-SM-3).
  2. **A snapshot store.** A mutable row would break S-1 ("only two mutable rows"); an insert-only `ingest_snapshots` (run key, seq, JSON; latest wins) or files outside the database fits.
  3. **`build.created.revert` is wrong after a post-commit resume** unless the build is planned before the transaction: re-running the commit finds the build "already existing". I added a `planning` stage that computes `{id, existed}` and persists it before `committing`. Found by the sweep; the first version failed it.
  4. **Parent subscriptions do not see child transitions.** `actor.subscribe` on the run machine fired 5 times per run and would have persisted only "document started"; persisting per stage needs `inspect` (39 snapshots). A natural mistake.
  5. `toPromise` resolves (does not reject) on `actor.stop()`; a stopped actor must be detected explicitly.
  6. The pointer-order and "reads then one transaction" structure stays; the machine does not make it easier, only resumable.
- Size: 245 code lines vs the skeleton's 146 (+99, +68%); about 55 of the 245 are persistence, checkpoint, crash hooks and the driver, the rest is the same logic split into actors.

### Modified form to adopt (if adopted)
XState only inside the `ingest` package (not core, not search); resume by request hash; snapshots in an insert-only table or files; a vector checkpoint; planning stage before commit; consumers (viewer, eval) treat ingest events as at-least-once during a resumed run.

## 6. Size and cost

| | Code lines | Notes |
|---|---|---|
| Skeleton `search.ts` (runner + 2 steps + service) | 108 | |
| Shared in this spike: `service.ts` (prelude/epilogue) / `steps.ts` (6 steps incl. pools, fuse, decompose, critique, rerank) | 38 / 122 | same in both designs |
| **Runner pipeline execution** (with `done` skip) | **15** | `runner.ts` |
| Runner + `repeat` loop (A+, recommended) | 22 | `runner-loop.ts`; loop is recipe data |
| **Machine design, search** | **104** | kit 36, three machines 39 (6 / 13 / 16), identity and executor 13, generic pipeline-as-machine 16 |
| robot3, critique loop only | 29 | no persistence, no children |
| Skeleton `ingest.ts` / machine ingest | 146 / 245 | |

Recipe size for the critique loop with N=2: unrolled 6 step objects; A+ 3 (`knn`, `repeat{critique, knn}`, `truncate`); machine 1 object. Unrolled grows 2 per round.

Dependency size: xstate 5.33.3 has **0 runtime dependencies**; the imports used here (`setup, createActor, fromPromise, assign, toPromise`) bundle to **40.0 KB minified / 13.1 KB gzip** (esbuild); on disk the package is 2.6 MB (multiple builds and maps). robot3: 2.9 KB min / 1.2 KB gzip. For scale, `zod` already in core is 5.7 MB on disk.

Learning burden (a cheap model implementing a step from its card): **none**, steps are plain functions. For a pipeline/ingest author: `setup`, typed context/input/output, invoke with `input` and `onDone`, `assign`, `always`, named guards, `createActor`/`toPromise`, snapshot restore semantics (invocations restart, entry actions do not), and `inspect`. Friction I hit: generic helper typing needed 3 casts in `machines.ts` and 9 in `ingest-machine.ts` (versus 1 each in the runner files), events in `assign` are untyped without per-state typing, guards must be named to be fingerprintable, a self-looping `always` re-evaluates, child snapshots are invisible to the parent's subscription, and a stopped actor looks like a finished one.

### robot3 (lighter library)
Fits the critique loop in 29 lines (`invoke`, `guard`, `immediate`, `reduce`) with identical event logs to the XState machine (tests). It has no snapshot/restore API and no child actors, so it cannot carry the ingest case (resume would be hand-rolled: re-create the machine with the saved state name and context; I did not test that). If a machine were wanted only for search, robot3 is the cheaper dependency, but search is exactly where the verdict is "no machine".

## 7. Contract proposals (appended to `scratch/sprint-1/contract-proposals.md`, none applied)
- **CP-SM-1** `repeat` construct (data) for bounded loops; replaces P-2a (done skip + `final`) and P-2c.
- **CP-SM-2** `fuse.from` accepts a prefix pattern (e.g. `sub:*`) or `optional` names, so decomposition with a model-chosen number of sub-questions is expressible.
- **CP-SM-3** (only if ingest resume is adopted) vector checkpoint and insert-only snapshot storage for ingest; ingest events documented as at-least-once across a resume.

## Reproduce
`cd scratch/sprint-1/spike-state-machine && ../../../node_modules/.bin/vitest run` (95 tests). `./count.sh src/*.ts` for the line counts above.
