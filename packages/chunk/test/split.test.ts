import { describe, expect, it } from 'vitest';
import { splitBlock } from '../src/split';

describe('splitBlock (section-pack/1 rule 3)', () => {
  it('returns short text unchanged', () => {
    expect(splitBlock('Short text.', 1500)).toEqual(['Short text.']);
  });

  it('cuts after the last sentence end inside the window; the next piece starts at the uppercase letter', () => {
    const a = 'First sentence here. ';
    const b = 'Second sentence follows. ';
    const text = a + b + 'Third sentence is somewhat longer than the window allows here.';
    const pieces = splitBlock(text, 30);
    expect(pieces[0]).toBe('First sentence here.');
    expect(pieces[1]).toBe('Second sentence follows.');
    expect(pieces[2]!.startsWith('Third sentence')).toBe(true);
    for (const p of pieces) expect(p.length).toBeLessThanOrEqual(30);
  });

  it('hard-cuts at maxChars when there is no sentence end, keeping trailing whitespace with the next piece', () => {
    const text = 'x'.repeat(30) + ' ' + 'y'.repeat(30);
    const pieces = splitBlock(text, 30);
    expect(pieces[0]).toBe('x'.repeat(30));
    expect(pieces[1]!.startsWith(' ')).toBe(true);
  });

  it('every piece is at most maxChars after normalization and no piece is empty', () => {
    const text = Array.from({ length: 40 }, (_, i) => `Remark ${i} notes the value ${i * 7} in units.`).join(' ');
    for (const p of splitBlock(text, 120)) {
      expect(p.replace(/\s+/g, ' ').trim().length).toBeGreaterThan(0);
      expect(p.replace(/\s+/g, ' ').trim().length).toBeLessThanOrEqual(120);
    }
  });
});

describe('splitBlock: window edges', () => {
  it('a block of exactly maxChars is one piece; one more splits', () => {
    expect(splitBlock('x'.repeat(30), 30)).toEqual(['x'.repeat(30)]);
    expect(splitBlock('x'.repeat(31), 30)).toEqual(['x'.repeat(30), 'x']);
  });

  it('cuts at a period inside the window even when the uppercase letter lies beyond it', () => {
    const text = 'x'.repeat(28) + '. Next one is here.';
    expect(splitBlock(text, 30)).toEqual(['x'.repeat(28) + '.', 'Next one is here.']);
  });

  it('does not cut at a period that lies outside the window', () => {
    const text = 'x'.repeat(30) + '. Next';
    expect(splitBlock(text, 30)).toEqual(['x'.repeat(30), '. Next']);
  });

  it('cuts after the last of several qualifying periods', () => {
    expect(splitBlock('Aa b. Cc d. Ee f. Gg h', 14)).toEqual(['Aa b. Cc d.', 'Ee f. Gg h']);
  });

  it('a non-ASCII uppercase letter starts the next piece', () => {
    expect(splitBlock('x'.repeat(20) + '. Élan vital goes on', 25)).toEqual(['x'.repeat(20) + '.', 'Élan vital goes on']);
  });

  it('never leaves a piece above maxChars when that length cannot be reached (whitespace counts as one)', () => {
    // "xxxxx " is 5 and "xxxxx y" is 7: 6 is unattainable
    const pieces = splitBlock('xxxxx yyyyyyy', 6);
    expect(pieces).toEqual(['xxxxx', ' yyyyyy', 'y']);
    for (const p of pieces) expect(p.replace(/\s+/g, ' ').trim().length).toBeLessThanOrEqual(6);
  });

  it('a hard cut never separates a surrogate pair, and the pieces rejoin to the text', () => {
    const text = '\u{1F600}'.repeat(10);
    const pieces = splitBlock(text, 5);
    expect(pieces.join('')).toBe(text);
    for (const p of pieces) {
      expect(p.length).toBeLessThanOrEqual(5);
      expect(() => encodeURIComponent(p)).not.toThrow();
    }
  });

  it('makes progress when maxChars is smaller than one character', () => {
    expect(splitBlock('\u{1F600}\u{1F600}', 1).join('')).toBe('\u{1F600}\u{1F600}');
  });
});
