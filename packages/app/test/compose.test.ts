/** The real composition, offline: hash embedder, in-memory SQLite, the cached stat-mech artifacts (skipped when the corpus is absent). */
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { DEFAULT_CONFIG, type SearchResponse } from '@kg/core';
import { HASH_SPACE, HashEmbedder } from '@kg/testkit';
import { compose } from '../src/compose';

const corpus = resolve(dirname(fileURLToPath(import.meta.url)), '../../../test/corpa/stat-mech');
const docs = ['ThermoPlischke', 'FoundationsPlischke'];
const present = docs.every((d) => existsSync(join(corpus, `${d}.pdf`)) && existsSync(join(corpus, 'artifacts', `${d}.kgparse.json.gz`)));

describe.skipIf(!present)('composition on cached artifacts', () => {
  it('ingests, re-ingests to the same build, searches, and passes the rule checks', async () => {
    const kg = compose({
      dbPath: ':memory:',
      artifactDir: join(corpus, 'artifacts'),
      config: { ...DEFAULT_CONFIG, space: HASH_SPACE },
      embedder: new HashEmbedder(HASH_SPACE.dims),
    });
    const { sessionId } = await kg.api.openSession({ kind: 'test' });
    const sources = docs.map((d) => ({ path: join(corpus, `${d}.pdf`), docKey: d }));
    const first = await kg.api.ingest(sessionId, { sources });
    const second = await kg.api.ingest(sessionId, { sources });
    expect(second.buildId).toBe(first.buildId);
    expect(second.buildChanged).toBe(false);
    expect(second.docs.every((d) => d.unchanged && d.inserted === 0)).toBe(true);
    const embedded = kg.db.prepare("SELECT payload FROM events WHERE type='ingest.embedded'").all() as { payload: string }[];
    expect(embedded.slice(docs.length).every((e) => JSON.parse(e.payload).embedded === 0)).toBe(true);

    const res = await kg.api.search(sessionId, { query: 'Carnot engine efficiency', k: 5 });
    expect(res.items).toHaveLength(5);
    expect(res.buildId).toBe(first.buildId);

    // Rule 1: every item cites chunks. Rule 5: the build is the current ingest. Rule 6: search events record the build.
    const n = (sql: string) => (kg.db.prepare(sql).get() as { n: number }).n;
    expect(n('SELECT COUNT(*) n FROM items i WHERE NOT EXISTS (SELECT 1 FROM item_sources s WHERE s.item_id = i.item_id)')).toBe(0);
    expect(n("SELECT COUNT(*) n FROM events WHERE search_id IS NOT NULL AND build_id IS NULL")).toBe(0);
    expect(kg.store.staleCheck(first.buildId).stale).toBe(false);

    // the real MCP SDK client over an in-memory transport
    const server = kg.mcpServer();
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await server.connect(st);
    const client = new Client({ name: 'test', version: '0' });
    await client.connect(ct);
    const s = await client.callTool({ name: 'search', arguments: { query: 'entropy', k: 3 } });
    const sr = s.structuredContent as unknown as SearchResponse;
    expect(s.isError).toBeFalsy();
    const fb = await client.callTool({ name: 'feedback', arguments: { searchId: sr.searchId, overall: 2 } });
    expect(fb.isError).toBeFalsy();
    const bad = await client.callTool({ name: 'search', arguments: { query: '', k: 3 } });
    expect(bad.isError).toBe(true);
    await client.close();
    kg.close();
  }, 60_000);
});
