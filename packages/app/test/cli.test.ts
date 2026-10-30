import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const kg = (...args: string[]) => spawnSync(join(REPO, 'kg'), args, { encoding: 'utf8', cwd: REPO, env: { ...process.env, KG_DB: ':memory:' } });

describe('the kg command line', () => {
  it('--help prints the usage and exits 0', () => {
    const r = kg('--help');
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('serve mcp');
  });

  it('an unknown command and a missing argument exit 2 with the usage on stderr', () => {
    const unknown = kg('frobnicate');
    expect(unknown.status).toBe(2);
    expect(unknown.stderr).toContain('unknown command: frobnicate');
    const noQuery = kg('search');
    expect(noQuery.status).toBe(2);
    expect(noQuery.stderr).toContain('search needs a query');
  });

  it('a PDF with no cached artifact and no sidecar is refused with not_found and exits 1', () => {
    const r = kg('ingest', join(REPO, 'test/corpa/stat-mech/FoundationsKardar.pdf'), '--db', ':memory:', '--sidecar', 'none');
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('error not_found');
  });
});
