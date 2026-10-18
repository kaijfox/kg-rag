import { QueueLlm } from './helpers';
export const QueryLlmFactory = (q: Record<string, unknown[]>) => new QueueLlm(structuredClone(q));
