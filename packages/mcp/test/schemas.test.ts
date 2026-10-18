import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { describe, expect, it } from 'vitest';
import { TOOLS, TOOL_NAMES } from '@kg/core';
import { fakeKgApiHarness } from '@kg/testkit';
import { createMcpServer } from '../src/index';

describe('tool listing', () => {
  it('advertises an object input schema with the declared properties for every tool', async () => {
    const [a, b] = InMemoryTransport.createLinkedPair();
    await createMcpServer(fakeKgApiHarness().api).connect(a);
    const client = new Client({ name: 'schema-test', version: '0' });
    await client.connect(b);
    const tools = (await client.listTools()).tools;
    expect(tools.map((t) => t.name).sort()).toEqual(TOOL_NAMES.map((k) => TOOLS[k].name).sort());
    const search = tools.find((t) => t.name === TOOLS.search.name)!;
    expect(search.inputSchema.type).toBe('object');
    expect(Object.keys(search.inputSchema.properties ?? {})).toEqual(expect.arrayContaining(['query', 'k']));
    for (const t of tools) expect(t.inputSchema.type).toBe('object');
  });
});
