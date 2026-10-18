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
