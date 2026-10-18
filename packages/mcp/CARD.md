# @kg/mcp (WP10, Haiku)

Contract: `@kg/core` CONTRACT_VERSION 0.6.1. You need this card, `core`, and `testkit`; nothing else.

## Implements
`createMcpServer(api: KgApi, o?: { name?: string; version?: string }): McpServer` (from
`@modelcontextprotocol/sdk`) and `serveStdio(api)`. One connection = one session: on initialize, call
`api.openSession({ kind: 'agent', label: clientInfo.name, meta: { clientVersion } })` and use that
sessionId for every call on the connection.
For each `k` of core `TOOL_NAMES`, register a tool named `TOOLS[k].name` with description
`TOOLS[k].description` and input schema `TOOLS[k].input` (zod 4; the SDK version you pin must accept zod 4
schemas, or convert with `z.toJSONSchema`). The handler calls `api[k](sessionId, args)` and returns
`{ content: [{ type: 'text', text: JSON.stringify(out) }], structuredContent: out }`; a `KgError` becomes
`{ isError: true, content: [{ type: 'text', text: '<code>: <message>' }] }`. No logging code here: KgApi logs.
`EVAL_RUN_TOOL` is not a TOOLS entry and must never be exposed.

## package.json to create
dependencies `@kg/core: workspace:*`, `@modelcontextprotocol/sdk` (exact version, at least two weeks old);
devDependencies `@kg/testkit: workspace:*`.

## Tests you must pass
`test/roundtrip.test.ts` (pre-written suite; you supply the transport):
```ts
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { fakeKgApiHarness } from '@kg/testkit';
import { mcpConformance, registerSuite } from '@kg/testkit/conformance';
import { createMcpServer } from '../src/index';
registerSuite(mcpConformance(() => {
  const h = fakeKgApiHarness();
  return { ...h, async connect(api) {
    const [a, b] = InMemoryTransport.createLinkedPair();
    await createMcpServer(api).connect(a);
    const client = new Client({ name: 'mcp-test', version: '0' });
    await client.connect(b);
    return { listTools: async () => (await client.listTools()).tools, callTool: (name, args) => client.callTool({ name, arguments: args as never }) as never };
  } };
}));
```
4 cases: tools/list equals TOOLS (no eval_run); search and feedback round-trip with structured content, logged in
the connection's agent session; errors become isError with the KgError code; one session per connection. The
suite already passes against app's transport-free `mcpCall`, so a failure is yours, not the suite's.
Command: `pnpm --filter @kg/mcp test`.

## Forbidden imports
Any `@kg/*` other than core (testkit in tests).

## Decisions already made
stdio transport only in v0; MCP exposes `TOOLS` 1:1; logging below MCP (Q2).

## Open questions (note, do not decide)
How a client names the database (one server per database file vs a `database` argument): v0 serves one database per process.
