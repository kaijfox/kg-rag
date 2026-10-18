/**
 * @kg/mcp: the MCP adapter over KgApi. Each MCP connection is one agent session; every tool call goes through
 * KgApi, which does the logging. Tool names, descriptions and input schemas come from core TOOLS (one to one).
 *
 * Tools are served through the low-level request handlers rather than McpServer.registerTool: registerTool makes
 * the SDK validate arguments itself and reject bad ones as protocol errors, but core validates inputs inside
 * runTool, so the caller sees the same invalid_input error and the failed call is logged.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError } from '@modelcontextprotocol/sdk/types.js';
import { TOOLS, TOOL_NAMES, errorCodeOf, toolInputJsonSchema, type KgApi, type SessionId, type ToolName } from '@kg/core';

const byMcpName = new Map<string, ToolName>(TOOL_NAMES.map((k) => [TOOLS[k].name, k]));

type Call = (s: SessionId, args: unknown) => Promise<unknown>;

function errorText(e: unknown): string {
  return `${errorCodeOf(e)}: ${e instanceof Error ? e.message : String(e)}`;
}

async function openAgentSession(server: Server, api: KgApi): Promise<SessionId> {
  const client = server.getClientVersion();
  const { sessionId } = await api.openSession({
    kind: 'agent',
    label: client?.name,
    meta: { clientVersion: client?.version ?? null },
  });
  return sessionId;
}

export function createMcpServer(api: KgApi, o: { name?: string; version?: string } = {}): McpServer {
  const mcp = new McpServer({ name: o.name ?? '@kg/mcp', version: o.version ?? '0.1.0' });
  const low = mcp.server;
  low.registerCapabilities({ tools: {} });

  // One session per connection, opened when the client finishes initializing. A tool call that arrives first
  // waits on the same promise, so the session is never opened twice. A failed open is forgotten, so the next call retries.
  let opened: Promise<SessionId> | undefined;
  const sessionId = (): Promise<SessionId> =>
    (opened ??= openAgentSession(low, api).catch((e: unknown) => {
      opened = undefined;
      throw e;
    }));
  low.oninitialized = () => {
    sessionId().catch(() => undefined);
  };

  low.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: TOOL_NAMES.map((k) => ({
      name: TOOLS[k].name,
      description: TOOLS[k].description,
      inputSchema: toolInputJsonSchema(k),
    })),
  }));

  low.setRequestHandler(CallToolRequestSchema, async (req) => {
    const k = byMcpName.get(req.params.name);
    if (k === undefined) throw new McpError(ErrorCode.InvalidParams, `Unknown tool: ${req.params.name}`);
    try {
      const sid = await sessionId();
      const out = await (api[k] as unknown as Call)(sid, req.params.arguments ?? {});
      return {
        content: [{ type: 'text', text: JSON.stringify(out) }],
        structuredContent: out as { [key: string]: unknown },
      };
    } catch (e) {
      return { isError: true, content: [{ type: 'text', text: errorText(e) }] };
    }
  });

  return mcp;
}

/** Serves one database over stdio: one process, one connection, one agent session. */
export async function serveStdio(api: KgApi, o?: { name?: string; version?: string }): Promise<McpServer> {
  const server = createMcpServer(api, o);
  await server.connect(new StdioServerTransport());
  return server;
}
