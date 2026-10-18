import { describe, expect, it } from 'vitest';
import { KgError, type ChunkRecipeSpec } from '@kg/core';
import { renderChunkView, sectionPack } from '../src/index';
import { artifactOf, artifactWith, docKey, inlineGroupArtifact, recipe, type Item } from './docs';

const recipeOf = (targetChars: number, maxChars: number, minChars: number): ChunkRecipeSpec => ({
  ...recipe,
  spec: { algorithm: 'section-pack/1', targetChars, maxChars, minChars },
});
const run = (lens: number[], r: ChunkRecipeSpec) =>
  sectionPack(artifactOf(lens.map((n) => ({ label: 'text', text: 'a'.repeat(n) }))), docKey, r).map((c) => c.text.split('\n\n').map((t) => t.length));

// T=100, M=150, m=20: a join of lengths a and b is a + 2 + b
const R = recipeOf(100, 150, 20);

describe('packing boundaries (rule 4)', () => {
  it('appends when the joined length is exactly T, closes at T+1', () => {
    expect(run([49, 49], R)).toEqual([[49, 49]]);
    expect(run([49, 50], R)).toEqual([[49], [50]]);
  });

  it('a chunk below m takes a block up to exactly M, not beyond', () => {
    expect(run([10, 138], R)).toEqual([[10, 138]]);
    expect(run([10, 139], R)).toEqual([[10], [139]]);
  });

  it('a chunk of exactly m no longer takes a block past T; m-1 does', () => {
    expect(run([19, 100], R)).toEqual([[19, 100]]);
    expect(run([20, 100], R)).toEqual([[20], [100]]);
  });
});

describe('final merge (rule 5)', () => {
  it('merges a last chunk below m into the previous one', () => {
    expect(run([100, 19], R)).toEqual([[100, 19]]);
  });

  it('does not merge a last chunk of exactly m', () => {
    expect(run([100, 20], R)).toEqual([[100], [20]]);
  });

  it('measures the last chunk with 2 per join', () => {
    // [9, 9] is 20 long (not 18), so it is not below m
    expect(run([100, 9, 9], R)).toEqual([[100], [9, 9]]);
  });

  it('merges only when the result is at most M', () => {
    const r = recipeOf(100, 110, 20);
    expect(run([100, 8], r)).toEqual([[100, 8]]);
    expect(run([100, 9], r)).toEqual([[100], [9]]);
  });

  it('a section with one short chunk is left alone', () => {
    expect(run([5], R)).toEqual([[5]]);
  });

  it('merges the last two chunks only, and only within a section', () => {
    const art = artifactOf([
      { label: 'section_header', text: 'A', level: 1 },
      { label: 'text', text: 'a'.repeat(100) },
      { label: 'section_header', text: 'B', level: 1 },
      { label: 'text', text: 'b'.repeat(5) },
    ]);
    expect(sectionPack(art, docKey, R).map((c) => c.sectionPath.join('/'))).toEqual(['A', 'B']);
  });
});

describe('walk details', () => {
  it('sorts pages, de-duplicates block refs and keeps the page of every block', () => {
    const r = recipeOf(200, 50, 10);
    const long = 'First sentence is here. Second sentence is here. Third sentence is here.';
    const chunks = sectionPack(artifactOf([{ label: 'text', text: long, page: 3 }, { label: 'text', text: 'Other.', page: 1 }, { label: 'text', text: 'More.', page: 2 }]), docKey, r);
    expect(chunks[0]!.blockRefs.filter((x) => x === '#/texts/0')).toHaveLength(1);
    const all = chunks.flatMap((c) => c.pages);
    expect(all).toContain(3);
    const merged = sectionPack(artifactOf([{ label: 'text', text: 'x', page: 10 }, { label: 'text', text: 'y', page: 2 }, { label: 'text', text: 'z', page: 9 }]), docKey, recipe);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.pages).toEqual([2, 9, 10]);
  });

  it('visits a ref listed twice once', () => {
    const art = artifactWith({
      body: { children: [{ $ref: '#/texts/0' }, { $ref: '#/texts/0' }] },
      texts: [{ self_ref: '#/texts/0', label: 'text', text: 'Only once.', prov: [{ page_no: 1 }] }],
    });
    expect(sectionPack(art, docKey, recipe).map((c) => c.text)).toEqual(['Only once.']);
  });

  it('skips non-body layers whatever the label', () => {
    const items: Item[] = [{ label: 'text', text: 'Kept.' }];
    const art = artifactOf(items);
    const doc = art.document as unknown as { texts: Record<string, unknown>[]; body: { children: { $ref: string }[] } };
    doc.texts.push({ self_ref: '#/texts/1', label: 'text', text: 'Running header', content_layer: 'furniture', prov: [] });
    doc.body.children.push({ $ref: '#/texts/1' });
    expect(sectionPack(art, docKey, recipe).map((c) => c.text)).toEqual(['Kept.']);
  });

  it('drops blocks that are only whitespace, and keeps a whitespace-only formula as [formula]', () => {
    const chunks = sectionPack(artifactOf([{ label: 'text', text: ' \n\t ' }, { label: 'formula', text: '  ' }, { label: 'text', text: 'After.' }]), docKey, recipe);
    expect(chunks.map((c) => c.text)).toEqual(['[formula]\n\nAfter.']);
  });

  it('rejects refs that are not plain collection indices with invalid_input', () => {
    for (const ref of ['#/texts/01', '#/texts/1x', '#/other/0', 'texts/0']) {
      const art = artifactWith({ body: { children: [{ $ref: ref }] }, texts: [{ self_ref: '#/texts/0', label: 'text', text: 'x' }, { self_ref: '#/texts/1', label: 'text', text: 'y' }] });
      expect(() => sectionPack(art, docKey, recipe), ref).toThrow(KgError);
    }
  });

  it('a document without a body is invalid_input, not a TypeError', () => {
    for (const document of [{}, { body: null }, { texts: [] }]) {
      let err: unknown;
      try {
        sectionPack(artifactWith(document), docKey, recipe);
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(KgError);
      expect((err as KgError).code).toBe('invalid_input');
    }
  });
});

describe('inline groups', () => {
  const kids = [
    { label: 'text', text: 'The law' },
    { label: 'formula', text: 'PV = NkT' },
    { label: 'text', text: 'holds.' },
  ];

  it('joins the children with one space and records the group ref and every child ref', () => {
    const [c] = sectionPack(inlineGroupArtifact(kids), docKey, recipe);
    expect(c!.text).toBe('The law PV = NkT holds.');
    expect(c!.blockRefs).toEqual(['#/groups/0', '#/texts/0', '#/texts/1', '#/texts/2']);
  });

  it('an undecoded formula child reads [formula]', () => {
    const [c] = sectionPack(inlineGroupArtifact([kids[0]!, { label: 'formula', text: '' }, kids[2]!]), docKey, recipe);
    expect(c!.text).toBe('The law [formula] holds.');
  });

  it('renderChunkView no longer throws, and the decoded and undecoded views are the same text', () => {
    const decoded = inlineGroupArtifact(kids, { lead: 'Before.', trail: 'After.' });
    const plain = inlineGroupArtifact([kids[0]!, { label: 'formula', text: '' }, kids[2]!], { lead: 'Before.', trail: 'After.' });
    const view = (a: typeof decoded) => sectionPack(a, docKey, recipe).map((c) => renderChunkView(a, c.blockRefs, c.text, 'placeholder'));
    expect(view(decoded)).toEqual(['Before.\n\nThe law [formula] holds.\n\nAfter.']);
    expect(view(plain)).toEqual(view(decoded));
  });

  it('boundaries do not move between a decoded and an undecoded inline formula', () => {
    const big = 'z = ' + 'a+'.repeat(1000) + 'a';
    const mk = (f: string) => inlineGroupArtifact([kids[0]!, { label: 'formula', text: f }, kids[2]!], { lead: 'Before.' });
    const a = sectionPack(mk(''), docKey, recipe);
    const b = sectionPack(mk(big), docKey, recipe);
    expect(b.map((c) => c.blockRefs)).toEqual(a.map((c) => c.blockRefs));
    expect(b.map((c) => c.sectionPath)).toEqual(a.map((c) => c.sectionPath));
  });

  it('a piece of a split group that lacks the formula renders without error', () => {
    const r = recipeOf(60, 60, 5);
    const art = inlineGroupArtifact([
      { label: 'text', text: 'A fairly long opening sentence goes here for padding.' },
      { label: 'text', text: 'Another sentence follows it closely.' },
      { label: 'formula', text: 'E = mc^2' },
    ]);
    const chunks = sectionPack(art, docKey, r);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(() => renderChunkView(art, c.blockRefs, c.text, 'placeholder')).not.toThrow();
  });
});
