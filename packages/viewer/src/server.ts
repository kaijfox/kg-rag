import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { KgError, type LogReader, type MachineMap, type SearchId, type SessionId, type SessionKind } from '@kg/core';

export interface ViewerOptions {
  /** When given, the server listens on 127.0.0.1 at this port (0 = any free port). Otherwise the caller listens. */
  port?: number;
  itemInfo?: (itemId: string) => { label: string; text: string } | null;
  machines?: (machine: string, version: string) => MachineMap | null;
}

const KINDS: readonly SessionKind[] = ['agent', 'eval', 'cli', 'test'];
const MAX_BODY = 64 * 1024;

const WEB = new URL('../web/', import.meta.url);
const VENDOR = new URL('../vendor/', import.meta.url);
const HTML = 'text/html; charset=utf-8';
const JS = 'text/javascript; charset=utf-8';
const STATIC: Record<string, { body: Buffer; type: string }> = {
  '/': { body: readFileSync(new URL('index.html', WEB)), type: HTML },
  '/index.html': { body: readFileSync(new URL('index.html', WEB)), type: HTML },
  '/app.js': { body: readFileSync(new URL('app.js', WEB)), type: JS },
  '/render.js': { body: readFileSync(new URL('render.js', WEB)), type: JS },
  '/vendor/mermaid.min.js': { body: readFileSync(new URL('mermaid.min.js', VENDOR)), type: JS },
};

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const CSP = "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:";

function send(res: ServerResponse, status: number, type: string, body: string | Buffer): void {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', 'content-security-policy': CSP, 'x-content-type-options': 'nosniff' });
  res.end(body);
}

function sendJson(res: ServerResponse, status: number, value: unknown): void {
  send(res, status, 'application/json; charset=utf-8', JSON.stringify(value));
}

function sendError(res: ServerResponse, e: unknown): void {
  if (e instanceof HttpError) {
    sendJson(res, e.status, { error: { code: e.code, message: e.message } });
    return;
  }
  if (e instanceof KgError) {
    const status = e.code === 'not_found' ? 404 : e.code === 'invalid_input' ? 400 : 500;
    sendJson(res, status, { error: { code: e.code, message: e.message } });
    return;
  }
  sendJson(res, 500, { error: { code: 'internal', message: e instanceof Error ? e.message : String(e) } });
}

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);

/** True when a Host header value (host[:port]) names the loopback interface; DNS rebinding arrives with another name. */
function loopbackHost(host: string | undefined): boolean {
  if (host === undefined) return false;
  try {
    return LOOPBACK.has(new URL(`http://${host}`).hostname);
  } catch {
    return false;
  }
}

/** A cross-site page cannot make the browser omit Origin on a POST, but it can send a foreign one. */
function loopbackOrigin(origin: string | undefined): boolean {
  if (origin === undefined) return true;
  try {
    return LOOPBACK.has(new URL(origin).hostname);
  } catch {
    return false;
  }
}

function intParam(url: URL, name: string, min: number, max: number): number | undefined {
  const raw = url.searchParams.get(name);
  if (raw === null) return undefined;
  const n = Number(raw);
  if (!/^\d+$/.test(raw) || n < min || n > max) throw new KgError('invalid_input', `${name} must be an integer in ${min}..${max}`);
  return n;
}

function requiredParam(url: URL, name: string): string {
  const v = url.searchParams.get(name);
  if (!v) throw new KgError('invalid_input', `${name} is required`);
  return v;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new HttpError(413, 'invalid_input', 'body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function api(reader: LogReader, o: ViewerOptions, req: IncomingMessage, url: URL, res: ServerResponse): Promise<void> {
  const path = url.pathname;
  const method = req.method ?? 'GET';

  if (path === '/api/notes' && method === 'POST') {
    if (!loopbackOrigin(req.headers.origin)) throw new HttpError(403, 'forbidden', 'cross-site request refused');
    if (!/^application\/json\s*(;|$)/i.test(req.headers['content-type'] ?? '')) throw new HttpError(415, 'invalid_input', 'content-type must be application/json');
    let body: unknown;
    try {
      body = JSON.parse(await readBody(req));
    } catch (e) {
      if (e instanceof HttpError) throw e;
      throw new KgError('invalid_input', 'body is not JSON');
    }
    const b = body as { sessionId?: unknown; text?: unknown } | null;
    if (typeof b !== 'object' || b === null || typeof b.sessionId !== 'string' || typeof b.text !== 'string') {
      throw new KgError('invalid_input', 'body must be {sessionId: string, text: string}');
    }
    sendJson(res, 201, reader.addNote(b.sessionId as SessionId, b.text));
    return;
  }

  if (method !== 'GET') throw new HttpError(405, 'invalid_input', `${method} not allowed here`);

  if (path === '/api/sessions') {
    const kind = url.searchParams.get('kind');
    if (kind !== null && !(KINDS as readonly string[]).includes(kind)) throw new KgError('invalid_input', `unknown kind ${kind}`);
    const limit = intParam(url, 'limit', 1, 1000);
    sendJson(
      res,
      200,
      reader.sessions({
        ...(kind !== null ? { kind: kind as SessionKind } : {}),
        ...(limit !== undefined ? { limit } : {}),
      }),
    );
    return;
  }
  if (path === '/api/events') {
    const session = requiredParam(url, 'session') as SessionId;
    const after = intParam(url, 'after', 0, Number.MAX_SAFE_INTEGER);
    const limit = intParam(url, 'limit', 1, 10000);
    sendJson(res, 200, reader.events(session, after, limit));
    return;
  }
  if (path.startsWith('/api/search/')) {
    sendJson(res, 200, reader.eventsBySearch(decodeURIComponent(path.slice('/api/search/'.length)) as SearchId));
    return;
  }
  if (path === '/api/notes') {
    sendJson(res, 200, reader.notes(requiredParam(url, 'session') as SessionId));
    return;
  }
  if (path.startsWith('/api/items/')) {
    if (!o.itemInfo) throw new HttpError(404, 'not_found', 'no item source');
    const info = o.itemInfo(decodeURIComponent(path.slice('/api/items/'.length)));
    if (info === null) throw new HttpError(404, 'not_found', 'unknown item');
    sendJson(res, 200, info);
    return;
  }
  if (path.startsWith('/api/machines/')) {
    if (!o.machines) throw new HttpError(404, 'not_found', 'no machine source');
    const ref = decodeURIComponent(path.slice('/api/machines/'.length));
    const at = ref.lastIndexOf('@');
    if (at <= 0 || at === ref.length - 1) throw new KgError('invalid_input', 'expected <machine>@<version>');
    const map = o.machines(ref.slice(0, at), ref.slice(at + 1));
    if (map === null) throw new HttpError(404, 'not_found', `unknown machine ${ref}`);
    sendJson(res, 200, map);
    return;
  }
  throw new HttpError(404, 'not_found', `no route ${path}`);
}

/**
 * The viewer's HTTP server (node:http, no framework). Read-only except POST /api/notes, which refuses a foreign Origin and a non-JSON body; every request needs a loopback Host. Holds no state of its own:
 * every response is computed from the reader, the item source and the machine source at request time.
 */
export function createViewerServer(reader: LogReader, o: ViewerOptions = {}): Server {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://viewer.local');
    const handled = (async () => {
      if (!loopbackHost(req.headers.host)) throw new HttpError(403, 'forbidden', 'host not allowed');
      if (url.pathname.startsWith('/api/')) return api(reader, o, req, url, res);
      const file = STATIC[url.pathname];
      if (!file) throw new HttpError(404, 'not_found', `no route ${url.pathname}`);
      if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'invalid_input', 'method not allowed');
      send(res, 200, file.type, file.body);
    })();
    handled.catch((e: unknown) => {
      if (res.headersSent) res.end();
      else sendError(res, e);
    });
  });
  if (o.port !== undefined) server.listen(o.port, '127.0.0.1');
  return server;
}
