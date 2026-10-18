import { describe, expect, it } from 'vitest';
import { KgError, asDocKey, normText, type ChunkDraft } from '@kg/core';
import { miniArtifact } from '@kg/testkit';
import { renderChunkView, sectionPack } from '../src/index';
import { artifactOf, docKey, recipe, type Item } from './docs';

const PV = 'PV = NkT';
const rendered = (items: Item[], view: 'placeholder' | 'full' = 'placeholder') => {
  const art = artifactOf(items);
  const chunks = sectionPack(art, docKey, recipe);
  return { art, chunks, out: chunks.map((c) => renderChunkView(art, c.blockRefs, c.text, view)) };
};

function expectInvalid(fn: () => unknown): void {
  let err: unknown;
  try {
    fn();
  } catch (e) {
    err = e;
  }
  expect(err).toBeInstanceOf(KgError);
  expect((err as KgError).code).toBe('invalid_input');
}

describe('renderChunkView: full view', () => {
  it('returns the stored chunk text unchanged', () => {
    const { art, chunks } = rendered([
      { label: 'text', text: 'Before the law.' },
      { label: 'formula', text: PV },
    ]);
    for (const c of chunks) expect(renderChunkView(art, c.blockRefs, c.text, 'full')).toBe(c.text);
  });
});

describe('renderChunkView: placeholder view, documents without formula blocks', () => {
  it('leaves chunk text unchanged when the chunk has no formula block', () => {
    const art = miniArtifact(1, 'entropy');
    const chunks = sectionPack(art, asDocKey('entropy'), recipe);
    expect(chunks.length).toBeGreaterThan(0);
    for (const c of chunks) expect(renderChunkView(art, c.blockRefs, c.text, 'placeholder')).toBe(c.text);
  });
});

describe('renderChunkView: placeholder view, undecoded formula blocks', () => {
  it('a mini-corpus chunk with an undecoded formula renders the same text (the formula is already [formula])', () => {
    const art = miniArtifact(1, 'gas');
    const chunks = sectionPack(art, asDocKey('gas'), recipe);
    const withFormula = chunks.filter((c) => c.text.includes('[formula]'));
    expect(withFormula.length).toBe(1);
    for (const c of chunks) expect(renderChunkView(art, c.blockRefs, c.text, 'placeholder')).toBe(c.text);
  });
});

describe('renderChunkView: placeholder view, decoded formula blocks', () => {
  it('replaces a decoded formula with [formula] and keeps the prose', () => {
    const { art, chunks, out } = rendered([
      { label: 'text', text: 'The ideal gas law reads as follows.' },
      { label: 'formula', text: PV },
      { label: 'text', text: 'Here N is the number of molecules.' },
    ]);
    expect(chunks.length).toBe(1);
    expect(chunks[0]!.text).toBe(['The ideal gas law reads as follows.', PV, 'Here N is the number of molecules.'].join('\n\n'));
    expect(out[0]).toBe(['The ideal gas law reads as follows.', '[formula]', 'Here N is the number of molecules.'].join('\n\n'));
    expect(out).toHaveLength(chunks.length);
    expect(art.document).toBeDefined();
  });

  it('a formula text repeated in prose after it is not touched', () => {
    const { out } = rendered([
      { label: 'formula', text: PV },
      { label: 'text', text: `In prose the law is written ${PV} and that is all.` },
    ]);
    expect(out[0]).toBe(`[formula]\n\nIn prose the law is written ${PV} and that is all.`);
  });

  it('a prose occurrence before the formula, inside a longer block, is not replaced', () => {
    const { out } = rendered([
      { label: 'text', text: `Write ${PV} in prose first.` },
      { label: 'formula', text: PV },
    ]);
    expect(out[0]).toBe(`Write ${PV} in prose first.\n\n[formula]`);
  });

  it('two formulas in one chunk are replaced in order, each found after the previous match', () => {
    const { out } = rendered([
      { label: 'formula', text: 'E = mc^2' },
      { label: 'text', text: 'and' },
      { label: 'formula', text: 'E = mc^2' },
    ]);
    expect(out[0]).toBe('[formula]\n\nand\n\n[formula]');
  });

  it('a formula block whose text is missing from the chunk text is an invalid_input error', () => {
    const { art, chunks } = rendered([
      { label: 'text', text: 'Some prose.' },
      { label: 'formula', text: PV },
    ]);
    const c: ChunkDraft = chunks[0]!;
    expectInvalid(() => renderChunkView(art, c.blockRefs, 'Some prose.', 'placeholder'));
  });

  it('a formula found only before the end of the previous match is an invalid_input error (order matters)', () => {
    const art = artifactOf([
      { label: 'formula', text: 'x = 1' },
      { label: 'formula', text: 'y = 2' },
    ]);
    // the stored text has the formulas in the opposite order: the second one cannot be found after the first
    expectInvalid(() => renderChunkView(art, ['#/texts/0', '#/texts/1'], 'y = 2\n\nx = 1', 'placeholder'));
  });

  it('an unknown view or an unresolvable ref is invalid_input', () => {
    const art = artifactOf([{ label: 'text', text: 'hello' }]);
    expectInvalid(() => renderChunkView(art, ['#/texts/0'], 'hello', 'bogus' as 'full'));
    expectInvalid(() => renderChunkView(art, ['#/texts/9'], 'hello', 'placeholder'));
  });
});

describe('decoded formulas do not move chunk boundaries (placeholder measure)', () => {
  const prose = (i: number) => `Sentence number ${i} is a plain line of prose that fills the section for the packing test.`;
  const items = (decoded: string): Item[] => [
    { label: 'section_header', text: 'Section', level: 1 },
    ...Array.from({ length: 6 }, (_, i) => ({ label: 'text', text: prose(i) })),
    { label: 'formula', text: decoded },
    ...Array.from({ length: 6 }, (_, i) => ({ label: 'text', text: prose(i + 6) })),
  ];

  it('same block refs and same chunk count whether the formula is decoded or not', () => {
    const plain = sectionPack(artifactOf(items('')), docKey, recipe);
    const decoded = sectionPack(artifactOf(items(`\\frac{a}{b} ${'y'.repeat(900)}`)), docKey, recipe);
    expect(decoded.map((c) => c.blockRefs)).toEqual(plain.map((c) => c.blockRefs));
    expect(decoded.map((c) => c.sectionPath)).toEqual(plain.map((c) => c.sectionPath));
  });

  it('a decoded formula longer than maxChars is never split and is rendered as [formula]', () => {
    const big = 'z = ' + 'a+'.repeat(1000) + 'a';
    const { chunks, out } = rendered(items(big));
    const owners = chunks.filter((c) => c.text.includes(big));
    expect(owners.length).toBe(1);
    expect(normText(owners[0]!.text).length).toBeGreaterThan(recipe.spec.maxChars);
    expect(out.join('\n')).not.toContain(big);
    expect(out.join('\n')).toContain('[formula]');
  });
});
