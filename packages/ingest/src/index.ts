/**
 * @kg/ingest: the ingest service. A request runs through two state machines (ingest, one document child per entry);
 * every parse, chunk and embed call is injected through IngestDeps. See README.md for the decisions.
 */
export { createIngest } from './service';
export type { IngestDeps, FormulaDecoder, Vector } from './deps';
export { ingestMachine } from './machines/ingest';
export { documentMachine } from './machines/document';
