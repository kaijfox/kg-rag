/**
 * The session viewer: a local page that reads the history and shows, per session, a timeline of what the system did:
 * queries, what each step received and returned, the results, feedback. It holds no state of its own. Running sessions
 * appear as events arrive (the page polls). The only write is a note on a session.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { IndexStore, KgError, type Kg } from '@kg/kernel';

const PAGE = readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');
const CSP = "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'";

function send(res: ServerResponse, status: number, body: unknown, type = 'application/json'): void {
  res.writeHead(status, { 'content-type': `${type}; charset=utf-8`, 'content-security-policy': CSP, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

async function readBody(req: IncomingMessage, max = 64 * 1024): Promise<string> {
  const parts: Buffer[] = [];
  let n = 0;
  for await (const c of req) {
    n += (c as Buffer).length;
    if (n > max) throw new KgError('invalid_input', 'request body too large');
    parts.push(c as Buffer);
  }
  return Buffer.concat(parts).toString('utf8');
}

export function createViewerServer(kg: Kg): Server {
  return createServer(async (req, res) => {
    try {
      // only this machine's browser may talk to the server (a page on another origin cannot read or write)
      const host = req.headers.host ?? '';
      if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) return send(res, 403, { error: 'forbidden host' });
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      const p = url.pathname;
      if (req.method === 'GET' && p === '/') return send(res, 200, PAGE, 'text/html');
      if (req.method === 'GET' && p === '/api/sessions') return send(res, 200, kg.history.sessions(200));
      let m = /^\/api\/sessions\/([^/]+)\/events$/.exec(p);
      if (req.method === 'GET' && m) return send(res, 200, { events: kg.history.events(decodeURIComponent(m[1]!), Number(url.searchParams.get('after') ?? 0)), notes: kg.history.notes(decodeURIComponent(m[1]!)) });
      m = /^\/api\/sessions\/([^/]+)\/notes$/.exec(p);
      if (req.method === 'POST' && m) {
        const body = JSON.parse(await readBody(req)) as { text?: unknown };
        if (typeof body.text !== 'string' || body.text.trim() === '') throw new KgError('invalid_input', 'text must be a non-empty string');
        kg.history.addNote(decodeURIComponent(m[1]!), body.text.trim());
        return send(res, 200, { ok: true });
      }
      if (req.method === 'GET' && p === '/api/machines') return send(res, 200, [...kg.registry.machines.values()]);
      if (req.method === 'GET' && p === '/api/records') {
        const ids = (url.searchParams.get('ids') ?? '').split(',').filter((x) => /^(ch|it)_[a-z2-7]{20}$/.test(x)).slice(0, 100);
        // the index file may have been swapped by a rebuild since this server started, so read the current one
        const ix = IndexStore.open(join(kg.dir, 'index.sqlite'));
        try {
          const chunks = ix.getChunks(ids.filter((i) => i.startsWith('ch_'))).map((c) => ({ id: c.id, kind: 'chunk', text: c.text, where: `${c.docKey} › ${c.sectionPath.join(' › ')}` }));
          const items = ix.getItems(ids.filter((i) => i.startsWith('it_'))).map((i) => ({ id: i.id, kind: i.kind, text: i.text, where: i.madeBy }));
          return send(res, 200, [...chunks, ...items]);
        } finally {
          ix.close();
        }
      }
      send(res, 404, { error: 'not found' });
    } catch (e) {
      send(res, e instanceof KgError && e.code === 'invalid_input' ? 400 : 500, { error: e instanceof Error ? e.message : String(e) });
    }
  });
}
