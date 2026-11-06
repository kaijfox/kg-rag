#!/usr/bin/env tsx
/**
 * The kg command line. Run from anywhere in the repository as `./kg <command>`. `--db <dir>` (or KG_DB) names the
 * database directory; the default is ./kg-data.
 *
 *   init                         create a database directory
 *   add <file>...                add source files (--adapter docling-pdf|markdown|decision-log, --doc-key name)
 *   ingest [file...]             read new and changed sources into the current index
 *   rebuild [--keep-old] [--redo <module>]   build a new index from the sources and swap it in
 *   search "<query>" [-k n] [--machine name]
 *   status | machines | diff <other-index.sqlite>
 *   correct alias <name> <canonical> | correct replaces <newer-chunk> <older-chunk> | corrections | uncorrect <id>
 *   feedback <searchId> --relevance 0..1 [--item id] [--note text]
 *   eval generate <out.json> [--single n] [--multi n] [--topic n] [--seed n] [--min-chars n] [--name text]
 *   eval run <set.json> [--conditions a,b] [--ks 1,5]
 *   serve mcp | serve viewer [--port n]
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { IndexStore, KgError, normName, type Kg, type SourceEntry } from '@kg/kernel';
import { ingest, rebuild } from '@kg/modules';
import { GENERATE_SETTINGS, evalSetId, generateQuestions, pickGroups, runEval, type EvalSet } from '@kg/eval';
import { diffIndexes } from './diff';
import { callTool, serveStdio } from './mcp';
import { openKg, sidecarCommand } from './open';
import { createViewerServer } from './viewer';

export interface Io {
  out(s: string): void;
  err(s: string): void;
}
const stdio: Io = { out: (s) => process.stdout.write(s + '\n'), err: (s) => process.stderr.write(s + '\n') };

const USAGE = `usage: kg <command> [options]   (see the header of packages/app/src/cli.ts)
commands: init add ingest rebuild search status machines diff correct corrections uncorrect feedback eval serve
options:  --db <dir> --ollama-url <url> --sidecar <command|none> --artifacts <dir,dir>`;

const OPTIONS = {
  db: { type: 'string' },
  'ollama-url': { type: 'string' },
  sidecar: { type: 'string' },
  artifacts: { type: 'string' },
  adapter: { type: 'string' },
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
  help: { type: 'boolean', short: 'h' },
} as const;

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
      case 'init':
        return await use((kg) => (io.out(`database at ${kg.dir}\nadd sources with: kg add <file>...  then: kg ingest`), 0), true);

      case 'add':
        return await use((kg) => {
          if (rest.length === 0) throw new KgError('invalid_input', 'add needs at least one file');
          const sources = [...kg.config.sources];
          for (const f of rest) {
            const path = resolve(f);
            if (!existsSync(path)) throw new KgError('not_found', `no file ${path}`);
            const entry: SourceEntry = { path, ...(v.adapter ? { adapter: v.adapter } : {}), ...(v['doc-key'] && rest.length === 1 ? { docKey: v['doc-key'] } : {}) };
            const at = sources.findIndex((s) => s.path === path);
            if (at >= 0) sources[at] = entry;
            else sources.push(entry);
            io.out(`added ${path}`);
          }
          kg.saveConfig({ sources });
          return 0;
        }, true);

      case 'ingest':
        return await use(async (kg) => {
          const only: SourceEntry[] | undefined = rest.length ? rest.map((f) => kg.config.sources.find((s) => s.path === resolve(f)) ?? { path: resolve(f) }) : undefined;
          const r = await ingest(kg, { sources: only, sidecar, artifactDirs });
          for (const d of r.documents) io.out(`${d.docKey}: ${d.unchanged ? 'unchanged' : `${d.chunks} chunks`}`);
          io.out(`embedded ${r.embedded}, facts ${r.facts}, links ${r.links}; index ${r.indexId}`);
          return 0;
        });

      case 'rebuild':
        return await use(async (kg) => {
          const r = await rebuild(kg, { keepOld: v['keep-old'], redo: v.redo, sidecar, artifactDirs });
          io.out(`rebuilt ${r.previousIndexId} → ${r.report.indexId}${r.keptOld ? ` (old index kept at ${r.keptOld})` : ''}`);
          io.out(Object.entries(r.report.stats).map(([k, x]) => `${k} ${x}`).join(', '));
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
          io.out(`database   ${kg.dir}\nindex      ${kg.index.indexId}\nsources    ${kg.config.sources.length}\n${Object.entries(s).map(([k, x]) => `${k.padEnd(10)} ${x}`).join('\n')}`);
          const c = kg.cache.stats();
          io.out(`history    ${kg.history.sessions(1000).length} sessions, ${kg.history.corrections().length} confirmed corrections\ncache      ${c.entries} responses, ${(c.bytes / 1024).toFixed(0)} KB`);
          const problems = kg.index.audit();
          io.out(`audit      ${problems.length ? problems.join('; ') : 'clean'}`);
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
            const { runId, summary } = await runEval(kg, set, { conditions: (v.conditions ?? 'no-context,gold,retrieved').split(','), ks });
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
