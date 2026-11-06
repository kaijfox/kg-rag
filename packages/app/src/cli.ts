#!/usr/bin/env tsx
/**
 * The kg command line. Run from anywhere in the repository as `./kg <command>`. `--db <dir>` (or KG_DB) names the
 * database directory; the default is ./kg-data.
 *
 *   init [--machine name] [--baseline]   create a database directory (extraction on, facts-and-neighbours; --baseline: off, plain search)
 *   add <path>...                add a file or a folder as a source (--adapter docling-pdf|markdown|html|decision-log, --doc-key name, --pattern regex, --exclude regex)
 *   remove <path>...             take a source off the list; the next ingest retires its documents
 *   ingest [file...]             read new and changed sources into the current index (--cache-only)
 *   rebuild [--keep-old] [--redo <module>] [--cache-only]   build a new index from the sources and swap it in
 *   search "<query>" [-k n] [--machine name]
 *   status | machines | diff <other-index.sqlite> | doctor | version
 *   correct alias <name> <canonical> | correct replaces <newer-chunk> <older-chunk> | corrections | uncorrect <id>
 *   feedback <searchId> --relevance 0..1 [--item id] [--note text]
 *   cache stats | cache export <file> | cache import <file>
 *   export [dir] [--no-text]     a folder with the history and configuration to send for review
 *   report [--json]              what the history says about real use
 *   eval generate <out.json> [--single n] [--multi n] [--topic n] [--seed n] [--min-chars n] [--name text]
 *   eval run <set.json> [--conditions a,b] [--ks 1,5] [--retrieval-only]
 *   eval from-log <out.json> [--min-relevance n]   questions from real searches (also writes <out>.unlabelled.json)
 *   eval label <set.json> <unlabelled.json>        add the entries a person labelled to a set
 *   serve mcp [--watch] [--debounce-ms n] | serve viewer [--port n]
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { FORMAT_VERSION, IndexStore, KG_VERSION, KgError, normName, type Kg, type SourceEntry } from '@kg/kernel';
import { ingest, rebuild } from '@kg/modules';
import { GENERATE_SETTINGS, evalSetId, generateQuestions, labelQuestions, pickGroups, questionsFromLog, runEval, type EvalSet, type UnlabelledQuestion } from '@kg/eval';
import { formatDoctor, runDoctor } from './doctor';
import { exportDatabase } from './export';
import { buildReport, formatReport } from './report';
import { watchSources } from './watch';
import { diffIndexes } from './diff';
import { callTool, serveStdio } from './mcp';
import { openKg, sidecarCommand } from './open';
import { createViewerServer } from './viewer';

export interface Io {
  out(s: string): void;
  err(s: string): void;
}
const stdio: Io = { out: (s) => process.stdout.write(s + '\n'), err: (s) => process.stderr.write(s + '\n') };

/** Every command, and the words that may follow the ones that take a subcommand. The documents are checked against these. */
export const COMMANDS = ['init', 'add', 'remove', 'ingest', 'rebuild', 'search', 'status', 'machines', 'diff', 'doctor', 'version', 'correct', 'corrections', 'uncorrect', 'feedback', 'cache', 'export', 'report', 'eval', 'serve'] as const;
export const SUBCOMMANDS: Record<string, readonly string[]> = {
  cache: ['stats', 'export', 'import'],
  correct: ['alias', 'replaces'],
  eval: ['generate', 'run', 'from-log', 'label'],
  serve: ['mcp', 'viewer'],
};

const USAGE = `usage: kg <command> [options]   (see the header of packages/app/src/cli.ts)
commands: ${COMMANDS.join(' ')}
options:  --db <dir> --ollama-url <url> --sidecar <command|none> --artifacts <dir,dir>`;

const OPTIONS = {
  db: { type: 'string' },
  'ollama-url': { type: 'string' },
  sidecar: { type: 'string' },
  artifacts: { type: 'string' },
  adapter: { type: 'string' },
  pattern: { type: 'string' },
  exclude: { type: 'string' },
  baseline: { type: 'boolean' },
  'doc-key': { type: 'string' },
  k: { type: 'string', short: 'k' },
  machine: { type: 'string' },
  'keep-old': { type: 'boolean' },
  redo: { type: 'string', multiple: true },
  relevance: { type: 'string' },
  item: { type: 'string' },
  note: { type: 'string' },
  single: { type: 'string' },
  multi: { type: 'string' },
  topic: { type: 'string' },
  seed: { type: 'string' },
  'min-chars': { type: 'string' },
  name: { type: 'string' },
  conditions: { type: 'string' },
  ks: { type: 'string' },
  port: { type: 'string' },
  'cache-only': { type: 'boolean' },
  'no-text': { type: 'boolean' },
  'retrieval-only': { type: 'boolean' },
  'min-relevance': { type: 'string' },
  watch: { type: 'boolean' },
  'debounce-ms': { type: 'string' },
  json: { type: 'boolean' },
  version: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
} as const;

export const OPTION_NAMES = Object.keys(OPTIONS);

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s).replace(/\s+/g, ' ');
const num = (v: string | undefined, d: number): number => {
  if (v === undefined) return d;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new KgError('invalid_input', `${v} is not a number`);
  return n;
};

export async function main(argv: string[], io: Io = stdio, hooks: { open?: typeof openKg } = {}): Promise<number> {
  let parsed: ReturnType<typeof parseArgs<{ options: typeof OPTIONS; allowPositionals: true }>>;
  try {
    parsed = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true });
  } catch (e) {
    io.err((e as Error).message + '\n' + USAGE);
    return 2;
  }
  const { values: v, positionals: pos } = parsed;
  const [cmd, ...rest] = pos;
  if (v.version || cmd === 'version') {
    io.out(`kg ${KG_VERSION} (database format ${FORMAT_VERSION})`);
    return 0;
  }
  if (!cmd || v.help) {
    io.out(USAGE);
    return cmd ? 0 : 2;
  }
  const db = resolve(v.db ?? process.env.KG_DB ?? 'kg-data');
  const open = hooks.open ?? openKg;
  const artifactDirs = (v.artifacts ?? process.env.KG_ARTIFACTS)?.split(',').filter(Boolean);
  const sidecar = sidecarCommand(v.sidecar ?? process.env.KG_SIDECAR);
  const base = { db, ollamaUrl: v['ollama-url'], sidecar, artifactDirs };
  const use = async <T>(fn: (kg: Kg) => Promise<T> | T, create = false): Promise<T> => {
    const kg = open({ ...base, create });
    try {
      return await fn(kg);
    } finally {
      kg.close();
    }
  };
  try {
    switch (cmd) {
      case 'init': {
        const fresh = !existsSync(join(db, 'kg.json'));
        return await use((kg) => {
          if (fresh) {
            if (v.machine && !kg.registry.machines.has(v.machine)) throw new KgError('invalid_input', `no machine ${v.machine}; see "kg machines"`);
            // a new database extracts facts and answers with them, while the baseline runs beside it for comparison;
            // --baseline keeps plain similarity search with extraction off
            const beta = v.baseline ? {} : { extract: { ...kg.config.extract, enabled: true }, searchMachine: 'facts-and-neighbours' };
            kg.saveConfig({ ...beta, ...(v.machine ? { searchMachine: v.machine } : {}) });
          }
          io.out(`database at ${kg.dir}`);
          io.out(
            fresh
              ? `extraction ${kg.config.extract.enabled ? `on (needs ${kg.config.llm.model}; see docs/beta/moving-extraction.md to run it on another machine)` : 'off'}; searches use ${kg.config.searchMachine}${kg.config.shadowMachine && kg.config.shadowMachine !== kg.config.searchMachine ? `, with ${kg.config.shadowMachine} logged beside them` : ''}`
              : 'the database already existed; its settings are unchanged',
          );
          io.out('next: kg add <file or folder>...  then: kg ingest');
          return 0;
        }, true);
      }

      case 'add':
        return await use((kg) => {
          if (rest.length === 0) throw new KgError('invalid_input', 'add needs at least one file');
          const sources = [...kg.config.sources];
          for (const f of rest) {
            const path = resolve(f);
            if (!existsSync(path)) throw new KgError('not_found', `no file ${path}`);
            const entry: SourceEntry = { path, ...(v.adapter ? { adapter: v.adapter } : {}), ...(v.pattern ? { pattern: v.pattern } : {}), ...(v.exclude ? { exclude: v.exclude } : {}), ...(v['doc-key'] && rest.length === 1 ? { docKey: v['doc-key'] } : {}) };
            const at = sources.findIndex((s) => s.path === path);
            if (at >= 0) sources[at] = entry;
            else sources.push(entry);
            io.out(`added ${path}`);
          }
          kg.saveConfig({ sources });
          return 0;
        }, true);

      case 'remove':
        return await use((kg) => {
          if (rest.length === 0) throw new KgError('invalid_input', 'remove needs at least one source path');
          const gone = rest.map((f) => resolve(f));
          const keep = kg.config.sources.filter((s) => !gone.includes(resolve(kg.path(s.path))));
          const removed = kg.config.sources.length - keep.length;
          if (removed === 0) throw new KgError('not_found', `none of ${rest.join(', ')} is a source (see sources in kg.json)`);
          kg.saveConfig({ sources: keep });
          io.out(`removed ${removed} source${removed === 1 ? '' : 's'}; run "kg ingest" to retire their documents`);
          return 0;
        });

      case 'ingest':
        return await use(async (kg) => {
          for (const f of rest) if (!existsSync(resolve(f))) throw new KgError('not_found', `no file ${resolve(f)}`);
          const only: SourceEntry[] | undefined = rest.length ? rest.map((f) => kg.config.sources.find((s) => s.path === resolve(f)) ?? { path: resolve(f) }) : undefined;
          const r = await ingest(kg, { sources: only, sidecar, artifactDirs, cacheOnly: v['cache-only'] });
          const changed = r.documents.filter((d) => !d.unchanged);
          for (const d of r.documents.length > 30 ? changed : r.documents) io.out(`${d.docKey}: ${d.unchanged ? 'unchanged' : `${d.chunks} chunks`}`);
          if (r.documents.length > 30) io.out(`${r.documents.length} documents, ${changed.length} changed or new`);
          for (const m of r.missing) io.err(`warning: source ${m} does not exist; its documents are kept`);
          if (r.retired.length) io.out(`retired ${r.retired.length}: ${r.retired.slice(0, 5).join(', ')}${r.retired.length > 5 ? ', …' : ''}`);
          io.out(`embedded ${r.embedded}, facts ${r.facts}, links ${r.links}; model calls ${r.llm.made} made, ${r.llm.cached} from the cache; index ${r.indexId}`);
          return 0;
        });

      case 'rebuild':
        return await use(async (kg) => {
          const r = await rebuild(kg, { keepOld: v['keep-old'], redo: v.redo, sidecar, artifactDirs, cacheOnly: v['cache-only'] });
          io.out(`rebuilt ${r.previousIndexId} → ${r.report.indexId}${r.keptOld ? ` (old index kept at ${r.keptOld})` : ''}`);
          io.out(Object.entries(r.report.stats).map(([k, x]) => `${k} ${x}`).join(', '));
          io.out(`model calls ${r.report.llm.made} made, ${r.report.llm.cached} from the cache`);
          io.out('a running "serve mcp" or "serve viewer" still reads the old index: restart it');
          return 0;
        });

      case 'search':
        return await use(async (kg) => {
          const q = rest.join(' ');
          if (!q) throw new KgError('invalid_input', 'search needs a query');
          const session = kg.openSession('cli', 'search');
          const r = await kg.search({ query: q, k: num(v.k, 5), machine: v.machine, sessionId: session });
          io.out(`search ${r.searchId} · ${r.machine} · index ${r.indexId}`);
          r.items.forEach((i, n) => io.out(`${n + 1}. [${i.kind}] ${i.score.toFixed(3)}  ${i.docKey ?? ''} ${i.sectionPath?.join(' › ') ?? ''}\n   ${clip(i.text, 220)}`));
          return 0;
        });

      case 'status':
        return await use((kg) => {
          const s = kg.index.stats();
          io.out(`database   ${kg.dir}\nindex      ${kg.index.indexId} (built by kg ${kg.index.getMeta('built_by') ?? 'unknown'}; this is kg ${KG_VERSION})\nsources    ${kg.config.sources.length}\n${Object.entries(s).map(([k, x]) => `${k.padEnd(10)} ${x}`).join('\n')}`);
          const builds = [kg.history.latestSession('ingest'), kg.history.latestSession('rebuild')].filter((x) => x !== null).sort((a, b) => (a!.sessionId < b!.sessionId ? 1 : -1));
          if (builds[0]) {
            const calls = kg.history.llmCalls(builds[0].sessionId);
            io.out(`last build ${builds[0].kind} at ${builds[0].startedAt}: model calls ${calls.made} made, ${calls.cached} from the cache`);
          }
          const c = kg.cache.stats();
          io.out(`history    ${kg.history.sessions(1000).length} sessions, ${kg.history.corrections().length} confirmed corrections\ncache      ${c.entries} responses, ${(c.bytes / 1024).toFixed(0)} KB`);
          const problems = kg.index.audit();
          io.out(`audit      ${problems.length ? problems.join('; ') : 'clean'}`);
          return 0;
        });

      case 'doctor': {
        const r = await runDoctor({ db, ollamaUrl: v['ollama-url'], sidecar: v.sidecar ?? process.env.KG_SIDECAR });
        io.out(formatDoctor(r));
        return r.checks.some((c) => c.status === 'fail') ? 1 : 0;
      }

      case 'cache':
        return await use((kg) => {
          if (rest[0] === 'stats') {
            const c = kg.cache.stats();
            io.out(`${c.entries} responses, ${(c.bytes / 1024).toFixed(0)} KB (cap ${(kg.config.cacheMaxBytes / 1048576).toFixed(0)} MB)`);
            return 0;
          }
          if (rest[0] === 'export' && rest[1]) {
            const out = resolve(rest[1]);
            if (existsSync(out)) throw new KgError('invalid_input', `${out} already exists`);
            kg.cache.backupTo(out);
            io.out(`wrote ${out} (${kg.cache.stats().entries} responses); copy it to the other machine and run: kg cache import ${rest[1]}`);
            return 0;
          }
          if (rest[0] === 'import' && rest[1]) {
            const file = resolve(rest[1]);
            const path = existsSync(join(file, 'cache.sqlite')) ? join(file, 'cache.sqlite') : file;
            if (!existsSync(path)) throw new KgError('not_found', `no file ${path}`);
            const r = kg.cache.importFrom(path);
            io.out(`added ${r.added} responses, ${r.alreadyHad} were already here`);
            return 0;
          }
          throw new KgError('invalid_input', 'usage: cache stats | cache export <file> | cache import <cache file or database folder>');
        });

      case 'export':
        return await use((kg) => {
          const stamp = kg.now().replace(/[-:]/g, '').slice(0, 13).replace('T', '-');
          const out = resolve(rest[0] ?? `kg-export-${stamp}`);
          const r = exportDatabase(kg, out, { noText: v['no-text'] });
          io.out(`wrote ${r.dir}: ${r.files.join(', ')}\n${r.sessions} sessions, ${r.searches} searches; ${r.textIncluded ? 'passages of your documents are included' : 'no passage text is included, but queries, notes and file names are'}\nzip the folder and send it`);
          return 0;
        });

      case 'report':
        return await use((kg) => {
          const r = buildReport(kg);
          io.out(v.json ? JSON.stringify(r, null, 2) : formatReport(r));
          return 0;
        });

      case 'machines':
        return await use((kg) => {
          for (const m of kg.registry.machines.values()) {
            io.out(`${m.name}@${m.version}: ${m.description ?? ''}`);
            for (const [id, s] of Object.entries(m.states)) io.out(`  ${id}: ${s.module} → ${s.next === null ? 'finish' : typeof s.next === 'string' ? s.next : `${s.next.guard} ? ${s.next.then} : ${s.next.else ?? 'finish'}`}`);
          }
          return 0;
        });

      case 'diff':
        return await use((kg) => {
          if (!rest[0]) throw new KgError('invalid_input', 'diff needs the path of another index file');
          const other = IndexStore.open(resolve(rest[0]));
          try {
            const d = diffIndexes(kg.index, other);
            io.out(`A ${d.a}\nB ${d.b}\nchunks: ${d.chunks.shared} shared, ${d.chunks.onlyInA} only in A, ${d.chunks.onlyInB} only in B; ${d.unchanged} shared chunks have the same derived items`);
            for (const [m, c] of Object.entries(d.makers)) io.out(`  ${m}: A ${c.a}, B ${c.b}`);
            for (const c of d.changed.slice(0, 10)) io.out(`  ${c.chunkId}\n    A: ${c.a.map((t) => clip(t, 80)).join(' | ') || '(none)'}\n    B: ${c.b.map((t) => clip(t, 80)).join(' | ') || '(none)'}`);
            return 0;
          } finally {
            other.close();
          }
        });

      case 'correct':
        return await use((kg) => {
          const [kind, a, b] = rest;
          if (kind === 'alias' && a && b) kg.history.addCorrection({ kind: 'alias-of', subject: 'name', fromKey: normName(a), toKey: normName(b), note: v.note ?? null });
          else if (kind === 'replaces' && a && b) kg.history.addCorrection({ kind: 'replaces', subject: 'chunk', fromKey: a, toKey: b, note: v.note ?? null });
          else throw new KgError('invalid_input', 'usage: correct alias <name> <canonical> | correct replaces <newer-chunk-id> <older-chunk-id>');
          io.out('saved; it applies to the current index after the next rebuild');
          return 0;
        });

      case 'corrections':
        return await use((kg) => (kg.history.corrections().forEach((c) => io.out(`${c.id}  ${c.kind}  ${c.fromKey} → ${c.toKey}${c.note ? `  (${c.note})` : ''}`)), 0));

      case 'uncorrect':
        return await use((kg) => (kg.history.removeCorrection(num(rest[0], NaN)), io.out('removed'), 0));

      case 'feedback':
        return await use(async (kg) => {
          const s = kg.openSession('cli', 'feedback');
          await callTool(kg, s, 'feedback', { searchId: rest[0], relevance: num(v.relevance, NaN), ...(v.item ? { itemId: v.item } : {}), ...(v.note ? { note: v.note } : {}) });
          io.out('recorded');
          return 0;
        });

      case 'eval':
        return await use(async (kg) => {
          const [sub, file] = rest;
          if (!file) throw new KgError('invalid_input', `eval ${sub ?? ''} needs a file`);
          if (sub === 'from-log') {
            const { set, unlabelled } = questionsFromLog(kg, { minRelevance: v['min-relevance'] === undefined ? undefined : num(v['min-relevance'], 0.5) });
            writeFileSync(file, JSON.stringify(set, null, 1));
            const extra = `${file}.unlabelled.json`;
            if (unlabelled.length) writeFileSync(extra, JSON.stringify(unlabelled, null, 1));
            io.out(`${set.questions.length} questions from searches whose results an agent used, written to ${file}`);
            io.out(unlabelled.length ? `${unlabelled.length} searches went badly and have no gold yet: ${extra}\nfill in goldChunkIds for the ones worth keeping, then: kg eval label ${file} ${extra}` : 'no searches went badly');
            return 0;
          }
          if (sub === 'label') {
            const entries = JSON.parse(readFileSync(resolve(rest[2] ?? ''), 'utf8')) as UnlabelledQuestion[];
            const r = labelQuestions(kg, JSON.parse(readFileSync(file, 'utf8')) as EvalSet, entries);
            writeFileSync(file, JSON.stringify(r.set, null, 1));
            io.out(`added ${r.added} questions to ${file}; ${r.skipped} entries have no goldChunkIds yet`);
            return 0;
          }
          if (sub === 'generate') {
            const chunks = kg.index.currentChunks();
            const groups = pickGroups(chunks, { seed: num(v.seed, 17), single: num(v.single, 8), multi: num(v.multi, 4), topic: num(v.topic, 3), minChars: num(v['min-chars'], 300) });
            const session = kg.openSession('eval', 'generate');
            const { drafts, dropped } = await generateQuestions(kg.llmFor(session, kg.services.llm)!, chunks, groups, { ...GENERATE_SETTINGS, model: kg.config.llm.model });
            const questions = drafts.map((d, i) => ({ ...d, id: `q${i + 1}` }));
            const set: EvalSet = { id: evalSetId(questions), name: v.name ?? 'generated', genRecipeId: null, questions };
            writeFileSync(file, JSON.stringify(set, null, 1));
            io.out(`${questions.length} questions written to ${file}; ${dropped.length} drafts dropped (${[...new Set(dropped.map((d) => d.reason))].join(', ') || 'none'})`);
            return 0;
          }
          if (sub === 'run') {
            const set = JSON.parse(readFileSync(file, 'utf8')) as EvalSet;
            const ks = (v.ks ?? '1,5').split(',').map(Number);
            const { runId, summary } = await runEval(kg, set, { conditions: (v.conditions ?? (v['retrieval-only'] ? 'retrieved' : 'no-context,gold,retrieved')).split(','), ks, retrievalOnly: v['retrieval-only'] });
            const s = summary as { byCondition: Record<string, { scored: number; failed: number; judge: number | null; retrieval?: { overall: { recall: Record<string, number> } } }>; orphaned: unknown[] };
            io.out(`run ${runId} on index ${kg.index.indexId}, ${set.questions.length} questions`);
            for (const [c, e] of Object.entries(s.byCondition)) io.out(`  ${c.padEnd(22)} judge ${e.judge === null ? '—' : e.judge.toFixed(2)}  scored ${e.scored} failed ${e.failed}${e.retrieval ? '  recall ' + ks.map((k) => `@${k} ${e.retrieval!.overall.recall[String(k)]!.toFixed(2)}`).join(' ') : ''}`);
            if (s.orphaned.length) io.out(`  ${s.orphaned.length} questions name chunks that are not in this index`);
            return 0;
          }
          throw new KgError('invalid_input', 'usage: eval generate <out.json> | eval run <set.json>');
        });

      case 'serve': {
        const kg = open({ ...base, create: false });
        if (rest[0] === 'mcp') {
          if (v.watch) {
            watchSources(
              kg,
              async () => {
                const r = await ingest(kg, { sidecar, artifactDirs });
                const changed = r.documents.filter((d) => !d.unchanged).length;
                if (changed || r.retired.length) io.err(`[kg] sources re-read: ${changed} documents changed, ${r.retired.length} retired, ${r.facts} new facts`);
              },
              { debounceMs: v['debounce-ms'] === undefined ? undefined : num(v['debounce-ms'], 1500), log: (l) => io.err(`[kg] ${l}`) },
            );
          }
          await serveStdio(kg);
          return await new Promise<number>(() => undefined);
        }
        if (rest[0] === 'viewer') {
          const server = createViewerServer(kg);
          const port = num(v.port, 4319);
          await new Promise<void>((done) => server.listen(port, '127.0.0.1', done));
          io.out(`viewer at http://127.0.0.1:${port}/ (database ${kg.dir}); Ctrl-C stops it`);
          return await new Promise<number>(() => undefined);
        }
        kg.close();
        throw new KgError('invalid_input', 'usage: serve mcp | serve viewer');
      }

      default:
        io.err(`unknown command ${cmd}\n${USAGE}`);
        return 2;
    }
  } catch (e) {
    io.err(e instanceof KgError ? `${e.code}: ${e.message}` : e instanceof Error ? (e.stack ?? e.message) : String(e));
    return 1;
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main(process.argv.slice(2)).then((c) => process.exit(c));
}
