import { expect } from 'vitest';
import { canonicalJson, parseArtifactSchema, type DocKey, type Json, type ParseRecipeSpec, type Parser } from '@kg/core';
import { expectKgError, type Suite } from './harness';

export interface ParserHarness {
  parser: Parser;
  /** source files the parser can parse under `recipe` */
  sources: { path: string; docKey: DocKey }[];
  recipe: ParseRecipeSpec;
  /** artifact files readArtifact can read */
  artifactPaths: string[];
  /** a path that does not exist */
  missingPath: string;
}

export function parserConformance(make: () => ParserHarness | Promise<ParserHarness>): Suite {
  const parseFirst = async (h: ParserHarness) => {
    const s = h.sources[0]!;
    const id = await h.parser.identify(s.path);
    return { id, a: await h.parser.parse({ path: s.path, docKey: s.docKey, sha256: id.sha256 }, h.recipe) };
  };
  return {
    name: 'parserConformance',
    cases: [
      {
        name: 'identify returns a sha256 hex digest and the source file name',
        async run() {
          const h = await make();
          const id = await h.parser.identify(h.sources[0]!.path);
          expect(id.sha256).toMatch(/^[0-9a-f]{64}$/);
          expect(id.sourceName.length).toBeGreaterThan(0);
        },
      },
      {
        name: 'parse returns an envelope that validates against parseArtifactSchema',
        async run() {
          const { a } = await parseFirst(await make());
          const r = parseArtifactSchema.safeParse(a);
          expect(r.success, r.success ? '' : r.error.message).toBe(true);
        },
      },
      {
        name: "the artifact's sourceSha256 equals the identified sha256",
        async run() {
          const { id, a } = await parseFirst(await make());
          expect(a.sourceSha256).toBe(id.sha256);
        },
      },
      {
        name: 'the requested recipe is echoed verbatim (Rule 4: the artifact records exactly what produced it)',
        async run() {
          const h = await make();
          const { a } = await parseFirst(h);
          expect(canonicalJson(a.recipe as unknown as Json)).toBe(canonicalJson(h.recipe as unknown as Json));
        },
      },
      {
        name: 'parsing the same source twice gives a deep-equal document',
        async run() {
          const h = await make();
          const x = await parseFirst(h);
          const y = await parseFirst(h);
          expect(canonicalJson(x.a.document as Json)).toBe(canonicalJson(y.a.document as Json));
        },
      },
      {
        name: 'readArtifact returns a valid artifact for each artifact file',
        async run() {
          const h = await make();
          for (const p of h.artifactPaths) expect(parseArtifactSchema.safeParse(await h.parser.readArtifact(p)).success).toBe(true);
        },
      },
      {
        name: 'a missing path rejects with a KgError',
        async run() {
          const h = await make();
          await expectKgError(() => h.parser.identify(h.missingPath));
          await expectKgError(() => h.parser.readArtifact(h.missingPath));
        },
      },
    ],
  };
}
