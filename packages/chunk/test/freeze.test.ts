/** Freeze-time pins: each case fails if one token of the corresponding src behaviour changes (see scratch/notes/chunk-freeze-tests.md). */
import { describe, expect, it } from 'vitest';
import { KgError, type ChunkRecipeSpec } from '@kg/core';
import { sectionPack } from '../src/index';
import { splitBlock } from '../src/split';
import { artifactOf, artifactWith, docKey, inlineGroupArtifact, recipe } from './docs';

const rc = (t: number, m: number, n: number): ChunkRecipeSpec => ({ ...recipe, spec: { algorithm: 'section-pack/1', targetChars: t, maxChars: m, minChars: n } });
const lens = (ls: number[], r: ChunkRecipeSpec) =>
  sectionPack(artifactOf(ls.map((n) => ({ label: 'text', text: 'a'.repeat(n) }))), docKey, r).map((c) => c.text.split('\n\n').map((t) => t.length));

type N = Record<string, unknown>;
const t = (i: number, text: string, extra: N = {}): N => ({ self_ref: `#/texts/${i}`, label: 'text', text, prov: [{ page_no: 1 }], ...extra });
const docOf = (body: string[], texts: N[], more: N = {}) =>
  artifactWith({ body: { children: body.map(($ref) => ({ $ref })) }, texts, groups: [], tables: [], pictures: [], ...more });
const texts = (art: ReturnType<typeof docOf>, r = recipe) => sectionPack(art, docKey, r).map((c) => c.text);

// T=100, M=150, m=20 and a second parameter set, so the three comparisons are pinned at two different points
describe('packing boundaries at a second parameter set (T=50, M=80, m=10)', () => {
  const R = rc(50, 80, 10);
  it('T: joined length 50 packs, 51 closes', () => {
    expect(lens([24, 24], R)).toEqual([[24, 24]]);
    expect(lens([24, 25], R)).toEqual([[24], [25]]);
    expect(lens([24, 23], R)).toEqual([[24, 23]]);
  });
  it('M: a chunk below m takes a block up to joined 80, not 81', () => {
    expect(lens([9, 69], R)).toEqual([[9, 69]]);
    expect(lens([9, 70], R)).toEqual([[9], [70]]);
    expect(lens([9, 68], R)).toEqual([[9, 68]]);
  });
  it('m: a chunk of length 10 is not below m, 9 is', () => {
    expect(lens([10, 60], R)).toEqual([[10], [60]]);
    expect(lens([9, 60], R)).toEqual([[9, 60]]);
  });
  it('m is tested on the running chunk length with 2 per join, not on the sum of block lengths', () => {
    // [4,4] is 10 long (not 8): not below m, so the 60 does not join
    expect(lens([4, 4, 60], R)).toEqual([[4, 4], [60]]);
    // [4,3] is 9 long: below m, so the 60 joins (joined 71 <= M)
    expect(lens([4, 3, 60], R)).toEqual([[4, 3, 60]]);
  });
});

describe('final merge guard at a second parameter set', () => {
  const R = rc(50, 80, 10);
  it('last chunk 9 merges, 10 does not', () => {
    expect(lens([50, 9], R)).toEqual([[50, 9]]);
    expect(lens([50, 10], R)).toEqual([[50], [10]]);
  });
  it('merged length prev+2+last of exactly M merges, M+1 does not', () => {
    // prev 69 + 2 + last 9 = 80
    expect(lens([69, 50, 9], rc(60, 80, 10))).toEqual([[69], [50, 9]]);
    expect(lens([69, 9], rc(60, 80, 10))).toEqual([[69, 9]]);
    expect(lens([70, 9], rc(60, 80, 10))).toEqual([[70], [9]]);
  });
  it('the last chunk is measured with its joins: [4,4] (10 long) is not merged, [4,3] (9 long) is', () => {
    expect(lens([50, 4, 4], rc(50, 80, 10))).toEqual([[50], [4, 4]]);
    expect(lens([50, 4, 3], rc(50, 80, 10))).toEqual([[50, 4, 3]]);
  });
  it('the previous chunk is measured with its joins in the M test', () => {
    // prev [20,20] is 42 long; 42 + 2 + 9 = 53
    expect(lens([20, 20, 9], rc(42, 53, 10))).toEqual([[20, 20, 9]]);
    expect(lens([20, 20, 9], rc(42, 52, 10))).toEqual([[20, 20], [9]]);
  });
  it('only the last two chunks of a section can merge', () => {
    expect(lens([50, 20, 50, 5], rc(50, 80, 10))).toEqual([[50], [20], [50, 5]]);
  });
});

describe('page sort and dedup', () => {
  it('sorts numerically ascending (10 after 9) and removes duplicates across blocks', () => {
    const art = artifactOf([
      { label: 'text', text: 'x', page: 10 },
      { label: 'text', text: 'y', page: 2 },
      { label: 'text', text: 'z', page: 10 },
      { label: 'text', text: 'w', page: 9 },
      { label: 'text', text: 'v', page: 2 },
    ]);
    const [c, ...rest] = sectionPack(art, docKey, recipe);
    expect(rest).toEqual([]);
    expect(c!.pages).toEqual([2, 9, 10]);
  });
  it('a block with two prov entries on the same page lists the page once', () => {
    const art = docOf(['#/texts/0'], [t(0, 'x', { prov: [{ page_no: 4 }, { page_no: 4 }, { page_no: 3 }] })]);
    expect(sectionPack(art, docKey, recipe)[0]!.pages).toEqual([3, 4]);
  });
  it('pieces of one split block on one page give that page once', () => {
    const long = 'First sentence is here. Second sentence is here. Third sentence is here.';
    const art = artifactOf([{ label: 'text', text: long, page: 7 }]);
    const chunks = sectionPack(art, docKey, rc(200, 30, 5));
    expect(chunks.length).toBeGreaterThan(0);
    for (const c of chunks) expect(c.pages).toEqual([7]);
  });
  it('inline groups and table captions dedupe and sort their pages too', () => {
    const [g] = sectionPack(inlineGroupArtifact([{ label: 'text', text: 'a', page: 5 }, { label: 'text', text: 'b', page: 3 }, { label: 'text', text: 'c', page: 5 }]), docKey, recipe);
    expect(g!.pages).toEqual([3, 5]);
    const art = docOf(['#/tables/0'], [t(0, 'Cap', { prov: [{ page_no: 12 }] })], {
      tables: [{ self_ref: '#/tables/0', label: 'table', captions: [{ $ref: '#/texts/0' }], prov: [{ page_no: 12 }, { page_no: 2 }], data: { grid: [[{ text: 'c' }]] } }],
    });
    expect(sectionPack(art, docKey, recipe)[0]!.pages).toEqual([2, 12]);
  });
});

describe('block-ref dedup', () => {
  it('pieces of one split block packed in one chunk list its ref once, in order', () => {
    const long = 'First sentence is here. Second sentence is here. Third sentence is here.';
    const art = artifactOf([{ label: 'text', text: long }, { label: 'text', text: 'Other.' }]);
    const chunks = sectionPack(art, docKey, rc(500, 30, 5));
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.text.split('\n\n').length).toBeGreaterThan(2);
    expect(chunks[0]!.blockRefs).toEqual(['#/texts/0', '#/texts/1']);
  });
  it('a table caption listed in the table and its ref shared by the chunk appears once', () => {
    const art = docOf(['#/texts/1', '#/tables/0'], [t(0, 'Cap'), t(1, 'Lead')], {
      tables: [{ self_ref: '#/tables/0', label: 'table', captions: [{ $ref: '#/texts/0' }], prov: [], data: { grid: [[{ text: 'c' }]] } }],
    });
    expect(sectionPack(art, docKey, recipe)[0]!.blockRefs).toEqual(['#/texts/1', '#/tables/0', '#/texts/0']);
  });
});

describe('visited dedup', () => {
  it('a ref listed twice in body.children is emitted once', () => {
    expect(texts(docOf(['#/texts/0', '#/texts/1', '#/texts/0'], [t(0, 'One.'), t(1, 'Two.')]))).toEqual(['One.\n\nTwo.']);
  });
  it('a text child listed under its parent and again in body is emitted once', () => {
    const art = docOf(['#/texts/0', '#/texts/1'], [t(0, 'Parent.', { children: [{ $ref: '#/texts/1' }] }), t(1, 'Child.')]);
    expect(texts(art)).toEqual(['Parent.\n\nChild.']);
  });
  it('a group reached twice is walked once', () => {
    const art = docOf(['#/groups/0', '#/groups/0'], [t(0, 'In group.')], { groups: [{ self_ref: '#/groups/0', label: 'list', children: [{ $ref: '#/texts/0' }] }] });
    expect(texts(art)).toEqual(['In group.']);
  });
  it('a caption already emitted as body text is not emitted again by its table', () => {
    const art = docOf(['#/texts/0', '#/tables/0'], [t(0, 'Cap')], {
      tables: [{ self_ref: '#/tables/0', label: 'table', captions: [{ $ref: '#/texts/0' }], data: { grid: [[{ text: 'c' }]] } }],
    });
    expect(texts(art)).toEqual(['Cap\n\nc']);
  });
  it('a caption listed in body after its table is not emitted again; a caption shared by two tables appears once', () => {
    const tb = (i: number) => ({ self_ref: `#/tables/${i}`, label: 'table', captions: [{ $ref: '#/texts/0' }], data: { grid: [[{ text: `c${i}` }]] } });
    const art = docOf(['#/tables/0', '#/texts/0', '#/tables/1'], [t(0, 'Cap')], { tables: [tb(0), tb(1)] });
    expect(texts(art)).toEqual(['Cap\nc0\n\nc1']);
  });
  it('table and picture children are marked visited and not emitted when body lists them', () => {
    const art = docOf(['#/tables/0', '#/texts/0', '#/pictures/0', '#/texts/1'], [t(0, 'cell child'), t(1, 'fig label')], {
      tables: [{ self_ref: '#/tables/0', label: 'table', children: [{ $ref: '#/texts/0' }], data: { grid: [[{ text: 'c' }]] } }],
      pictures: [{ self_ref: '#/pictures/0', label: 'picture', children: [{ $ref: '#/texts/1' }] }],
    });
    expect(texts(art)).toEqual(['c']);
  });
  it('an inline group child listed again in body, or reached through a nested child, is not emitted twice', () => {
    const art = docOf(['#/groups/0', '#/texts/1'], [t(0, 'A', { children: [{ $ref: '#/texts/1' }] }), t(1, 'B')], {
      groups: [{ self_ref: '#/groups/0', label: 'inline', children: [{ $ref: '#/texts/0' }, { $ref: '#/texts/1' }] }],
    });
    const [c] = sectionPack(art, docKey, recipe);
    expect(c!.text).toBe('A B');
    expect(c!.blockRefs).toEqual(['#/groups/0', '#/texts/0', '#/texts/1']);
  });
});

describe('inline group join', () => {
  const g = (kids: { label?: string; text: string }[]) => inlineGroupArtifact(kids.map((k) => ({ label: k.label ?? 'text', text: k.text })));
  it('joins with exactly one space, not nothing or a newline', () => {
    expect(texts(g([{ text: 'a' }, { text: 'b' }, { text: 'c' }]))).toEqual(['a b c']);
  });
  it('children that are whitespace-only add no separator', () => {
    expect(texts(g([{ text: 'a' }, { text: '  ' }, { text: 'b' }, { text: '' }]))).toEqual(['a b']);
  });
  it('children keep their own inner and edge whitespace', () => {
    expect(texts(g([{ text: 'a ' }, { text: ' b' }]))).toEqual(['a   b']);
  });
  it('a group of only whitespace children yields no block', () => {
    expect(sectionPack(g([{ text: ' ' }]), docKey, recipe)).toEqual([]);
  });
  it('the group is measured at the placeholder length for a decoded formula (packs against T)', () => {
    // "ab [formula] cd" measures 2+1+9+1+2 = 15, whatever the decoded length
    const art = inlineGroupArtifact([{ label: 'text', text: 'ab' }, { label: 'formula', text: 'q'.repeat(400) }, { label: 'text', text: 'cd' }], { trail: 'b'.repeat(13) });
    expect(sectionPack(art, docKey, rc(30, 40, 5))).toHaveLength(1);
    const art2 = inlineGroupArtifact([{ label: 'text', text: 'ab' }, { label: 'formula', text: 'q'.repeat(400) }, { label: 'text', text: 'cd' }], { trail: 'b'.repeat(14) });
    expect(sectionPack(art2, docKey, rc(30, 40, 5))).toHaveLength(2);
  });
  it('a group measuring exactly maxChars through a decoded formula stays one block (measure, not text length)', () => {
    // 20 + 1 + 9 = 30 = M, while the decoded text is far longer
    const art = inlineGroupArtifact([{ label: 'text', text: 'a'.repeat(20) }, { label: 'formula', text: 'q'.repeat(400) }]);
    expect(texts(art, rc(1000, 30, 0))).toEqual(['a'.repeat(20) + ' ' + 'q'.repeat(400)]);
  });
  it('key_value_items / form_items children of an inline group are skipped, not resolved', () => {
    const art = docOf(['#/groups/0'], [t(0, 'a'), t(1, 'b')], {
      groups: [{ self_ref: '#/groups/0', label: 'inline', children: [{ $ref: '#/texts/0' }, { $ref: '#/key_value_items/0' }, { $ref: '#/form_items/0' }, { $ref: '#/texts/1' }] }],
    });
    const [c] = sectionPack(art, docKey, recipe);
    expect(c!.text).toBe('a b');
    expect(c!.blockRefs).toEqual(['#/groups/0', '#/texts/0', '#/texts/1']);
  });
  it('a group measuring exactly maxChars is one block; maxChars+1 is split', () => {
    const mk = (n: number) => inlineGroupArtifact([{ label: 'text', text: 'x'.repeat(10) }, { label: 'text', text: 'y'.repeat(n - 11) }]);
    expect(sectionPack(mk(30), docKey, rc(1000, 30, 0))).toHaveLength(1);
    expect(sectionPack(mk(31), docKey, rc(30, 30, 0))).toHaveLength(2);
  });
});

describe('furniture', () => {
  const doc = (extra: N) => docOf(['#/texts/0', '#/texts/1', '#/texts/2'], [t(0, 'Before.'), t(1, 'Skip me', extra), t(2, 'After.')]);
  it('page_header and page_footer are skipped by label whatever the content_layer', () => {
    for (const label of ['page_header', 'page_footer'])
      for (const layer of ['body', undefined, 'furniture'])
        expect(texts(doc({ label, ...(layer ? { content_layer: layer } : {}) })), `${label}/${layer}`).toEqual(['Before.\n\nAfter.']);
  });
  it('a furniture-layer block is skipped even when its label is text, section_header or title', () => {
    for (const label of ['text', 'section_header', 'title', 'footnote', 'list_item'])
      expect(texts(doc({ label, content_layer: 'furniture' })), label).toEqual(['Before.\n\nAfter.']);
  });
  it('a furniture section_header does not open a section', () => {
    const [c, ...rest] = sectionPack(doc({ label: 'section_header', content_layer: 'furniture', level: 1 }), docKey, recipe);
    expect(rest).toEqual([]);
    expect(c!.sectionPath).toEqual([]);
  });
  it('any non-body layer is skipped; an explicit body layer and a missing layer are kept', () => {
    expect(texts(doc({ content_layer: 'invisible' }))).toEqual(['Before.\n\nAfter.']);
    expect(texts(doc({ content_layer: 'body' }))).toEqual(['Before.\n\nSkip me\n\nAfter.']);
    expect(texts(doc({}))).toEqual(['Before.\n\nSkip me\n\nAfter.']);
  });
  it('a furniture group is skipped with its children', () => {
    const art = docOf(['#/groups/0', '#/texts/1'], [t(0, 'In furniture group.'), t(1, 'Kept.')], { groups: [{ self_ref: '#/groups/0', label: 'list', content_layer: 'furniture', children: [{ $ref: '#/texts/0' }] }] });
    expect(texts(art)).toEqual(['Kept.']);
  });
  it('furniture and header/footer children of an inline group are left out of the joined text and the refs', () => {
    const art = docOf(['#/groups/0'], [t(0, 'a'), t(1, 'hdr', { label: 'page_header' }), t(2, 'furn', { content_layer: 'furniture' }), t(3, 'b')], {
      groups: [{ self_ref: '#/groups/0', label: 'inline', children: [0, 1, 2, 3].map((i) => ({ $ref: `#/texts/${i}` })) }],
    });
    const [c] = sectionPack(art, docKey, recipe);
    expect(c!.text).toBe('a b');
    expect(c!.blockRefs).toEqual(['#/groups/0', '#/texts/0', '#/texts/3']);
  });
  it('furniture table and picture are skipped', () => {
    const art = docOf(['#/tables/0', '#/pictures/0', '#/texts/0'], [t(0, 'Kept.')], {
      tables: [{ self_ref: '#/tables/0', label: 'table', content_layer: 'furniture', data: { grid: [[{ text: 'c' }]] } }],
      pictures: [{ self_ref: '#/pictures/0', label: 'picture', content_layer: 'furniture', captions: [{ $ref: '#/texts/0' }] }],
    });
    expect(texts(art)).toEqual(['Kept.']);
  });
});

describe('sentence cuts: uppercase test', () => {
  const pad = 'x'.repeat(20);
  it('non-ASCII uppercase after the period and whitespace cuts there', () => {
    for (const up of ['É', 'Ä', 'Ж', 'Ω'])
      expect(splitBlock(`${pad}. ${up}abc def ghi`, 25), up).toEqual([`${pad}.`, `${up}abc def ghi`]);
  });
  it('a lowercase letter (ASCII or not), digit, quote or paren after the period does not cut: hard cut at the window', () => {
    for (const lo of ['a', 'é', 'ж', '1', '"', '(']) {
      const text = `${pad}. ${lo}bc def ghi jkl`;
      expect(splitBlock(text, 25)[0], lo).toBe(text.slice(0, 25));
    }
  });
  it('any whitespace run (newline, tab, several spaces) between the period and the capital cuts', () => {
    for (const ws of ['\n', '\t', '   ', ' \n\t ', '\u00a0'])
      expect(splitBlock(`${pad}.${ws}Abc def ghi jkl`, 25), JSON.stringify(ws)).toEqual([`${pad}.`, 'Abc def ghi jkl']);
  });
  it('a period that ends exactly at the window edge cuts there; one more character and it does not', () => {
    expect(splitBlock('x'.repeat(29) + '. Next one here.', 30)).toEqual(['x'.repeat(29) + '.', 'Next one here.']);
    expect(splitBlock('x'.repeat(30) + '. Next one here.', 30)).toEqual(['x'.repeat(30), '. Next one here.']);
  });
  it('no whitespace between the period and the capital: no cut', () => {
    const text = `${pad}.Abc def ghi jkl`;
    expect(splitBlock(text, 25)[0]).toBe(text.slice(0, 25).trimEnd());
  });
  it('title-case and modifier letters are not uppercase (Lu only)', () => {
    for (const ch of ['\u01C5', '\u02B0']) {
      const text = `${pad}. ${ch}bc def ghi jkl`;
      expect(splitBlock(text, 25)[0]).toBe(text.slice(0, 25).trimEnd());
    }
  });
});

describe('splitBlock surrogate guards and split guard', () => {
  const E = '\u{1F600}';
  it('never cuts between surrogates when the window ends after a high surrogate', () => {
    expect(splitBlock(`a${E}${E}`, 2)).toEqual(['a', E, E]);
    expect(splitBlock(`ab${E}c`, 3)).toEqual(['ab', `${E}c`]);
  });
  it('when maxChars is below one character, the cut still takes a whole astral character', () => {
    expect(splitBlock(`${E}x`, 1)).toEqual([E, 'x']);
  });
  it('the guard covers the whole high-surrogate range: U+10000 (D800) and U+10FFFF (DBFF) are kept whole', () => {
    for (const ch of ['\u{10000}', '\u{10FFFF}', '\u{103FF}', '\u{10400}']) {
      const pieces = splitBlock(`a${ch}${ch}`, 2);
      expect(pieces, ch).toEqual(['a', ch, ch]);
    }
  });
  it('code units next to the surrogate range are ordinary characters and are cut at the window', () => {
    for (const ch of ['퟿', '', '\uDC00']) {
      const pieces = splitBlock(`a${ch}${ch}${ch}`, 2);
      expect(pieces, ch.charCodeAt(0).toString(16)).toEqual([`a${ch}`, `${ch}${ch}`]);
    }
  });
  it('a block of exactly maxChars is not split, maxChars+1 is, also when whitespace runs make the raw length longer', () => {
    expect(splitBlock('x'.repeat(10), 10)).toEqual(['x'.repeat(10)]);
    expect(splitBlock('x'.repeat(11), 10)).toHaveLength(2);
    const spaced = 'xxxx   \n  yyyy'; // normalizes to "xxxx yyyy" = 9
    expect(splitBlock(spaced, 9)).toEqual([spaced]);
    expect(splitBlock(spaced + 'z', 9)).toHaveLength(2);
  });
  it('through the chunker: a text block of exactly M is one block, M+1 two', () => {
    const one = sectionPack(artifactOf([{ label: 'text', text: 'x'.repeat(30) }]), docKey, rc(10, 30, 0));
    expect(one.map((c) => c.text)).toEqual(['x'.repeat(30)]);
    const two = sectionPack(artifactOf([{ label: 'text', text: 'x'.repeat(31) }]), docKey, rc(10, 30, 0));
    expect(two.map((c) => c.text)).toEqual(['x'.repeat(30), 'x']);
  });
});

describe('formula measure', () => {
  const big = 'F = ' + 'a+'.repeat(2000);
  it('a formula block is measured at 9 (the placeholder), decoded or not, and is never split', () => {
    // 'p' (T-11) + 2 + 9 = T exactly: same chunk. one more 'p' closes the chunk.
    for (const f of [big, '']) {
      const mk = (n: number) => artifactOf([{ label: 'text', text: 'p'.repeat(n) }, { label: 'formula', text: f }]);
      const same = sectionPack(mk(39), docKey, rc(50, 100, 0));
      expect(same).toHaveLength(1);
      expect(same[0]!.text).toBe('p'.repeat(39) + '\n\n' + (f === '' ? '[formula]' : f));
      expect(sectionPack(mk(40), docKey, rc(50, 100, 0))).toHaveLength(2);
    }
  });
  it('a formula longer than maxChars stays one piece with its text verbatim', () => {
    const cs = sectionPack(artifactOf([{ label: 'formula', text: big }]), docKey, rc(100, 150, 20));
    expect(cs.map((c) => c.text)).toEqual([big]);
  });
  it('a whitespace-only formula reads [formula]; a formula with text keeps it verbatim; a non-formula block does not', () => {
    expect(texts(artifactOf([{ label: 'formula', text: ' \n ' }]))).toEqual(['[formula]']);
    expect(texts(artifactOf([{ label: 'formula', text: ' E=mc2 ' }]))).toEqual([' E=mc2 ']);
    expect(texts(artifactOf([{ label: 'text', text: ' \n ' }]))).toEqual([]);
  });
  it('a long non-formula block (same length) is split', () => {
    expect(sectionPack(artifactOf([{ label: 'text', text: 'a'.repeat(400) }]), docKey, rc(100, 150, 20)).length).toBeGreaterThan(1);
  });
  it('inside an inline group, a formula child is measured at placeholder length and a long one is not split away', () => {
    const [c, ...rest] = sectionPack(inlineGroupArtifact([{ label: 'text', text: 'ab' }, { label: 'formula', text: big }]), docKey, rc(100, 150, 20));
    expect(rest).toEqual([]);
    expect(c!.text).toBe(`ab ${big}`);
  });
});

describe('ref regex', () => {
  const bad = (ref: string) => {
    const art = docOf([ref], [t(0, 'x'), t(1, 'y')], { groups: [{ self_ref: '#/groups/0', label: 'list', children: [] }], tables: [{ self_ref: '#/tables/0', label: 'table', data: { grid: [[{ text: 'c' }]] } }], pictures: [{ self_ref: '#/pictures/0', label: 'picture', captions: [{ $ref: '#/texts/0' }] }] });
    return () => sectionPack(art, docKey, recipe);
  };
  it('accepts texts, groups, tables and pictures refs with plain indices', () => {
    for (const ref of ['#/texts/0', '#/texts/1', '#/groups/0', '#/tables/0', '#/pictures/0']) expect(bad(ref), ref).not.toThrow();
  });
  it('accepts multi-digit indices, including ones ending in 0', () => {
    const many = Array.from({ length: 21 }, (_, i) => t(i, `t${i}`));
    for (const i of [10, 11, 19, 20]) expect(texts(docOf([`#/texts/${i}`], many)), String(i)).toEqual([`t${i}`]);
  });
  it('rejects leading zeros, signs, decimals, empty or trailing parts, wrong prefixes and suffixes', () => {
    for (const ref of ['#/texts/00', '#/texts/01', '#/texts/-1', '#/texts/+1', '#/texts/1.0', '#/texts/', '#/texts', '#/texts/1/', '#/texts/1x', '#/texts/ 1', '#/texts/1\n', 'x#/texts/0', ' #/texts/0', '/texts/0', 'texts/0', '#/Texts/0', '#/body', '#/other/0', '#/textsx/0', '#xtexts/0', '#.texts/0', '##texts/0', '#/texts.0', '#/texts-0', '#/texts//0', '#/texts/0/children/0'])
      expect(bad(ref), JSON.stringify(ref)).toThrow(KgError);
  });
  it('a well-formed ref past the end of its collection is invalid_input too', () => {
    for (const ref of ['#/texts/2', '#/groups/1', '#/tables/1', '#/pictures/1']) {
      let err: unknown;
      try { bad(ref)(); } catch (e) { err = e; }
      expect((err as KgError).code, ref).toBe('invalid_input');
    }
  });
  it('key_value_items and form_items refs are skipped, not errors', () => {
    expect(texts(docOf(['#/key_value_items/0', '#/form_items/3', '#/texts/0'], [t(0, 'x')]))).toEqual(['x']);
  });
  it('a bad ref nested in a group is invalid_input', () => {
    const art = docOf(['#/groups/0'], [t(0, 'x')], { groups: [{ self_ref: '#/groups/0', label: 'list', children: [{ $ref: '#/texts/01' }] }] });
    expect(() => sectionPack(art, docKey, recipe)).toThrow(KgError);
  });
});
