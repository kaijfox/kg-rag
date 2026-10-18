/**
 * Shared toolkit for building and running pipelines. Every pipeline in the system is a hand-written state machine;
 * this package is the only place that imports the state-machine library, so pipeline packages import it from here.
 *
 * It holds: the library re-exports pipelines need, a runner that brackets a run with the start and finish events,
 * a work-state actor that normalizes failures, and extraction of a machine's plain-data drawing (map, diagram,
 * topology fingerprint). It holds no pipeline and knows nothing about search, ingest or evaluation.
 */
export { setup, assign, createActor, fromPromise, toPromise, and, or, not, assertEvent } from 'xstate';
export type { ActorRefFrom, SnapshotFrom, EventFrom, AnyStateMachine } from 'xstate';
export { loggedActor, declaredLogsOf, toKgError } from './actors';
export { runPipeline } from './run';
export type { PipelineIdentity, PipelineRun, PipelineKind } from './run';
export { machineMapOf, topologyOf, toMermaid } from './map';
