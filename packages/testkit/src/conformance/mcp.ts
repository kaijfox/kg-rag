/**
 * mcpConformance (pre-written for the `mcp` package): the MCP adapter seen through a client. The `mcp` package
 * wraps its server in an SDK in-memory transport pair and passes `connect`; app runs it against `mcpCall`.
 */
import { expect } from 'vitest';
import { TOOLS, TOOL_NAMES, type Json, type KgApi, type LogReader } from '@kg/core';
import type { Suite } from './harness';

export interface McpClientLike {
  listTools(): Promise<{ name: string }[]>;
  callTool(name: string, args: Json): Promise<{ isError?: boolean; content: { type: string; text: string }[]; structuredContent?: unknown }>;
}
export interface McpHarness {
  api: KgApi;
  reader: LogReader;
  /** a query the api answers with at least two results */
  query: string;
  /** one MCP connection (one session) over api */
  connect(api: KgApi): Promise<McpClientLike>;
}

export function mcpConformance(make: () => McpHarness | Promise<McpHarness>): Suite {
  const agentSessions = (r: LogReader) => r.sessions({ kind: 'agent' });
  return {
    name: 'mcpConformance',
    cases: [
      {
        name: 'tools/list equals TOOLS one to one (never eval_run)',
        async run() {
          const h = await make();
          const c = await h.connect(h.api);
          const names = (await c.listTools()).map((t) => t.name).sort();
          expect(names).toEqual(TOOL_NAMES.map((k) => TOOLS[k].name).sort());
          expect(names).not.toContain('eval_run');
        },
      },
      {
        name: 'search and feedback round-trip with structured content, logged in the connection session',
        async run() {
          const h = await make();
          const c = await h.connect(h.api);
          const r = await c.callTool('search', { query: h.query, k: 3 });
          expect(r.isError ?? false).toBe(false);
          const resp = r.structuredContent as { searchId: string; items: { itemId: string }[] };
          expect(JSON.parse(r.content[0]!.text)).toEqual(resp);
          expect(resp.items.length).toBeGreaterThan(1);
          const fb = await c.callTool('feedback', { searchId: resp.searchId, overall: 2 });
          expect(fb.isError ?? false).toBe(false);
          const evs = h.reader.eventsBySearch(resp.searchId as never);
          const session = evs[0]!.sessionId;
          expect(agentSessions(h.reader).map((s) => s.sessionId)).toContain(session);
          const tools = h.reader.events(session).filter((e) => e.type === 'tool.called').map((e) => (e.payload as { tool: string }).tool);
          expect(tools).toEqual(['search', 'feedback']);
        },
      },
      {
        name: 'errors become isError results carrying the KgError code',
        async run() {
          const h = await make();
          const c = await h.connect(h.api);
          const unknown = await c.callTool('feedback', { searchId: 'sr_0000000000000000000000ZZZZ', overall: 1 });
          expect(unknown.isError).toBe(true);
          expect(unknown.content[0]!.text.startsWith('not_found:')).toBe(true);
          const bad = await c.callTool('search', { query: 'x', k: 0 });
          expect(bad.isError).toBe(true);
          expect(bad.content[0]!.text.startsWith('invalid_input:')).toBe(true);
        },
      },
      {
        name: 'each connection is its own agent session',
        async run() {
          const h = await make();
          const before = agentSessions(h.reader).length;
          const a = await h.connect(h.api);
          const b = await h.connect(h.api);
          await a.callTool('search', { query: h.query, k: 1 });
          await b.callTool('search', { query: h.query, k: 1 });
          expect(agentSessions(h.reader).length).toBe(before + 2);
        },
      },
    ],
  };
}
