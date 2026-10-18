/**
 * @kg/app: the composition root. Phase 1 wires the walking skeleton from testkit fakes and the skeleton
 * implementations in src/skeleton/ (which the Phase 2 packages replace in Phase 3).
 */
import {
  DEFAULT_CONFIG,
  TOOLS,
  KgError,
  createKgApi,
  systemClock,
  ulidGen,
  type Chunker,
  type Clock,
  type CorpusStore,
  type DatabaseConfig,
  type Embedder,
  type IdGen,
  type Json,
  type KgApi,
  type Parser,
  type SessionId,
  type ToolName,
} from '@kg/core';
import { InMemoryCorpusStore, InMemoryEventLog } from '@kg/testkit';
import { createApiHandlers } from './skeleton/api';
import { sectionPack } from './skeleton/chunker';
import { createIngest } from './skeleton/ingest';
import { createSearch } from './skeleton/search';

export interface SkeletonOptions {
  parser: Parser;
  embedder: Embedder;
  config?: DatabaseConfig;
  chunker?: Chunker;
  store?: CorpusStore;
  clock?: Clock;
  ids?: IdGen;
}

export function createSkeleton(o: SkeletonOptions) {
  const clock = o.clock ?? systemClock;
  const ids = o.ids ?? ulidGen();
  const store = o.store ?? new InMemoryCorpusStore(clock);
  const log = new InMemoryEventLog(clock, ids);
  const config = o.config ?? DEFAULT_CONFIG;
  const search = createSearch({ store, embedder: o.embedder });
  const ingest = createIngest({ store, parser: o.parser, chunker: o.chunker ?? sectionPack, embedder: o.embedder, config });
  const runtime = { log, clock, ids, currentBuild: () => store.currentBuild() };
  const api = createKgApi(runtime, createApiHandlers({ store, log, search, ingest }));
  return { api, store, log, search, ingest, runtime, config };
}

/**
 * MCP-shaped call: what the `mcp` adapter does per tool, without a transport. Looks the tool up by its MCP
 * name in TOOLS, passes JSON arguments to the matching KgApi method, and returns MCP-style content
 * (structured JSON plus a text rendering), or an MCP error result carrying the KgError code.
 */
export async function mcpCall(api: KgApi, sessionId: SessionId, name: string, args: Json) {
  const entry = (Object.entries(TOOLS) as [ToolName, (typeof TOOLS)[ToolName]][]).find(([, d]) => d.name === name);
  if (!entry) return { isError: true, content: [{ type: 'text', text: `unknown tool ${name}` }] };
  const method = api[entry[0]] as (s: SessionId, a: unknown) => Promise<unknown>;
  try {
    const out = (await method.call(api, sessionId, args)) as Json;
    return { isError: false, structuredContent: out, content: [{ type: 'text', text: JSON.stringify(out) }] };
  } catch (e) {
    const code = e instanceof KgError ? e.code : 'internal';
    return { isError: true, content: [{ type: 'text', text: `${code}: ${(e as Error).message}` }] };
  }
}

export { renderEvent, renderSearch, renderSession } from './skeleton/viewer';
export { sectionPack } from './skeleton/chunker';
export { ollamaEmbedder, ollamaAvailable, ollamaLlm } from './skeleton/ollama';
export { createIngest } from './skeleton/ingest';
export { createSearch, vectorKnn, truncate, V0_STEPS } from './skeleton/search';
export { createApiHandlers } from './skeleton/api';
