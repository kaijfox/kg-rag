/** Repository-level checks that dependency-cruiser cannot express. */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = new URL('../../', import.meta.url).pathname;
const pkgs = readdirSync(ROOT).filter((d) => existsSync(join(ROOT, d, 'package.json')));

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : [];
  });
}

describe('architecture', () => {
  it('package.json: only app depends on siblings; others on @kg/core, search/ingest/eval also on @kg/pipeline, and on @kg/testkit as a devDependency', () => {
    for (const p of pkgs) {
      const j = JSON.parse(readFileSync(join(ROOT, p, 'package.json'), 'utf8')) as { name: string; dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
      if (j.name === '@kg/app') continue;
      const deps = Object.keys(j.dependencies ?? {}).filter((d) => d.startsWith('@kg/'));
      const dev = Object.keys(j.devDependencies ?? {}).filter((d) => d.startsWith('@kg/'));
      const allowedDeps = ['@kg/core', ...(['@kg/search', '@kg/ingest', '@kg/eval'].includes(j.name) ? ['@kg/pipeline'] : [])];
      expect(deps.filter((d) => !allowedDeps.includes(d)), `${j.name} dependencies`).toEqual([]);
      expect(dev.filter((d) => d !== '@kg/testkit'), `${j.name} devDependencies`).toEqual([]);
      if (j.name === '@kg/core') expect([...deps, ...dev]).toEqual([]);
    }
  });
  it('EventLog.append is called only by core runTool (log implementations and broken fakes excepted)', () => {
    const allowed = [/core\/src\/runTool\.ts$/, /testkit\/src\/fakes\/eventlog\.ts$/, /testkit\/src\/broken\//, /testkit\/src\/conformance\/eventlog\.ts$/];
    const offenders: string[] = [];
    for (const p of pkgs)
      for (const f of walk(join(ROOT, p, 'src'))) {
        if (allowed.some((r) => r.test(f))) continue;
        if (/\.append\(/.test(readFileSync(f, 'utf8'))) offenders.push(f.replace(ROOT, ''));
      }
    expect(offenders).toEqual([]);
  });
});
