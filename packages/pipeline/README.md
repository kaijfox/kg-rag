# @kg/pipeline

The shared toolkit for building and running pipelines. Every pipeline (search, ingest, evaluation) is a hand-written
state machine in its own package; this package holds what they share and is the only place that imports XState.
It holds no pipeline and knows nothing about search, ingest or evaluation.

## What is in it

- **Library re-exports** (`setup`, `assign`, `createActor`, `fromPromise`, `toPromise`, guards, types): pipeline
  packages import these from here, never from `xstate`.
- **`loggedActor(logs, fn)`**: the way a machine file creates a work actor. A thrown value reaches the machine as a
  `KgError` (anything that is not one becomes `internal`). `declaredLogsOf(actor)` returns the event types it declared.
  A machine's `onError` keeps the error with `assign({ error: ({ event }) => toKgError(event.error) })`.
- **`runPipeline(machine, input, { run, identity })`**: emits `pipeline.started`, runs the machine to a final state, emits
  `pipeline.finished`. A machine ends in `done` (its output is returned) or `failed` (the error kept in context under
  `error` is rethrown after `pipeline.finished`, whose `state` is then the last work state entered before `failed`, so
  the log names where the run stopped). The actor lives and ends inside the call, so the logging context of the
  surrounding tool call is inherited.
- **`machineMapOf`, `toMermaid`, `topologyOf`**: the plain-data drawing of a machine (states, moves, loops), a diagram
  generated from it, and the 16-hex fingerprint that goes into a recipe. They read `machine.config`; functions count as a
  marker, so a changed guard body or step implementation is not seen (a version bump and a golden run cover that).
- **`@kg/pipeline/testing`**: `withActors` (replace actors), `scripted` (an actor returning given outputs or throwing
  given errors), `drive` (run to a final state and report every state passed through, routing states included).

## Conventions for a machine

- Build it with `setup()` and typed context, input, output and events.
- A state that does work invokes a `loggedActor`; a routing state only has `always` moves and `meta: { routing: true }`.
- `meta.logs` names the event types a work state emits (space separated) and `meta.step` the module call it makes.
- Two final states: `done` and `failed` (give `failed` the id `failed` so any state can target `#failed`).
- Routing states point forward or into a work state, never at themselves.

## What `topologyOf` sees

It hashes the wiring in `machine.config`, so these change it: the machine id, state names, invoke `src` names, `onDone` /
`onError` targets, `always` and `on` / `after` targets, guard names, named entry actions and `meta` (`label`, `step`,
`logs`, `routing`). A cosmetic edit of `meta.label` therefore changes the topology, and with it the recipe id and every
build id derived from it.

These do not change it (a version bump and a golden run cover them):
- `input` functions of an invoke: step parameters, and the `at` name a step logs under;
- guard bodies (only the guard name is read);
- actor implementations: swapping the step an actor calls (for example another step constructor behind the same actor
  name) is invisible;
- the initial context.

## Known gaps

- The map reads `machine.config` for invoke `onDone` / `onError` and `always` moves only; a machine that uses `on`
  events is not drawn (none exists in v0).
- The inspector hook is a plain callback; wiring the Stately inspector belongs to `app`.
