/**
 * The command line: one entry point over the composition. Run from the repository root as `./kg <command>`
 * (or `pnpm kg <command>`; pnpm prints its own header on stdout, so use `./kg` for `serve mcp`):
 *
 *   ingest <file-or-dir>...        ingest PDFs (cached parse artifacts first, then the kg-parse sidecar)
 *   search "<query>" [-k n]        search the current build; prints label, score and the passage
 *   status                         documents, build, counts
 *   serve mcp                      MCP tools over stdio (for an agent client)
 *   serve viewer [--port n]        the read-only viewer at http://127.0.0.1:<port>/
 *   eval generate <out.json>       write an eval set: one question per sampled chunk (needs Ollama)
 *   eval run <set.json>            run an eval set against the current build and print the summary (needs Ollama)
 *
 * Options (every command): --db <file> (default ./kg.sqlite, or KG_DB), --artifacts <dir> (cached parse artifacts,
 * or KG_ARTIFACTS), --sidecar <command|none> (the kg-parse command; default the sidecar's venv, then kg-parse on PATH,
 * or KG_SIDECAR), --embed-digest <hex> (the Ollama digest of the embedding model, or KG_EMBED_DIGEST), --ollama-url.
 * Logs go to stderr; stdout carries only the command's output (and the MCP protocol for `serve mcp`).
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { DEFAULT_CONFIG, KgError, evalSetId, type Chunk, type ChunkId, type DatabaseConfig, type EvalQuestion, type EvalSet } from '@kg/core';
import { describeDropped, generateQuestionsDetailed, generateRecipe, GENERATE_SETTINGS, makeJudge } from '@kg/eval';
import { compose, type Composition } from './compose';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const SIDECAR_VENV = join(REPO, 'packages/parse-sidecar/.venv/bin/kg-parse');

const USAGE = `usage: ./kg <command> [options]   (or pnpm kg <command>, from the repository root)

commands:
  ingest <file-or-dir>...       ingest PDFs (--doc-key only with one file)
  search <query> [-k n]         search the current build (default k 5)
  status                        documents, build and counts
  serve mcp                     MCP tools over stdio
  serve viewer [--port n]       viewer at http://127.0.0.1:<port>/ (default 4319)
  eval generate <out.json>      write an eval set (--questions n, default 8; needs Ollama)
  eval run <set.json>           run an eval set (--conditions retrieved,gold; --ks 1,5; needs Ollama)

options: --db <file> --artifacts <dir> --sidecar <command|none> --embed-digest <hex> --ollama-url <url>
environment: KG_DB, KG_ARTIFACTS, KG_SIDECAR, KG_EMBED_DIGEST`;

const OPTIONS = {
  db: { type: 'string' },
  artifacts: { type: 'string' },
  sidecar: { type: 'string' },
  'embed-digest': { type: 'string' },
  'ollama-url': { type: 'string' },
  'doc-key': { type: 'string' },
  k: { type: 'string', short: 'k' },
  port: { type: 'string' },
  questions: { type: 'string' },
  conditions: { type: 'string' },
  ks: { type: 'string' },
  help: { type: 'boolean', short: 'h' },
} as const;

class UsageError extends Error {}

function fail(msg: string): never {
  throw new UsageError(msg);
}

/** Opens the composition from the options and environment. */
function open(values: Record<string, string | boolean | undefined>): Composition {
  const dbPath = (values.db as string | undefined) ?? process.env.KG_DB ?? resolve('kg.sqlite');
  const artifactDir = (values.artifacts as string | undefined) ?? process.env.KG_ARTIFACTS;
  const sidecarOpt = (values.sidecar as string | undefined) ?? process.env.KG_SIDECAR;
  const sidecar = sidecarCommand(sidecarOpt);
  const digest = (values['embed-digest'] as string | undefined) ?? process.env.KG_EMBED_DIGEST;
  const config: DatabaseConfig = digest ? { ...DEFAULT_CONFIG, space: { ...DEFAULT_CONFIG.space, digest } } : DEFAULT_CONFIG;
  return compose({
    dbPath,
    config,
    ...(artifactDir ? { artifactDir: resolve(artifactDir) } : {}),
    sidecar,
    ...(values['ollama-url'] ? { ollamaUrl: values['ollama-url'] as string } : {}),
  });
}

/** `none` turns the sidecar off; otherwise the given command, the repository's sidecar venv, or kg-parse on PATH. */
function sidecarCommand(opt: string | undefined): boolean | string {
  if (opt === 'none') return false;
  if (opt) return opt;
  return existsSync(SIDECAR_VENV) ? SIDECAR_VENV : 'kg-parse';
}

/** Human label of an item: document, chunk number, pages, section. */
function labeller(kg: Composition) {
  return (id: string): string => {
    const item = kg.store.getItems([id as never])[0] as Chunk | undefined;
    if (!item) return id;
    const doc = kg.store.currentDocVersions().find((d) => d.docKey === item.docKey);
    const n = doc ? doc.chunkIds.indexOf(item.id as ChunkId) : -1;
    return `${item.docKey}#${n >= 0 ? n : '?'} p${item.pages.join(',')} [${item.sectionPath.join(' > ').slice(0, 60)}]`;
  };
}

/** A file name as a document key: letters, digits, dot, dash and underscore; anything else becomes a dash. */
const docKeyOf = (path: string): string => basename(path, extname(path)).replace(/[^A-Za-z0-9._-]+/g, '-');

/** The PDFs named by the arguments: a file is taken as it is, a directory contributes its PDFs. */
function pdfsIn(args: string[]): string[] {
  return args.flatMap((a) => {
    const p = resolve(a);
    if (!existsSync(p)) fail(`no such file or directory: ${a}`);
    if (statSync(p).isDirectory()) return readdirSync(p).filter((f) => f.toLowerCase().endsWith('.pdf')).sort().map((f) => join(p, f));
    return [p];
  });
}

async function ingest(kg: Composition, args: string[], values: Record<string, string | boolean | undefined>): Promise<void> {
  const files = pdfsIn(args);
  if (files.length === 0) fail('no PDF files to ingest');
  if (values['doc-key'] && files.length !== 1) fail('--doc-key needs exactly one file');
  const sources = files.map((path) => ({ path, docKey: (values['doc-key'] as string | undefined) ?? docKeyOf(path) }));
  const { sessionId } = await kg.api.openSession({ kind: 'cli', label: 'ingest' });
  const report = await kg.api.ingest(sessionId, { sources });
  for (const d of report.docs) {
    console.log(`${d.docKey}: ${d.unchanged ? 'unchanged' : `${d.inserted} new chunks, ${d.reused} reused`}`);
  }
  console.log(`build ${report.buildId}${report.buildChanged ? ' (new)' : ' (unchanged)'}`);
}

async function search(kg: Composition, query: string, k: number): Promise<void> {
  const { sessionId } = await kg.api.openSession({ kind: 'cli', label: 'search' });
  const res = await kg.api.search(sessionId, { query, k });
  const label = labeller(kg);
  if (res.stale) console.error('warning: this build cites chunks that are no longer current');
  if (res.items.length === 0) console.log('no results');
  for (const item of res.items) {
    console.log(`\n${item.score.toFixed(3)}  ${label(item.itemId)}`);
    console.log(item.text.replace(/\s+/g, ' ').trim().slice(0, 400));
  }
  console.log(`\nsearch ${res.searchId} on build ${res.buildId}`);
}

function status(kg: Composition): void {
  const build = kg.store.currentBuild();
  const docs = kg.store.currentDocVersions();
  const count = (sql: string) => (kg.db.prepare(sql).get() as { n: number }).n;
  console.log(`database     ${kg.db.name}`);
  console.log(`documents    ${docs.length} (${docs.map((d) => d.docKey).join(', ') || 'none'})`);
  console.log(`chunks       ${docs.reduce((s, d) => s + d.chunkIds.length, 0)} in the current ingest`);
  console.log(`build        ${build ?? 'none (ingest a document first)'}`);
  console.log(`sessions     ${count('SELECT COUNT(*) AS n FROM sessions')}`);
  console.log(`events       ${count('SELECT COUNT(*) AS n FROM events')}`);
  console.log(`embedding    ${kg.config.space.model} (digest ${kg.config.space.digest.slice(0, 12)}...)`);
}

async function serveMcp(kg: Composition): Promise<void> {
  // stdout is the protocol; the process stays up until the client disconnects
  await kg.serveMcp();
}

function serveViewer(kg: Composition, port: number): void {
  kg.viewer(port);
  console.log(`viewer on http://127.0.0.1:${port}/ (Ctrl-C to stop)`);
}

/** One question per sampled substantial chunk, single-hop, as the baseline did. */
async function evalGenerate(kg: Composition, out: string, nQuestions: number): Promise<void> {
  const docs = kg.store.currentDocVersions();
  const chunks = kg.store.getItems(docs.flatMap((d) => d.chunkIds)).filter((i): i is Chunk => i.kind === 'chunk');
  const good = chunks.filter((c) => c.text.length > 600 && !/\[formula\]\s*$/.test(c.text));
  if (good.length < nQuestions) fail(`only ${good.length} substantial chunks; ask for fewer questions`);
  const step = Math.floor(good.length / nQuestions);
  const groups = Array.from({ length: nQuestions }, (_, i) => ({ type: 'single-hop' as const, chunkIds: [good[i * step]!.id] }));
  const settings = { ...GENERATE_SETTINGS, mix: { 'single-hop': 1, 'multi-hop': 0, topic: 0 } };
  const { drafts, dropped, genRecipeId } = await generateQuestionsDetailed(kg.llm, chunks, groups, generateRecipe(settings));
  console.error(describeDropped(dropped));
  const questions: EvalQuestion[] = drafts.map((d, i) => ({ ...d, id: `q${i + 1}` }));
  const set: EvalSet = { id: evalSetId(questions as never), name: basename(out, extname(out)), genRecipeId, questions };
  writeFileSync(resolve(out), JSON.stringify(set, null, 2) + '\n');
  console.log(`wrote ${questions.length} questions to ${resolve(out)}`);
}

async function evalRun(kg: Composition, file: string, conditions: string[], ks: number[]): Promise<void> {
  const set = JSON.parse(readFileSync(resolve(file), 'utf8')) as EvalSet;
  const build = kg.store.currentBuild();
  if (!build) fail('there is no build to evaluate; ingest a document first');
  const out = await kg.runEval(
    { rt: kg.runtime, api: kg.api, store: kg.store, answerer: kg.llm, judge: makeJudge(kg.llm), repo: kg.repo },
    set,
    { conditions, ks, buildId: build },
  );
  console.log(JSON.stringify(out.summary, null, 2));
  console.log(`eval run ${out.runId}`);
}

const list = (s: string | undefined, d: string[]) => (s ? s.split(',').map((x) => x.trim()).filter(Boolean) : d);
const numberOf = (s: string | undefined, d: number, name: string): number => {
  if (s === undefined) return d;
  const n = Number(s);
  if (!Number.isInteger(n) || n <= 0) fail(`${name} must be a positive whole number`);
  return n;
};

/** Rejects a malformed command before the database is opened, so a usage error creates no file. */
function checkUsage(command: string | undefined, sub: string | undefined, rest: string[]): void {
  switch (command) {
    case 'ingest':
    case 'search':
      if (command === 'search' && !sub) fail('search needs a query');
      return;
    case 'status':
      return;
    case 'serve':
      if (sub !== 'mcp' && sub !== 'viewer') fail('serve needs mcp or viewer');
      return;
    case 'eval':
      if (sub !== 'generate' && sub !== 'run') fail('eval needs generate or run');
      if (!rest[0]) fail(`eval ${sub} needs a file`);
      return;
    default:
      fail(`unknown command: ${command}`);
  }
}

async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true });
  if (values.help || positionals.length === 0) {
    console.log(USAGE);
    return values.help ? 0 : 1;
  }
  const [command, sub, ...rest] = positionals;
  checkUsage(command, sub, rest);
  const kg = open(values);
  try {
    switch (command) {
      case 'ingest':
        await ingest(kg, [sub, ...rest].filter((x): x is string => x !== undefined), values);
        return 0;
      case 'search': {
        if (!sub) fail('search needs a query');
        await search(kg, [sub, ...rest].join(' '), numberOf(values.k, 5, '-k'));
        return 0;
      }
      case 'status':
        status(kg);
        return 0;
      case 'serve':
        if (sub === 'mcp') {
          await serveMcp(kg);
          return 0;
        }
        if (sub === 'viewer') {
          serveViewer(kg, numberOf(values.port, 4319, '--port'));
          return 0;
        }
        fail('serve needs mcp or viewer');
        break;
      case 'eval':
        if (sub === 'generate') {
          if (!rest[0]) fail('eval generate needs an output file');
          await evalGenerate(kg, rest[0], numberOf(values.questions, 8, '--questions'));
          return 0;
        }
        if (sub === 'run') {
          if (!rest[0]) fail('eval run needs an eval set file');
          await evalRun(kg, rest[0], list(values.conditions as string | undefined, ['retrieved', 'gold']), list(values.ks as string | undefined, ['1', '5']).map(Number));
          return 0;
        }
        fail('eval needs generate or run');
        break;
      default:
        fail(`unknown command: ${command}`);
    }
  } finally {
    // a server command keeps running; the others close the database when they finish
    if (command !== 'serve') kg.close();
  }
  return 1;
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (e: unknown) => {
    if (e instanceof UsageError) {
      console.error(`${e.message}\n\n${USAGE}`);
      process.exitCode = 2;
      return;
    }
    if (e instanceof KgError) console.error(`error ${e.code}: ${e.message}`);
    else console.error(e instanceof Error ? e.message : String(e));
    process.exitCode = 1;
  },
);
