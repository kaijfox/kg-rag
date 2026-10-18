import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { describe, expect, it } from 'vitest';
import { KgError, type KgApi } from '@kg/core';
import { fakeKgApiHarness } from '@kg/testkit';
import { createMcpServer } from '../src/index';

async function connect(api: KgApi) {
  const [a, b] = InMemoryTransport.createLinkedPair();
  await createMcpServer(api).connect(a);
  const client = new Client({ name: 'mcp-test', version: '0' });
  await client.connect(b);
  return client;
}

const text = (r: unknown): string => (r as { content: { text: string }[] }).content[0]!.text;

describe('session opening', () => {
  it('a failed openSession is not cached: the next call retries and succeeds', async () => {
    const h = fakeKgApiHarness();
    let failing = true;
    let opens = 0;
    const api = new Proxy(h.api, {
      get(target, prop, recv) {
        if (prop !== 'openSession') return Reflect.get(target, prop, recv) as unknown;
        return (...args: Parameters<KgApi['openSession']>) => {
          if (failing) return Promise.reject(new KgError('upstream', 'log unavailable'));
          opens++;
          return target.openSession(...args);
        };
      },
    });
    const client = await connect(api);
    const first = await client.callTool({ name: 'add_note', arguments: { text: 'one' } });
    expect(first.isError).toBe(true);
    expect(text(first)).toMatch(/^upstream: log unavailable/);
    failing = false;
    const second = await client.callTool({ name: 'add_note', arguments: { text: 'two' } });
    expect(second.isError).toBeFalsy();
    const third = await client.callTool({ name: 'add_note', arguments: { text: 'three' } });
    expect(third.isError).toBeFalsy();
    expect(opens).toBe(1);
  });
});
