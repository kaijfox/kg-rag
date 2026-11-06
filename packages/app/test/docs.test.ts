/**
 * The documents are checked against the code: every `kg` command and option they show exists, every machine they list is
 * registered (and every registered machine is listed), and every file path they name is there. A document that has drifted
 * from the code fails here instead of misleading the next reader.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createRegistry } from '@kg/modules';
import { COMMANDS, OPTION_NAMES, SUBCOMMANDS } from '../src';

const ROOT = resolve(__dirname, '../../..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const packageDirs = ['kernel', 'modules', 'eval', 'app'];
const documents: { file: string; packageDir?: string }[] = [
  { file: 'CLAUDE.md' },
  { file: 'README.md' },
  { file: 'design/architecture.md' },
  { file: 'CHANGELOG.md' },
  ...readdirSync(join(ROOT, 'docs/beta')).filter((f) => f.endsWith('.md')).map((f) => ({ file: `docs/beta/${f}` })),
  ...packageDirs.map((d) => ({ file: `packages/${d}/README.md`, packageDir: `packages/${d}` })),
];

/** Inline code spans and the lines of fenced blocks, kept apart because only spans are checked as paths. */
function code(text: string): { spans: string[]; lines: string[] } {
  const spans: string[] = [];
  const lines: string[] = [];
  let fenced = false;
  for (const line of text.split('\n')) {
    if (/^\s*```/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) lines.push(line);
    else for (const m of line.matchAll(/`([^`]+)`/g)) spans.push(m[1]!);
  }
  return { spans, lines };
}

const KG_CALL = /(?:^|[\s$`(])(?:\S*\/)?kg ([a-z][a-z-]*)(?: ([a-z][a-z-]*))?/g;

function findUnder(dir: string, name: string): boolean {
  for (const n of readdirSync(dir)) {
    if (n === 'node_modules' || n.startsWith('.')) continue;
    const p = join(dir, n);
    if (n === name) return true;
    if (statSync(p).isDirectory() && findUnder(p, name)) return true;
  }
  return false;
}

describe('the documents match the code', () => {
  for (const doc of documents) {
    describe(doc.file, () => {
      const text = read(doc.file);
      const { spans, lines } = code(text);
      const commandTexts = [...spans, ...lines];

      it('shows only kg commands, subcommands and options that exist', () => {
        const problems: string[] = [];
        for (const t of commandTexts) {
          const calls = [...t.matchAll(KG_CALL)];
          if (calls.length === 0) continue;
          for (const m of calls) {
            const [, cmd, sub] = m;
            if (!(COMMANDS as readonly string[]).includes(cmd!)) {
              problems.push(`"${t.trim()}" uses the command ${cmd}`);
              continue;
            }
            const allowed = SUBCOMMANDS[cmd!];
            if (allowed && sub && !allowed.includes(sub)) problems.push(`"${t.trim()}" uses ${cmd} ${sub}`);
          }
          for (const f of t.matchAll(/(?:^|\s)--([a-z][a-z-]*)/g)) if (!OPTION_NAMES.includes(f[1]!)) problems.push(`"${t.trim()}" uses the option --${f[1]}`);
        }
        expect(problems).toEqual([]);
      });

      it('names only files and folders that exist', () => {
        const missing: string[] = [];
        const allowedOutputs = [/^\.git\//, /^build\//, /^kg-data/, /^artifacts\//, /^node_modules\//];
        for (const s of spans) {
          if (/[<>*~\s:]/.test(s) || s.startsWith('@')) continue;
          if (/^[\w.@-]+(\/[\w.@-]+)+\/?$/.test(s)) {
            if (allowedOutputs.some((r) => r.test(s))) continue;
            const places = [doc.packageDir ? join(ROOT, doc.packageDir, s) : null, join(ROOT, s)].filter((x): x is string => x !== null);
            if (!places.some(existsSync)) missing.push(s);
          } else if (doc.packageDir && /^[\w-]+\.(ts|mts|md|json|html)$/.test(s)) {
            if (!findUnder(join(ROOT, doc.packageDir), s)) missing.push(s);
          }
        }
        expect(missing).toEqual([]);
      });
    });
  }

  it('lists exactly the registered machines in the architecture document', () => {
    const registered = [...createRegistry().machines.keys()].sort();
    const text = read('design/architecture.md');
    const table = text.split('\n').filter((l) => /^\| `[a-z-]+`/.test(l) || /^\| `[a-z-]+` \(default\)/.test(l));
    const listed = table.map((l) => /^\| `([a-z-]+)`/.exec(l)![1]!).sort();
    expect(listed).toEqual(registered);
  });

  it('keeps the design archive and the decision log free of numbered labels in new documents', () => {
    for (const doc of documents) expect(read(doc.file), doc.file).not.toMatch(/\b(?:D\d{1,2}|Q\d{1,2}|S-\d+|R-\d+)\b(?!\.\d)/);
  });
});
