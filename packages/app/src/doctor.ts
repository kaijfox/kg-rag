/**
 * `kg doctor`: checks that what the system needs is in place and prints the line that registers it with an agent client.
 * Each check says what it found and, when something is wrong, what to do.
 */
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { FORMAT_VERSION, KG_VERSION, Kg, DEFAULT_CONFIG, withDefaults, type KgConfig } from '@kg/kernel';
import { readFileSync } from 'node:fs';
import { sidecarCommand } from './open';

export interface Check {
  name: string;
  status: 'ok' | 'warn' | 'fail';
  detail: string;
}

type Fetch = (url: string, init?: { signal?: AbortSignal }) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

const REPO = resolve(new URL('../../..', import.meta.url).pathname);

export async function runDoctor(o: { db: string; ollamaUrl?: string; fetch?: Fetch; sidecar?: string | null }): Promise<{ checks: Check[]; register: string[] }> {
  const checks: Check[] = [];
  const add = (name: string, status: Check['status'], detail: string) => checks.push({ name, status, detail });
  const major = Number(process.versions.node.split('.')[0]);
  add('node', major >= 22 ? 'ok' : 'fail', major >= 22 ? `Node ${process.versions.node}` : `Node ${process.versions.node}; version 22 or newer is required`);

  const dbDir = resolve(o.db);
  let config: KgConfig = DEFAULT_CONFIG;
  const hasDb = existsSync(join(dbDir, 'kg.json'));
  if (!hasDb) add('database', 'warn', `no database at ${dbDir}; create one with: ./kg init --db ${dbDir}`);
  else {
    try {
      config = withDefaults(JSON.parse(readFileSync(join(dbDir, 'kg.json'), 'utf8')) as Partial<KgConfig>);
      const kg = Kg.open(dbDir);
      try {
        const built = kg.index.getMeta('built_by');
        const stats = kg.index.stats();
        add('database', 'ok', `${dbDir}: ${stats.documents} documents, ${stats.currentChunks} passages, ${stats.facts} facts (built by kg ${built ?? 'unknown'}, running ${KG_VERSION}, format ${FORMAT_VERSION})`);
        if (built && built.split('.').slice(0, 2).join('.') !== KG_VERSION.split('.').slice(0, 2).join('.')) add('upgrade', 'warn', `the index was built by kg ${built} and this is ${KG_VERSION}; CHANGELOG.md says whether a rebuild is needed (./kg rebuild)`);
        add('sqlite-vec', 'ok', 'vector search loaded');
      } finally {
        kg.close();
      }
    } catch (e) {
      add('database', 'fail', e instanceof Error ? e.message : String(e));
    }
  }

  const base = (o.ollamaUrl ?? 'http://localhost:11434').replace(/\/+$/, '');
  const doFetch: Fetch = o.fetch ?? ((url, init) => fetch(url, init) as unknown as ReturnType<Fetch>);
  let models: { name?: string; digest?: string }[] | null = null;
  try {
    const res = await doFetch(`${base}/api/tags`, { signal: AbortSignal.timeout(3000) });
    models = ((await res.json()) as { models?: { name?: string; digest?: string }[] }).models ?? [];
    add('ollama', 'ok', `reachable at ${base}, ${models.length} models`);
  } catch {
    add('ollama', 'fail', `not reachable at ${base}; start it with: ollama serve`);
  }
  if (models) {
    const emb = models.find((m) => m.name === config.space.model);
    if (!emb) add('embedding model', 'fail', `${config.space.model} is not installed; run: ollama pull ${config.space.model.split(':')[0]}`);
    else if ((emb.digest ?? '').toLowerCase() !== config.space.digest.toLowerCase()) add('embedding model', 'fail', `${config.space.model} has digest ${emb.digest?.slice(0, 12)}, the database expects ${config.space.digest.slice(0, 12)}; vectors from different weights cannot be compared`);
    else add('embedding model', 'ok', `${config.space.model}, weights match the database`);
    const llm = models.find((m) => m.name === config.llm.model);
    if (llm) add('extraction model', 'ok', `${config.llm.model} is installed`);
    else
      add(
        'extraction model',
        config.extract.enabled ? 'warn' : 'ok',
        config.extract.enabled
          ? `${config.llm.model} is not installed here. Extraction results can be brought from another machine: see docs/beta/moving-extraction.md`
          : `${config.llm.model} is not installed; fine while extraction is off`,
      );
  }
  const side = sidecarCommand(o.sidecar);
  add('pdf parser', side ? 'ok' : 'warn', side ? `docling sidecar at ${side}` : 'no docling sidecar. PDFs with a kept parsed copy in artifacts/ still work; to parse new PDFs run: (cd packages/parse-sidecar && uv sync)');

  const launcher = join(REPO, 'kg');
  const register = [`claude mcp add kg -- ${launcher} serve mcp --db ${dbDir}`, JSON.stringify({ mcpServers: { kg: { command: launcher, args: ['serve', 'mcp', '--db', dbDir] } } }, null, 2)];
  return { checks, register };
}

export function formatDoctor(r: { checks: Check[]; register: string[] }): string {
  const mark = { ok: 'ok  ', warn: 'warn', fail: 'FAIL' };
  const lines = r.checks.map((c) => `${mark[c.status]}  ${c.name.padEnd(16)} ${c.detail}`);
  lines.push('', 'to register with Claude Code:', `  ${r.register[0]}`, '', 'or in an agent client that reads a JSON config:', ...r.register[1]!.split('\n').map((l) => `  ${l}`));
  return lines.join('\n');
}
