/**
 * Second documentation tool for the code-map route. pdoc builds an HTML site from the docstrings of the Python sidecar
 * (packages/parse-sidecar, 591 lines, about half of its functions without a docstring), the plain `html` adapter reads it,
 * and ten questions about the sidecar, each with the module that answers it, are searched. pdoc is run twice: with its default,
 * which puts each module's whole source into the page, and with --no-show-source. A search succeeds at k when one of the top k
 * results is a page about an answering module. Needs Ollama with embeddinggemma, uv, and network the first time.
 *
 *   node_modules/.bin/tsx experiments/code-map-pdoc.mts
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { ingest } from '../packages/modules/src';
import { openKg } from '../packages/app/src';

const ROOT = resolve(import.meta.dirname, '..');
const PKG = join(ROOT, 'packages/parse-sidecar');
const QUESTIONS: { q: string; gold: string[] }[] = [
  { q: 'Which exit code means the PDF differs from the one the artifact was made from?', gold: ['errors', 'cli'] },
  { q: 'How are the recipe options turned into docling pipeline options?', gold: ['recipe'] },
  { q: 'How is a recipe hashed so that the hash is stable?', gold: ['recipe'] },
  { q: 'How is one formula cropped out of a page before it is decoded?', gold: ['formulas'] },
  { q: 'What is removed from a decoder reply to leave bare LaTeX?', gold: ['formulas'] },
  { q: 'Which model decodes formulas and where does it load from?', gold: ['decoder'] },
  { q: 'How is the artifact file named?', gold: ['envelope'] },
  { q: 'How are characters per page counted for a parsed document?', gold: ['parse'] },
  { q: 'What does the sidecar check before it decodes formulas?', gold: ['formulas'] },
  { q: 'What happens when the installed docling version is not the one the recipe names?', gold: ['recipe', 'errors'] },
];
const work = realpathSync(mkdtempSync(join(tmpdir(), 'kg-pdoc-')));
try {
  for (const [name, extraArgs] of [['pdoc default (source blocks kept)', []], ['pdoc --no-show-source', ['--no-show-source']]] as const) {
    const site = join(work, name.replace(/\W+/g, '-'));
    execFileSync('uv', ['run', '--with', 'pdoc==15.0.4', 'pdoc', '-o', site, ...extraArgs, 'kg_parse'], { cwd: PKG, stdio: 'ignore' });
    const kg = openKg({ db: join(work, `db-${name.length}`), create: true });
    kg.saveConfig({ sources: [{ path: site, adapter: 'html', exclude: '^(index|search)\\.|\\.js$' }] });
    const r = await ingest(kg, { sidecar: null });
    const s = kg.openSession('eval', 'pdoc');
    const hits = { 1: 0, 3: 0, 5: 0 } as Record<number, number>;
    const missed: string[] = [];
    let chars = 0;
    for (const { q, gold } of QUESTIONS) {
      const res = await kg.search({ query: q, k: 5, sessionId: s, shadow: false });
      const mods = res.items.map((i) => ((i.docKey ?? '').split(' › ').pop() ?? '').replace(/\.html$/, '').split('/').pop()!);
      chars += res.items.reduce((n, i) => n + i.text.length, 0);
      for (const k of [1, 3, 5]) if (mods.slice(0, k).some((m) => gold.includes(m))) hits[k]!++;
      if (!mods.some((m) => gold.includes(m))) missed.push(`${q}\n      wanted ${gold.join(' or ')}; got ${res.items.map((i) => i.docKey).join(' | ')}`);
    }
    console.log(`\n${name}: ${r.stats.documents} pages, ${r.stats.currentChunks} passages; top 1 ${hits[1]}/10, top 3 ${hits[3]}/10, top 5 ${hits[5]}/10; ${Math.round(chars / QUESTIONS.length)} characters returned per search`);
    for (const m of missed) console.log(`  not in top 5: ${m}`);
    kg.close();
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
