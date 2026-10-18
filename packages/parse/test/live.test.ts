import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { asDocKey, parseArtifactSchema, type ParseRecipeSpec } from '@kg/core';
import { SubprocessParser } from '../src/index';

// Needs a real kg-parse on PATH (packages/parse-sidecar, docling 2.140.0). Skipped unless KG_SIDECAR=1.
const live = process.env.KG_SIDECAR === '1' ? describe : describe.skip;

live('SubprocessParser against the real sidecar', () => {
  it('parses the tiny fixture PDF into a valid artifact', async () => {
    const path = fileURLToPath(new URL('../../testkit/fixtures/parse/tiny.pdf', import.meta.url));
    const recipe: ParseRecipeSpec = {
      kind: 'parse',
      version: '1',
      spec: { parser: 'docling', doclingVersion: '2.140.0', options: { do_ocr: false, do_table_structure: true, do_formula_enrichment: false } },
    };
    const parser = new SubprocessParser();
    const id = await parser.identify(path);
    const a = await parser.parse({ path, docKey: asDocKey('tiny'), sha256: id.sha256 }, recipe);
    expect(parseArtifactSchema.safeParse(a).success).toBe(true);
    expect(a.sourceSha256).toBe(id.sha256);
  });
});
