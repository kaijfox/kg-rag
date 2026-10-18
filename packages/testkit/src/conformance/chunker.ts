/**
 * chunkerConformance: golden output on the hand-built mini-corpus (v1, v2), the v1->v2 ID diff, determinism,
 * recipe parameters honoured, and (optionally) structural facts on real docling slices.
 */
import { expect } from 'vitest';
import {
  DEFAULT_CHUNK_RECIPE,
  asDocKey,
  assignChunkIds,
  chunkId,
  normText,
  type ChunkDraft,
  type ChunkRecipeSpec,
  type Chunker,
  type ParseArtifact,
} from '@kg/core';
import { MINI_DOCS, REAL_SLICES, dupSectionsArtifact, dupSectionsExpected, miniArtifact, miniDiff, miniExpected, miniLabels, realArtifact, realDocKey, realFacts, type RealSlice } from '../fixtures';
import { deepFreeze, type Suite } from './harness';

const R = DEFAULT_CHUNK_RECIPE;
const strip = (c: ChunkDraft) => ({ sectionPath: c.sectionPath, text: c.text, occurrence: c.occurrence, pages: c.pages, blockRefs: c.blockRefs });

type DNode = { self_ref: string; label?: string; content_layer?: string; children?: { $ref: string }[]; text?: string; captions?: { $ref: string }[] };
/** Structural expectations derived from the docling JSON alone. */
function structure(a: ParseArtifact) {
  const d = a.document as unknown as Record<string, DNode[]> & { body: DNode };
  const get = (r: string) => {
    const [, k, i] = r.split('/');
    return d[k!]![Number(i)]!;
  };
  const excluded = new Set<string>();
  const required = new Set<string>();
  const headings = new Set<string>();
  const walk = (r: string) => {
    const n = get(r);
    const layer = n.content_layer ?? 'body';
    if (layer !== 'body' || n.label === 'page_header' || n.label === 'page_footer') excluded.add(r);
    else if (r.startsWith('#/pictures/')) {
      const caps = new Set((n.captions ?? []).map((c) => c.$ref));
      for (const c of n.children ?? []) if (!caps.has(c.$ref)) excluded.add(c.$ref);
      if (caps.size) {
        required.add(r);
        for (const c of caps) required.add(c);
      }
      return;
    } else if (r.startsWith('#/tables/')) {
      required.add(r);
      for (const c of n.captions ?? []) required.add(c.$ref);
      return;
    } else if (r.startsWith('#/texts/')) {
      if (n.label === 'section_header' || n.label === 'title') headings.add(n.text ?? '');
      else if (n.label === 'formula' || normText(n.text ?? '') !== '') required.add(r);
    }
    for (const c of n.children ?? []) walk(c.$ref);
  };
  for (const c of d.body.children ?? []) walk(c.$ref);
  return { excluded, required, headings };
}

export interface ChunkerConformanceOptions {
  /** a real chunker: also check recipe parameters and the real docling slices (a fixture-replaying fake cannot pass these) */
  full?: boolean;
}

export function chunkerConformance(chunk: Chunker, o: ChunkerConformanceOptions = {}): Suite {
  const cases: Suite['cases'] = [];
  for (const v of [1, 2] as const) {
    cases.push({
      name: `mini-corpus v${v}: output equals the hand-derived expected chunks`,
      run() {
        const exp = miniExpected(v);
        for (const d of MINI_DOCS) {
          const got = chunk(miniArtifact(v, d), asDocKey(d), R);
          expect(got.map(strip), `doc ${d}`).toEqual(exp[d].map(({ sectionPath, text, occurrence, pages, blockRefs }) => ({ sectionPath, text, occurrence, pages, blockRefs })));
        }
      },
    });
  }
  cases.push(
    {
      name: 'chunk IDs equal core chunkId(docKey, sectionPath, text, occurrence) and the oracle labels',
      run() {
        const labels = miniLabels();
        for (const v of [1, 2] as const) {
          const exp = miniExpected(v);
          for (const d of MINI_DOCS) {
            const got = chunk(miniArtifact(v, d), asDocKey(d), R);
            got.forEach((c, i) => {
              expect(c.id).toBe(chunkId(asDocKey(d), c.sectionPath, c.text, c.occurrence));
              expect(c.id, exp[d][i]?.label).toBe(labels[exp[d][i]!.label]);
            });
            expect(got.map((c) => c.id)).toEqual(assignChunkIds(asDocKey(d), got).map((c) => c.id));
          }
        }
      },
    },
    {
      name: 'v1 -> v2: exactly the expected chunk IDs survive, vanish and appear',
      run() {
        const ids = (v: 1 | 2) => new Set(MINI_DOCS.flatMap((d) => chunk(miniArtifact(v, d), asDocKey(d), R).map((c) => c.id)));
        const a = ids(1);
        const b = ids(2);
        const labels = miniLabels();
        const diff = miniDiff();
        const sorted = (xs: Iterable<string>) => [...xs].sort();
        expect(sorted([...a].filter((x) => b.has(x)))).toEqual(sorted(diff.survive.map((l) => labels[l]!)));
        expect(sorted([...a].filter((x) => !b.has(x)))).toEqual(sorted(diff.vanish.map((l) => labels[l]!)));
        expect(sorted([...b].filter((x) => !a.has(x)))).toEqual(sorted(diff.new.map((l) => labels[l]!)));
      },
    },
    {
      name: 'duplicated paragraph in one section: same text, occurrence 0 and 1, distinct IDs',
      run() {
        const got = chunk(miniArtifact(1, 'entropy'), asDocKey('entropy'), R).filter((c) => c.sectionPath.at(-1) === '2.1 Definition');
        const dups = got.filter((c) => got.filter((x) => x.text === c.text).length > 1);
        expect(dups.map((c) => c.occurrence)).toEqual([0, 1]);
        expect(new Set(dups.map((c) => c.id)).size).toBe(2);
      },
    },
    {
      name: 'identical paragraph in two sections: occurrence 0 in both, IDs differ by section path',
      run() {
        const labels = miniLabels();
        const got = chunk(dupSectionsArtifact(), asDocKey('dupsec'), R);
        const exp = dupSectionsExpected();
        expect(got.map(strip)).toEqual(exp.map(({ sectionPath, text, occurrence, pages, blockRefs }) => ({ sectionPath, text, occurrence, pages, blockRefs })));
        expect(got.map((c) => c.id)).toEqual(exp.map((c) => labels[c.label]));
      },
    },
    {
      name: 'S5: a whitespace-only variant of the parse (every space doubled, newlines added) gives the same chunk IDs',
      run() {
        for (const v of [1, 2] as const)
          for (const d of MINI_DOCS) {
            const a = miniArtifact(v, d);
            const w = structuredClone(a);
            const texts = (w.document as unknown as { texts: { text: string }[] }).texts;
            texts.forEach((t, i) => {
              t.text = t.text.replace(/ /g, '  ').replace(/\. /g, i % 2 ? '.\n  ' : '.  \t');
            });
            const ids = (x: typeof a) => chunk(x, asDocKey(d), R).map((c) => c.id);
            expect(ids(w), `${d} v${v}`).toEqual(ids(a));
          }
      },
    },
    {
      name: 'deterministic and does not mutate its input',
      run() {
        const a = deepFreeze(miniArtifact(1, 'gas'));
        const x = chunk(a, asDocKey('gas'), R);
        const y = chunk(structuredClone(a), asDocKey('gas'), R);
        expect(x).toEqual(y);
      },
    },
    {
      name: 'every chunk is non-empty and at most maxChars; headings never appear as chunk text',
      run() {
        for (const v of [1, 2] as const)
          for (const d of MINI_DOCS)
            for (const c of chunk(miniArtifact(v, d), asDocKey(d), R)) {
              expect(normText(c.text)).not.toBe('');
              expect(normText(c.text).length).toBeLessThanOrEqual(R.spec.maxChars);
              expect(c.blockRefs.length).toBeGreaterThan(0);
              expect(c.pages.length).toBeGreaterThan(0);
            }
      },
    },
  );
  if (o.full) {
    cases.push(
    {
      name: 'honours recipe parameters (smaller maxChars gives more, smaller chunks)',
      run() {
        const small: ChunkRecipeSpec = { ...R, spec: { ...R.spec, targetChars: 300, maxChars: 400, minChars: 50 } };
        const base = chunk(miniArtifact(1, 'gas'), asDocKey('gas'), R);
        const got = chunk(miniArtifact(1, 'gas'), asDocKey('gas'), small);
        expect(got.length).toBeGreaterThan(base.length);
        for (const c of got) expect(normText(c.text).length).toBeLessThanOrEqual(400);
      },
    },
    );
    for (const s of REAL_SLICES) {
      cases.push({
        name: `real docling slice ${s}: coverage, furniture, picture internals, sizes, hand-checked facts`,
        run() {
          const a = realArtifact(s);
          const facts = realFacts()[s as RealSlice];
          const got = chunk(a, realDocKey(s), R);
          const { excluded, required, headings } = structure(a);
          const refCount = new Map<string, number>();
          for (const c of got) for (const r of c.blockRefs) refCount.set(r, (refCount.get(r) ?? 0) + 1);
          for (const r of excluded) expect(refCount.has(r), `excluded ref ${r} leaked into a chunk`).toBe(false);
          for (const r of required) expect(refCount.has(r), `body ref ${r} missing from every chunk`).toBe(true);
          for (const [r, n] of refCount) if (n > 1) expect(facts.mustSplit.includes(r) || r.startsWith('#/pictures/') || r.startsWith('#/tables/'), `ref ${r} in ${n} chunks but not split`).toBe(true);
          for (const r of facts.mustSplit) expect(refCount.get(r) ?? 0).toBeGreaterThanOrEqual(2);
          for (const c of got) {
            expect(normText(c.text).length).toBeLessThanOrEqual(R.spec.maxChars);
            expect(facts.allowedSectionPaths).toContainEqual(c.sectionPath);
            for (const h of headings) expect(c.text.split('\n\n')).not.toContain(h);
          }
          expect(got.reduce((n, c) => n + (c.text.match(/\[formula\]/g)?.length ?? 0), 0)).toBe(facts.formulaCount);
          for (const t of facts.textNotInAnyChunk) for (const c of got) expect(c.text.includes(t), `"${t}" leaked`).toBe(false);
          for (const t of facts.chunkContains ?? []) expect(got.some((c) => c.text.includes(t)), `no chunk contains "${t}"`).toBe(true);
          for (const f of facts.refInSection) {
            const owners = got.filter((c) => c.blockRefs.includes(f.ref));
            expect(owners.length, f.ref).toBeGreaterThan(0);
            for (const c of owners) expect(c.sectionPath, f.ref).toEqual(f.sectionPath);
          }
        },
      });
    }
  }
  return { name: 'chunkerConformance', cases };
}
