/**
 * Check of a code map on this repository, documentation only. TypeDoc builds an HTML site out of the doc comments, the plain
 * `html` adapter reads it, and twenty questions about this codebase, each with the file or files that answer it, are searched.
 * A search succeeds at k when one of the top k results is a page about an answering file. A page is matched to a file by the
 * module name in its page name (`classes/kg.Kg.html` belongs to `kg.ts`), so a few results can be credited to the wrong
 * package; the test is a rough check that the route works, not a precise measurement. The questions were written by the
 * author of the code, and the comments in this repository are uneven. Needs Ollama with embeddinggemma, and network access the
 * first time (it runs TypeDoc through npx). Nothing is answered or judged by a model.
 *
 *   node_modules/.bin/tsx experiments/code-map-selftest.mts
 *   TAG_MODULES=1 node_modules/.bin/tsx experiments/code-map-selftest.mts   # first adds @module to each file's top comment
 *
 * TypeDoc leaves out the comment at the top of a file unless it carries a @module tag, and in this repository that comment
 * holds the explanation of how the file works. TAG_MODULES=1 builds from a copy of the sources with the tag added, to show
 * how much of the result that explains.
 */
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, realpathSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { ingest } from '../packages/modules/src';
import { openKg } from '../packages/app/src';

const ROOT = resolve(import.meta.dirname, '..');
const K = 'packages/kernel/src/';
const M = 'packages/modules/src/';
const E = 'packages/eval/src/';
const A = 'packages/app/src/';

const QUESTIONS: { q: string; gold: string[] }[] = [
  { q: 'Where is the load-time check that every step of a machine has the inputs it needs?', gold: [K + 'machine.ts'] },
  { q: 'How is a chunk ID computed from its content?', gold: [K + 'ids.ts'] },
  { q: 'What refuses a derived item that cites no chunk?', gold: [K + 'indexStore.ts'] },
  { q: 'How does a rebuild swap the newly built index file in over the old one?', gold: [M + 'build.ts', K + 'kg.ts'] },
  { q: 'Where are model responses cached by a hash of the request?', gold: [K + 'cacheStore.ts', K + 'llm.ts'] },
  { q: 'How is a dated log entry linked to the earlier entry it replaces?', gold: [M + 'rules/replaces.ts', M + 'modules/ingest.ts'] },
  { q: 'Which checks cause an extracted fact to be rejected?', gold: [M + 'modules/extract.ts'] },
  { q: 'How does the MCP server record a tool call that failed?', gold: [A + 'mcp.ts'] },
  { q: 'How does the viewer read passage text after a rebuild swapped the index file?', gold: [A + 'viewer.ts'] },
  { q: 'How are evaluation questions checked for copying the wording of the passage?', gold: [E + 'generate.ts'] },
  { q: 'How is recall at k computed for an evaluation question?', gold: [E + 'metrics/recall.ts'] },
  { q: 'Where does a parsed PDF come from, and how are parsed documents kept?', gold: [M + 'parse/artifacts.ts'] },
  { q: 'How does the chunker pack blocks of a document into passages of about a thousand characters?', gold: [M + 'chunk/chunker.ts'] },
  { q: 'What steps does the baseline search machine run?', gold: [M + 'machines.ts', M + 'modules/search.ts'] },
  { q: 'How does the embedder refuse a model whose weights changed?', gold: [M + 'services/ollama.ts', K + 'embedder.ts'] },
  { q: 'How are corrections that a person confirmed replayed into a rebuilt index?', gold: [M + 'modules/ingest.ts'] },
  { q: 'Why can an event in the history not be edited or deleted?', gold: [K + 'historyStore.ts'] },
  { q: 'How does the runner stop a module from setting a result it did not declare?', gold: [K + 'runner.ts'] },
  { q: 'How does the command line add a source file to the database configuration?', gold: [A + 'cli.ts'] },
  { q: 'How are the passages next to a search hit found for adjacent expansion?', gold: [M + 'modules/search.ts', K + 'indexStore.ts'] },
];

const work = realpathSync(mkdtempSync(join(tmpdir(), 'kg-codemap-')));
try {
  // the documentation site, built from the doc comments (from a copy with @module tags when TAG_MODULES is set)
  let srcRoot = ROOT;
  if (process.env.TAG_MODULES) {
    srcRoot = join(work, 'copy');
    for (const p of ['kernel', 'modules', 'eval', 'app']) cpSync(join(ROOT, `packages/${p}/src`), join(srcRoot, `packages/${p}/src`), { recursive: true });
    const tag = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const f = join(dir, name);
        if (statSync(f).isDirectory()) tag(f);
        else if (f.endsWith('.ts')) {
          const t = readFileSync(f, 'utf8');
          const m = /^(#![^\n]*\n)?\/\*\*[\s\S]*?\n \*\//.exec(t);
          if (m) writeFileSync(f, t.replace(m[0], () => m[0].replace(/\n \*\/$/, '\n * @module\n */')));
        }
      }
    };
    tag(join(srcRoot, 'packages'));
  }
  const tsconfig = join(work, 'tsconfig.json');
  writeFileSync(tsconfig, JSON.stringify({ extends: join(ROOT, 'tsconfig.base.json'), include: [join(srcRoot, 'packages/*/src')] }));
  const site = join(work, 'site');
  execFileSync(
    'npx',
    ['--yes', 'typedoc@0.28.14', '--entryPoints', ...['kernel', 'modules', 'eval', 'app'].map((p) => `packages/${p}/src`), '--entryPointStrategy', 'expand', '--tsconfig', tsconfig, '--excludePrivate', 'false', '--skipErrorChecking', '--gitRemote', 'none', '--out', site],
    { cwd: srcRoot, stdio: process.env.VERBOSE ? 'inherit' : 'ignore' },
  );

  const build = async (name: string, path: string, adapter: string, exclude?: string) => {
    const kg = openKg({ db: join(work, name), create: true });
    kg.saveConfig({ sources: [{ path, adapter, ...(exclude ? { exclude } : {}) }] });
    const t0 = Date.now();
    const r = await ingest(kg, { sidecar: null });
    console.log(`${name}: ${r.stats.documents} documents, ${r.stats.currentChunks} passages, ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    return kg;
  };
  const docs = await build('docs', site, 'html', '(^|/)(assets|hierarchy|modules)(\\.html|/)|^index\\.html$');

  // TypeDoc names a page after its module with slashes turned into underscores: the page "classes › kernel_src_machine.Registry"
  // belongs to packages/kernel/src/machine.ts, whose module name is "kernel_src_machine".
  const moduleName = (file: string) => file.replace(/^packages\//, '').replace(/\.ts$/, '').replace(/\//g, '_');
  const fileOf = (c: { docKey?: string }, kind: 'docs' | 'raw'): string => {
    const key = (c.docKey ?? '').split(' › ');
    return kind === 'docs' ? (key[key.length - 1] ?? '').split('.')[0]! : key.join('/');
  };
  const matches = (found: string, gold: string[], kind: 'docs' | 'raw') => (kind === 'raw' ? gold.includes(found) : gold.some((g) => moduleName(g) === found));
  const ks = [1, 3, 5];
  for (const [name, kg, kind] of [['documentation site from doc comments', docs, 'docs'] as const]) {
    const s = kg.openSession('eval', 'code-map');
    const hits: Record<number, number> = { 1: 0, 3: 0, 5: 0 };
    const missed: string[] = [];
    let chars = 0;
    for (const { q, gold } of QUESTIONS) {
      const r = await kg.search({ query: q, k: 5, sessionId: s });
      const files = r.items.map((i) => fileOf(i, kind));
      chars += r.items.reduce((n, i) => n + i.text.length, 0);
      for (const k of ks) if (files.slice(0, k).some((f) => matches(f, gold, kind))) hits[k]!++;
      if (!files.some((f) => matches(f, gold, kind))) {
        missed.push(`${q}\n      wanted ${gold.map(moduleName).join(' or ')}\n      got    ${r.items.map((i) => i.docKey).join(' | ')}`);
      }
    }
    console.log(`\n${name}: top 1 ${hits[1]}/${QUESTIONS.length}, top 3 ${hits[3]}/${QUESTIONS.length}, top 5 ${hits[5]}/${QUESTIONS.length}`);
    console.log(`  text returned per search (top 5): ${Math.round(chars / QUESTIONS.length)} characters`);
    for (const m of missed) console.log(`  not in top 5: ${m}`);
    kg.close();
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
