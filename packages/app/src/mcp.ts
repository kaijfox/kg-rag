/**
 * The MCP server: one connection is one agent session. Each tool call is logged by the kernel's history (events carry the
 * session and the index), so agent sessions and evaluation runs write the same kinds of events. Tool inputs are checked
 * here and a bad call is logged as a failed call with its reason.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError } from '@modelcontextprotocol/sdk/types.js';
import { KG_VERSION, KgError, type Json, type Kg } from '@kg/kernel';

type Obj = Record<string, unknown>;
interface Tool {
  name: string;
  description: string;
  schema: Json;
  run(kg: Kg, session: string, a: Obj): Promise<Json> | Json;
}

/** What the server tells an agent client about itself. Clients may add it to the agent's instructions. */
export const INSTRUCTIONS = `This server searches a knowledge base built from the user's own documents, notes or code documentation.
Call "search" before answering a question that depends on them.
The knowledge base is improved from your reports, so after using it:
- call "report_usage" with the IDs of the results you used;
- call "feedback" with a relevance from 0 to 1 and a note on what was missing when results were poor or unusually good;
- call "report_outcome" when you know whether the solution that used a search worked.
Keep each note to a sentence.`;

/** Chunk metadata an agent can use. Embedding text and other internals stay out of the reply. */
export function publicMeta(meta: Record<string, unknown> | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of ['date', 'title']) if (meta && meta[k] !== undefined) out[k] = meta[k];
  return out;
}

const need = (a: Obj, k: string, type: 'string' | 'number' | 'boolean'): void => {
  if (typeof a[k] !== type) throw new KgError('invalid_input', `${k} must be a ${type}`);
};
const opt = (a: Obj, k: string, type: 'string' | 'number' | 'boolean'): void => {
  if (a[k] !== undefined && typeof a[k] !== type) throw new KgError('invalid_input', `${k} must be a ${type}`);
};

export const TOOLS: Tool[] = [
  {
    name: 'search',
    description: 'Search the knowledge base. Returns ranked passages (and facts, when the machine uses them) with scores and the chunks that support each. The result has a searchId for feedback.',
    schema: { type: 'object', properties: { query: { type: 'string' }, k: { type: 'integer', minimum: 1, maximum: 50, default: 5 }, machine: { type: 'string', description: 'a search machine; default is the database default' } }, required: ['query'] },
    async run(kg, session, a) {
      need(a, 'query', 'string');
      opt(a, 'k', 'number');
      opt(a, 'machine', 'string');
      const k = (a.k as number | undefined) ?? 5;
      if (!Number.isInteger(k) || k < 1 || k > 50) throw new KgError('invalid_input', 'k must be an integer from 1 to 50');
      const r = await kg.search({ query: a.query as string, k, machine: a.machine as string | undefined, sessionId: session, shadow: true });
      return { searchId: r.searchId, indexId: r.indexId, machine: r.machine, items: r.items.map((i) => ({ id: i.id, kind: i.kind, score: Math.round(i.score * 1e4) / 1e4, text: i.text, sourceChunkIds: i.sourceChunkIds, docKey: i.docKey ?? null, sectionPath: i.sectionPath ?? [], ...(Object.keys(publicMeta(i.meta)).length ? { meta: publicMeta(i.meta) } : {}) })) } as unknown as Json;
    },
  },
  {
    name: 'get_chunks',
    description: 'Fetch passages or facts by ID, for example to read the chunks a fact cites.',
    schema: { type: 'object', properties: { ids: { type: 'array', items: { type: 'string' }, maxItems: 50 } }, required: ['ids'] },
    run(kg, _s, a) {
      if (!Array.isArray(a.ids) || !a.ids.every((x) => typeof x === 'string') || a.ids.length > 50) throw new KgError('invalid_input', 'ids must be up to 50 strings');
      const ids = a.ids as string[];
      const chunks = kg.index.getChunks(ids.filter((i) => i.startsWith('ch_'))).map((c) => ({ id: c.id, kind: 'chunk', text: c.text, docKey: c.docKey, sectionPath: c.sectionPath, ...(Object.keys(publicMeta(c.meta)).length ? { meta: publicMeta(c.meta) } : {}) }));
      const items = kg.index.getItems(ids.filter((i) => i.startsWith('it_'))).map((i) => ({ id: i.id, kind: i.kind, text: i.text, sourceChunkIds: i.sourceChunkIds }));
      return [...chunks, ...items] as unknown as Json;
    },
  },
  {
    name: 'feedback',
    description: 'Rate how relevant the results of a search were, overall or for one result, from 0 (useless) to 1 (exactly what was needed). A note says why.',
    schema: { type: 'object', properties: { searchId: { type: 'string' }, relevance: { type: 'number', minimum: 0, maximum: 1 }, itemId: { type: 'string' }, note: { type: 'string' } }, required: ['searchId', 'relevance'] },
    run(kg, session, a) {
      need(a, 'searchId', 'string');
      need(a, 'relevance', 'number');
      opt(a, 'itemId', 'string');
      opt(a, 'note', 'string');
      const rel = a.relevance as number;
      if (rel < 0 || rel > 1) throw new KgError('invalid_input', 'relevance must be between 0 and 1');
      const result = kg.history.eventsOfSearch(a.searchId as string).find((e) => e.type === 'search.result');
      if (!result) throw new KgError('not_found', `no search ${a.searchId}`);
      // feedback is keyed to chunk IDs, so it stays meaningful after a rebuild
      const items = ((result.payload as { items: { id: string; sourceChunkIds: string[] }[] }).items);
      const chunkIds = a.itemId ? (items.find((i) => i.id === a.itemId)?.sourceChunkIds ?? null) : [...new Set(items.flatMap((i) => i.sourceChunkIds))];
      if (chunkIds === null) throw new KgError('not_found', `item ${a.itemId} is not in search ${a.searchId}`);
      kg.history.append(session, 'feedback', { searchId: a.searchId as string, itemId: (a.itemId as string | undefined) ?? null, chunkIds, relevance: rel, note: (a.note as string | undefined) ?? null }, { indexId: result.indexId, searchId: a.searchId as string });
      return { ok: true };
    },
  },
  {
    name: 'report_usage',
    description: 'Report which results of a search you used in your answer. This is your own account and may differ from what influenced you.',
    schema: { type: 'object', properties: { searchId: { type: 'string' }, usedItemIds: { type: 'array', items: { type: 'string' } }, note: { type: 'string' } }, required: ['searchId', 'usedItemIds'] },
    run(kg, session, a) {
      need(a, 'searchId', 'string');
      if (!Array.isArray(a.usedItemIds) || !a.usedItemIds.every((x) => typeof x === 'string')) throw new KgError('invalid_input', 'usedItemIds must be strings');
      opt(a, 'note', 'string');
      const result = kg.history.eventsOfSearch(a.searchId as string).find((e) => e.type === 'search.result');
      if (!result) throw new KgError('not_found', `no search ${a.searchId}`);
      const items = (result.payload as { items: { id: string; sourceChunkIds: string[] }[] }).items;
      const chunkIds = [...new Set(items.filter((i) => (a.usedItemIds as string[]).includes(i.id)).flatMap((i) => i.sourceChunkIds))];
      kg.history.append(session, 'usage', { searchId: a.searchId as string, usedItemIds: a.usedItemIds, chunkIds, note: (a.note as string | undefined) ?? null }, { indexId: result.indexId, searchId: a.searchId as string });
      return { ok: true };
    },
  },
  {
    name: 'report_outcome',
    description: 'Report whether the solution that used a search worked.',
    schema: { type: 'object', properties: { searchId: { type: 'string' }, worked: { type: 'boolean' }, note: { type: 'string' } }, required: ['searchId', 'worked'] },
    run(kg, session, a) {
      need(a, 'searchId', 'string');
      need(a, 'worked', 'boolean');
      opt(a, 'note', 'string');
      if (kg.history.eventsOfSearch(a.searchId as string).length === 0) throw new KgError('not_found', `no search ${a.searchId}`);
      kg.history.append(session, 'outcome', { searchId: a.searchId as string, worked: a.worked as boolean, note: (a.note as string | undefined) ?? null }, { indexId: kg.index.indexId, searchId: a.searchId as string });
      return { ok: true };
    },
  },
  {
    name: 'status',
    description: 'What the knowledge base holds: documents, passages, facts, links and the current index.',
    schema: { type: 'object', properties: {} },
    run(kg) {
      return { indexId: kg.index.indexId, defaultMachine: kg.config.searchMachine, machines: [...kg.registry.machines.keys()], ...kg.index.stats() } as unknown as Json;
    },
  },
];

/** Runs one tool call and logs it (and its failure, with the code and reason). */
export async function callTool(kg: Kg, session: string, name: string, args: unknown): Promise<Json> {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) throw new KgError('not_found', `unknown tool ${name}`);
  const a = (args ?? {}) as Obj;
  kg.history.append(session, 'tool.called', { tool: name, args: a as Json }, { indexId: kg.index.indexId });
  try {
    return await tool.run(kg, session, a);
  } catch (e) {
    kg.history.append(session, 'tool.failed', { tool: name, code: e instanceof KgError ? e.code : 'internal', message: e instanceof Error ? e.message : String(e) }, { indexId: kg.index.indexId });
    throw e;
  }
}

export function createMcpServer(kg: Kg, o: { name?: string; version?: string } = {}): McpServer {
  const mcp = new McpServer({ name: o.name ?? 'kg', version: o.version ?? KG_VERSION }, { instructions: INSTRUCTIONS });
  const low = mcp.server;
  low.registerCapabilities({ tools: {} });
  let opened: string | undefined;
  const session = () => (opened ??= kg.history.openSession({ kind: 'agent', label: low.getClientVersion()?.name ?? null, meta: { clientVersion: low.getClientVersion()?.version ?? null } }));
  low.setRequestHandler(ListToolsRequestSchema, () => ({ tools: TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.schema as { type: 'object' } })) }));
  low.setRequestHandler(CallToolRequestSchema, async (req) => {
    if (!TOOLS.some((t) => t.name === req.params.name)) throw new McpError(ErrorCode.InvalidParams, `Unknown tool: ${req.params.name}`);
    try {
      const out = await callTool(kg, session(), req.params.name, req.params.arguments ?? {});
      return { content: [{ type: 'text', text: JSON.stringify(out) }], structuredContent: (Array.isArray(out) ? { items: out } : out) as { [k: string]: unknown } };
    } catch (e) {
      return { isError: true, content: [{ type: 'text', text: `${e instanceof KgError ? e.code : 'internal'}: ${e instanceof Error ? e.message : String(e)}` }] };
    }
  });
  return mcp;
}

export async function serveStdio(kg: Kg): Promise<McpServer> {
  const server = createMcpServer(kg);
  await server.connect(new StdioServerTransport());
  return server;
}
