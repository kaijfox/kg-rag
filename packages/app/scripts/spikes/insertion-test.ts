/**
 * Spike 5b: which chunk IDs survive a real edit? For each artifact: (1) insert a ~400-char paragraph at the
 * start of a mid-document section, (2) separately edit one word of a paragraph in place in another section,
 * (3) both. Re-chunk with section-pack/1 and compare IDs, against an index-based scheme H(index|text).
 * Usage: tsx scripts/spikes/insertion-test.ts [dir with *.kgparse.json(.gz)]
 */
import { DEFAULT_DIR, artifactNames, readArtifact } from './io';
import { DEFAULT_CHUNK_RECIPE, asDocKey, sha256hex, type ChunkDraft, type ParseArtifact } from '@kg/core';
import { sectionPack } from '../../src/skeleton/chunker';

type Doc = { body: { children: { $ref: string }[] }; texts: { self_ref: string; label: string; text: string; content_layer?: string; parent: { $ref: string }; children: unknown[]; prov: unknown[]; orig?: string }[] };
const INSERT =
  'Inserted paragraph for the insertion test. It states a new fact about the thermodynamic state of a system and is long enough to matter for packing, so that the greedy packer has to move later paragraphs of this section into different chunks than before. Nothing outside this section should change at all, because packing restarts at every section header and the ID has no ordinal.';

const indexIds = (cs: ChunkDraft[]) => cs.map((c, i) => sha256hex(`${i}|${c.text}`).slice(0, 12));
const dir = process.argv[2] ?? DEFAULT_DIR;
const rows: string[] = [];
for (const name of artifactNames(dir)) {
  const art = readArtifact(dir, name);
  const v1 = sectionPack(art, asDocKey(name), DEFAULT_CHUNK_RECIPE);
  const doc = art.document as unknown as Doc;
  // sections in body order
  const headerPositions = doc.body.children
    .map((c, i) => ({ i, t: c.$ref.startsWith('#/texts/') ? doc.texts[Number(c.$ref.split('/')[2])] : undefined }))
    .filter((x) => x.t && x.t.label === 'section_header' && x.t.content_layer === 'body');
  const target = headerPositions[Math.floor(headerPositions.length / 2)]!;
  const editSection = headerPositions[Math.floor(headerPositions.length / 4)]!;

  const insert = (a: ParseArtifact) => {
    const d = structuredClone(a.document) as unknown as Doc;
    const ref = `#/texts/${d.texts.length}`;
    d.texts.push({ self_ref: ref, label: 'text', text: INSERT, orig: INSERT, content_layer: 'body', parent: { $ref: '#/body' }, children: [], prov: [] });
    d.body.children.splice(target.i + 1, 0, { $ref: ref });
    return { ...a, document: d as unknown as ParseArtifact['document'] };
  };
  const edit = (a: ParseArtifact) => {
    const d = structuredClone(a.document) as unknown as Doc;
    // first long body text after the edit section header
    for (let j = editSection.i + 1; j < d.body.children.length; j++) {
      const r = d.body.children[j]!.$ref;
      if (!r.startsWith('#/texts/')) continue;
      const t = d.texts[Number(r.split('/')[2])]!;
      if (t.label === 'section_header') break;
      if (t.label === 'text' && t.text.length > 300) {
        t.text = t.text.replace(/\b(the)\b/, 'THE');
        break;
      }
    }
    return { ...a, document: d as unknown as ParseArtifact['document'] };
  };
  for (const [label, mk] of [
    ['insert', insert],
    ['edit', edit],
    ['both', (a: ParseArtifact) => edit(insert(a))],
  ] as const) {
    const v2 = sectionPack(mk(art), asDocKey(name), DEFAULT_CHUNK_RECIPE);
    const ids1 = new Set(v1.map((c) => c.id));
    const ids2 = new Set(v2.map((c) => c.id));
    const survived = [...ids1].filter((x) => ids2.has(x)).length;
    const touched = new Set([target.t!.text, editSection.t!.text]);
    const inTouched1 = v1.filter((c) => touched.has(c.sectionPath.at(-1) ?? ''));
    const outside1 = v1.filter((c) => !touched.has(c.sectionPath.at(-1) ?? ''));
    const outsideSurvived = outside1.filter((c) => ids2.has(c.id)).length;
    const insideSurvived = inTouched1.filter((c) => ids2.has(c.id)).length;
    const ix1 = new Set(indexIds(v1));
    const ixSurvived = indexIds(v2).filter((x) => ix1.has(x)).length;
    rows.push(
      `${name.padEnd(20)} ${label.padEnd(6)} v1=${v1.length} v2=${v2.length} survived=${survived}/${v1.length} ` +
        `outside-touched-sections=${outsideSurvived}/${outside1.length} inside=${insideSurvived}/${inTouched1.length} ` +
        `index-scheme-survived=${ixSurvived}/${v1.length}  [insert@"${target.t!.text}", edit@"${editSection.t!.text}"]`,
    );
  }
}
console.log(rows.join('\n'));
