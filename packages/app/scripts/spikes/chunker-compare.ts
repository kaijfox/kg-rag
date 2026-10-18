/**
 * Spike 5a: section-pack/1 (TS) vs docling HybridChunker on the four stat-mech parse artifacts (OCR off).
 * Usage: tsx scripts/spikes/chunker-compare.ts [dir with *.kgparse.json(.gz) and *.hybrid.json(.gz)] [outJson]
 */
import { writeFileSync } from 'node:fs';
import { DEFAULT_DIR, artifactNames, readArtifact, readHybrid } from './io';
import { DEFAULT_CHUNK_RECIPE, asDocKey, normText } from '@kg/core';
import { sectionPack, normalize } from '../../src/skeleton/chunker';

const dir = process.argv[2] ?? DEFAULT_DIR;
const outPath = process.argv[3];
const q = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))]!;
};
const stats = (xs: number[]) => ({
  n: xs.length,
  min: Math.min(...xs),
  p10: q(xs, 0.1),
  median: q(xs, 0.5),
  p90: q(xs, 0.9),
  max: Math.max(...xs),
  under200: xs.filter((x) => x < 200).length,
  over1500: xs.filter((x) => x > 1500).length,
  totalChars: xs.reduce((a, b) => a + b, 0),
});

const report: Record<string, unknown> = {};
for (const name of artifactNames(dir)) {
  const art = readArtifact(dir, name);
  const hyb = readHybrid(dir, name);
  const ts = sectionPack(art, asDocKey(name), DEFAULT_CHUNK_RECIPE);
  const ev = normalize(art.document as Record<string, unknown>);
  // coverage: which body text refs reach a chunk in each scheme
  const tsRefs = new Set(ts.flatMap((c) => c.blockRefs));
  const hyRefs = new Set(hyb.flatMap((c) => c.refs));
  const onlyHy = [...hyRefs].filter((r) => !tsRefs.has(r));
  const onlyTs = [...tsRefs].filter((r) => !hyRefs.has(r));
  // boundary agreement: a chunk "matches" if the other scheme has a chunk with identical normText
  const tsTexts = new Set(ts.map((c) => normText(c.text)));
  const hyTexts = new Set(hyb.map((c) => normText(c.text)));
  const same = [...tsTexts].filter((t) => hyTexts.has(t)).length;
  // chunk start agreement: first block ref of each chunk
  const tsStarts = new Set(ts.map((c) => c.blockRefs[0]));
  const hyStarts = new Set(hyb.map((c) => c.refs[0]));
  const sharedStarts = [...tsStarts].filter((s) => hyStarts.has(s)).length;
  report[name] = {
    ts: stats(ts.map((c) => c.text.length)),
    hybrid: stats(hyb.map((c) => c.text.length)),
    identicalTexts: same,
    sharedChunkStarts: sharedStarts,
    headings: ev.filter((e) => e.kind === 'heading').length,
    distinctSectionPathsTs: new Set(ts.map((c) => JSON.stringify(c.sectionPath))).size,
    distinctHeadingPathsHybrid: new Set(hyb.map((c) => JSON.stringify(c.headings))).size,
    refsOnlyInHybrid: onlyHy.length,
    refsOnlyInTs: onlyTs.length,
    sampleOnlyHybrid: onlyHy.slice(0, 5),
    sampleOnlyTs: onlyTs.slice(0, 5),
  };
}
console.log(JSON.stringify(report, null, 1));
if (outPath) writeFileSync(outPath, JSON.stringify(report, null, 1));
