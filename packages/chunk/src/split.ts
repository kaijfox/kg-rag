/**
 * Length measure and block splitting for section-pack/1. Every length is the length of core's normText, so
 * whitespace-only differences between two parses never move a boundary.
 */
import { normText } from '@kg/core';

export const normLength = (s: string): number => normText(s).length;

/** Largest k with normLength(s.slice(0, k)) <= limit. Binary search: normLength is non-decreasing in k. */
function longestPrefixWithin(s: string, limit: number): number {
  let lo = 0;
  let hi = s.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (normLength(s.slice(0, mid)) <= limit) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** Smallest k with normLength(s.slice(0, k)) >= limit. */
function shortestPrefixReaching(s: string, limit: number): number {
  let lo = 0;
  let hi = s.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (normLength(s.slice(0, mid)) >= limit) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/** Keeps surrogate pairs whole: a cut never falls between the two code units of one character. */
const isHighSurrogate = (s: string, i: number) => {
  const c = s.charCodeAt(i);
  return c >= 0xd800 && c <= 0xdbff;
};

/**
 * Splits a block whose normalized length exceeds maxChars (section-pack/1 rule 3). While the remainder is longer than
 * maxChars: cut after the last `.` that lies inside the longest prefix within maxChars and is followed by whitespace and
 * an uppercase letter (the uppercase letter may lie beyond the prefix; the next piece starts at it); if there is no such
 * `.`, cut hard at the longest prefix of normalized length <= maxChars (trailing whitespace stays with the next piece).
 * normText counts a whitespace run as one character wherever it falls, so length maxChars can be unattainable; the cut
 * then falls on the longest attainable length below it. No piece is longer than maxChars.
 */
export function splitBlock(text: string, maxChars: number): string[] {
  const pieces: string[] = [];
  let rest = text;
  while (normLength(rest) > maxChars) {
    let k = longestPrefixWithin(rest, maxChars);
    if (k > 0 && isHighSurrogate(rest, k - 1)) k -= 1;
    let cut = -1;
    let next = -1;
    for (const m of rest.matchAll(/\.(\s+)(?=\p{Lu})/gu)) {
      if (m.index + 1 > k) break;
      cut = m.index + 1;
      next = m.index + m[0].length;
    }
    if (cut > 0) {
      pieces.push(rest.slice(0, cut));
      rest = rest.slice(next);
    } else {
      let hard = shortestPrefixReaching(rest, normLength(rest.slice(0, k)));
      if (hard === 0) hard = String.fromCodePoint(rest.codePointAt(0)!).length;
      pieces.push(rest.slice(0, hard));
      rest = rest.slice(hard);
    }
  }
  pieces.push(rest);
  return pieces;
}
