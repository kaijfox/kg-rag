/** Serves the viewer over a database file. Usage: tsx scripts/serve-viewer.ts [--db path] [--port 4319] [--search] (--search also answers POST /live-search?q=... for live-session checks) */
import { createServer } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compose } from '../src/compose';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const arg = (n: string, d: string) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1]! : d);
const kg = compose({ dbPath: arg('--db', join(root, 'scratch/integration/stat-mech.kg.sqlite')) });
const port = Number(arg('--port', '4319'));
kg.viewer(port);
console.log(`viewer on http://127.0.0.1:${port}/`);
if (process.argv.includes('--search')) {
  // a helper endpoint so a live session can be produced while the viewer page is open (loopback only)
  const session = await kg.api.openSession({ kind: 'agent', label: 'live-session' });
  createServer(async (req, res) => {
    const q = new URL(req.url ?? '/', 'http://x').searchParams.get('q') ?? 'entropy';
    try {
      const r = await kg.api.search(session.sessionId, { query: q, k: 5 });
      res.end(JSON.stringify({ session: session.sessionId, searchId: r.searchId }));
    } catch (e) {
      res.statusCode = 500;
      res.end(String(e));
    }
  }).listen(port + 1, '127.0.0.1');
  console.log(`live search helper on http://127.0.0.1:${port + 1}/?q=...  session ${session.sessionId}`);
}
