// Retrieval pilot: same section-pack/1 chunker, same embeddinggemma space, three renderings of formula blocks.
import { readFileSync, writeFileSync } from 'node:fs';
import { chunksFor, DEFAULT_SPACE, cosineScore, renderDocument, renderQuery, ollamaEmbedder, type Variant, type Chunk } from './retr_common';
type Q = { id: string; q: string; gold: [string, string][] };
const hand: Q[] = JSON.parse(readFileSync(new URL('../../../packages/app/scripts/spikes/data/embed-queries.json', import.meta.url), 'utf8')).queries;
const fx = JSON.parse(readFileSync(new URL('./data_formula_queries.json', import.meta.url), 'utf8')) as { prose: Q[]; latex: Q[] };
const groups: [string, Q[]][] = [['hand31', hand], ['formula-prose10', fx.prose], ['formula-latex10', fx.latex]];
const emb = ollamaEmbedder(DEFAULT_SPACE.model, DEFAULT_SPACE.dims, { batchSize: 16 });
await emb.embed(['warm-up']);
const report: any = {};
for (const variant of ['placeholder', 'glyph', 'latex'] as Variant[]) {
  const chunks: Chunk[] = chunksFor(variant);
  const lens = chunks.map((c) => c.text.length).sort((a, b) => a - b);
  // chunk texts are embedded as-is; long latex chunks may exceed the embedder context, record truncation risk by length
  const docVecs = await emb.embed(chunks.map((c) => renderDocument(DEFAULT_SPACE, { text: c.text } as any)));
  const rep: any = { chunks: chunks.length, medianLen: lens[Math.floor(lens.length / 2)], p90Len: lens[Math.floor(lens.length * 0.9)], maxLen: lens[lens.length - 1], groups: {} };
  for (const [gname, qs] of groups) {
    const qVecs = await emb.embed(qs.map((q) => renderQuery(DEFAULT_SPACE, q.q)));
    let h1 = 0, h5 = 0, h10 = 0, mrr = 0; const ranks: Record<string, number> = {};
    qs.forEach((q, qi) => {
      const goldIdx = new Set(chunks.map((c, i) => (q.gold.some(([d, ph]) => c.doc === d && c.text.toLowerCase().includes(ph.toLowerCase())) ? i : -1)).filter((i) => i >= 0));
      const ranked = chunks.map((c, i) => ({ i, s: cosineScore(qVecs[qi]!, docVecs[i]!) })).sort((a, b) => b.s - a.s || a.i - b.i);
      const r = ranked.findIndex((x) => goldIdx.has(x.i)) + 1;
      ranks[q.id] = goldIdx.size === 0 ? -1 : r;
      if (r > 0) { mrr += 1 / r; if (r <= 1) h1++; if (r <= 5) h5++; if (r <= 10) h10++; }
    });
    const n = qs.length;
    rep.groups[gname] = { n, hit1: h1 / n, hit5: h5 / n, hit10: h10 / n, mrr: mrr / n, ranks };
  }
  report[variant] = rep;
  console.log(variant, JSON.stringify({ ...rep, groups: Object.fromEntries(Object.entries(rep.groups).map(([k, v]: any) => [k, { n: v.n, hit1: +v.hit1.toFixed(3), hit5: +v.hit5.toFixed(3), hit10: +v.hit10.toFixed(3), mrr: +v.mrr.toFixed(3) }])) }));
}
writeFileSync(new URL('./out/retrieval.json', import.meta.url), JSON.stringify(report, null, 1));
