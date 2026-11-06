/**
 * The replacement rule: a dated entry that says it supersedes, replaces, overrides or reverses an earlier entry (named
 * by its date) is linked to that entry, and an entry that says it was superseded by a later one is linked the other way.
 * No model is involved. A replacement that the source never states goes undetected, and an ambiguous reference (several
 * entries on the named date, none matching the sentence's words) is reported and skipped.
 */
export interface Entry {
  id: string;
  key: string;
  date: string | null;
  title: string;
  text: string;
}
export interface Replacement {
  newer: Entry;
  older: Entry;
  sentence: string;
}

const ACTIVE = /\b(supersed(?:e|es|ed|ing)|replac(?:e|es|ed|ing)|overrid(?:e|es|den|ing)|revers(?:e|es|ed|ing)|retir(?:e|es|ed|ing))\b/i;
const PASSIVE = /\b(superseded|replaced|overridden|reversed|retired)\s+(?:by|in favou?r of)\b/i;
const DATE = /\b(\d{4}-\d{2}-\d{2})\b/g;
const words = (s: string): Set<string> => new Set(s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 4));

const before = (a: Entry, b: Entry): boolean => (a.date ?? '') < (b.date ?? '') || (a.date === b.date && a.key < b.key);

export function findReplacements(entries: readonly Entry[]): { found: Replacement[]; skipped: { entry: string; sentence: string; reason: string }[] } {
  const found: Replacement[] = [];
  const skipped: { entry: string; sentence: string; reason: string }[] = [];
  const seen = new Set<string>();
  for (const e of entries) {
    // the heading names the entry, so a title that mentions "replaces" is a statement about this entry, kept in the text
    for (const sentence of e.text.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter((s) => s !== '')) {
      if (!ACTIVE.test(sentence)) continue;
      const passive = PASSIVE.test(sentence);
      for (const m of sentence.matchAll(DATE)) {
        const d = m[1]!;
        if (d === e.date && !entries.some((x) => x.date === d && x.key !== e.key)) continue;
        let targets = entries.filter((x) => x.date === d && x.key !== e.key);
        if (targets.length === 0) continue;
        if (targets.length > 1) {
          const sw = words(sentence);
          const close = targets.filter((t) => [...words(t.title)].filter((w) => sw.has(w)).length >= 2);
          if (close.length !== 1) {
            skipped.push({ entry: e.key, sentence, reason: `${targets.length} entries are dated ${d} and the sentence does not single one out` });
            continue;
          }
          targets = close;
        }
        const t = targets[0]!;
        const [newer, older] = passive ? [t, e] : [e, t];
        if (!before(older, newer)) {
          skipped.push({ entry: e.key, sentence, reason: `${older.key} is not earlier than ${newer.key}` });
          continue;
        }
        const k = `${newer.id}>${older.id}`;
        if (seen.has(k)) continue;
        seen.add(k);
        found.push({ newer, older, sentence });
      }
    }
  }
  return { found, skipped };
}
