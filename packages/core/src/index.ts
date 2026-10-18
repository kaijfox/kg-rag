/**
 * @kg/core: the shared contract. Every other package depends on this one only.
 * Frozen at fan-out; changes go through change proposals and bump CONTRACT_VERSION.
 */
export const CONTRACT_VERSION = '0.6.1';

export * from './ids';
export * from './errors';
export * from './model';
export * from './scoring';
export * from './conditioning';
export * from './schemas';
export * from './events';
export * from './machineMap';
export * from './builds';
export * from './defaults';
export * from './schema';
export * from './api';
export * from './runTool';
export * from './lookup';
export * from './evalTool';
export * from './evalGold';
export * from './jsonSchemas';
export * from './ports/infra';
export * from './ports/parse';
export * from './ports/embed';
export * from './ports/store';
export * from './ports/log';
export * from './ports/llm';
export * from './ports/search';
export * from './ports/ingest';
