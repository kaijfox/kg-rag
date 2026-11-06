/**
 * @kg/kernel: the fixed foundation. IDs; the index, history and cache stores; modules and state machines with their
 * load-time check; the runner; the model and embedding interfaces; and `Kg`, which opens a database directory.
 * Imports nothing in packages/.
 */
export * from './errors';
export * from './ids';
export * from './types';
export * from './sqlite';
export { IndexStore, type IndexReader } from './indexStore';
export { HistoryStore, type EventRow, type SessionRow, type Correction, type EvalResultRow } from './historyStore';
export { CacheStore } from './cacheStore';
export * from './llm';
export * from './embedder';
export * from './defaults';
export * from './machine';
export { runMachine, applyWrites, describeSlot, type RunEnv, type StepTrace } from './runner';
export { Kg, type OpenOptions, type SearchResult } from './kg';
