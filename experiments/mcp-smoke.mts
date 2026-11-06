/**
 * A smoke test of the real MCP server process, as an agent client sees it: start `kg serve mcp --watch`, read the
 * instructions and tools, search, report usage, change a source file and wait for the server to read it again, then search
 * for the new text. Needs Ollama with embeddinggemma. The database must have one markdown folder as its source.
 *
 *   node_modules/.bin/tsx experiments/mcp-smoke.mts <database folder> <source folder>
 */
import { appendFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Client } from '../packages/app/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import { StdioClientTransport } from '../packages/app/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js';

const [db, source] = process.argv.slice(2);
if (!db || !source) throw new Error('usage: mcp-smoke.mts <database folder> <source folder>');
const root = resolve(import.meta.dirname, '..');
const transport = new StdioClientTransport({ command: join(root, 'kg'), args: ['serve', 'mcp', '--watch', '--debounce-ms', '400', '--db', resolve(db)], stderr: 'pipe' });
const stderr: string[] = [];
transport.stderr?.on('data', (d: Buffer) => stderr.push(String(d)));
const client = new Client({ name: 'smoke-agent', version: '1' });
await client.connect(transport);

const call = async (name: string, args: Record<string, unknown>) => ((await client.callTool({ name, arguments: args })) as unknown as { structuredContent: Record<string, unknown> }).structuredContent;
console.log('instructions:', (client.getInstructions() ?? '').slice(0, 60) + '…');
console.log('tools:', (await client.listTools()).tools.map((t) => t.name).join(', '));
const first = (await call('search', { query: 'what file holds the records', k: 2 })) as { searchId: string; machine: string; items: { id: string; text: string }[] };
console.log('search ->', first.machine, first.items.map((i) => i.text.slice(0, 50)));
await call('report_usage', { searchId: first.searchId, usedItemIds: [first.items[0]!.id], note: 'smoke' });
await call('feedback', { searchId: first.searchId, relevance: 0.9, note: 'smoke' });

console.log('writing a new note…');
writeFileSync(join(source, 'viewer.md'), '# Viewer\n\nThe session viewer is a local web page on port 4319 that lists every agent session and shows what each search step received and returned.\n');
let found = false;
for (let i = 0; i < 90 && !found; i++) {
  await new Promise((r) => setTimeout(r, 1000));
  const r = (await call('search', { query: 'which port does the session viewer use', k: 3 })) as { items: { text: string }[] };
  found = r.items.some((x) => x.text.includes('4319'));
}
console.log('new note searchable after the watcher re-read the sources:', found);
console.log('server said on stderr:', stderr.join('').trim().split('\n').slice(-3).join(' | '));
appendFileSync(join(source, 'viewer.md'), '\n');
await client.close();
process.exit(found ? 0 : 1);
