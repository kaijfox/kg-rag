import { chunksFor } from './retr_common';
const cs = chunksFor('placeholder');
const heavy = cs.map((c, i) => ({ i, doc: c.doc, n: (c.text.match(/\[formula\]/g) ?? []).length, len: c.text.length, text: c.text }))
  .filter((x) => x.n >= 3).sort((a, b) => b.n / b.len - a.n / a.len);
console.log(cs.length, 'chunks;', heavy.length, 'with >=3 formulas');
for (const h of heavy.slice(0, 40)) console.log(`#${h.i} ${h.doc} n=${h.n} len=${h.len} :: ${h.text.replace(/\n/g, ' ').slice(0, 170)}`);
