/** Small hand-built docling documents for the chunk tests (the ones in testkit cover the rest). */
import { asDocKey, DEFAULT_CHUNK_RECIPE, type ChunkRecipeSpec, type ParseArtifact } from '@kg/core';

export type Item = { label: string; text: string; level?: number; page?: number };

/** A parse artifact whose body is the given text items in order (no furniture, no groups). */
export function artifactOf(items: Item[]): ParseArtifact {
  const texts = items.map((it, i) => ({
    self_ref: `#/texts/${i}`,
    parent: { $ref: '#/body' },
    children: [],
    content_layer: 'body',
    label: it.label,
    prov: [{ page_no: it.page ?? 1 }],
    orig: it.text,
    text: it.text,
    ...(it.level !== undefined ? { level: it.level } : {}),
  }));
  return {
    format: 'kg-parse-artifact/1',
    sourceSha256: 'a'.repeat(64),
    sourceName: 'synthetic.pdf',
    recipe: { kind: 'parse', version: '1', spec: { parser: 'docling', doclingVersion: '2.140.0', options: { do_ocr: false, do_table_structure: true, do_formula_enrichment: false } } },
    parser: { name: 'docling', version: '2.140.0' },
    producedAt: '2026-10-18T00:00:00Z',
    producedOn: 'test',
    stats: { pages: 1, chars: 0, charsPerPage: [], undecodedFormulas: 0, elapsedMs: 0 },
    document: {
      body: { children: texts.map((t) => ({ $ref: t.self_ref })) },
      texts,
      groups: [],
      tables: [],
      pictures: [],
    } as unknown as ParseArtifact['document'],
  };
}

export const docKey = asDocKey('Synthetic');
export const recipe: ChunkRecipeSpec = DEFAULT_CHUNK_RECIPE;

/** A parse artifact around a hand-written docling document (body, texts, groups, ...). */
export function artifactWith(document: Record<string, unknown>): ParseArtifact {
  const base = artifactOf([]);
  return { ...base, document: document as unknown as ParseArtifact['document'] };
}

type Child = { label: string; text: string; page?: number };

/**
 * A document with an optional lead paragraph, then one inline group (a `#/groups/0` with the given children as texts),
 * then an optional trailing paragraph. Refs: lead `#/texts/0` (if any), children next, trailing last.
 */
export function inlineGroupArtifact(children: Child[], opts: { lead?: string; trail?: string } = {}): ParseArtifact {
  const texts: Record<string, unknown>[] = [];
  const mk = (label: string, text: string, parent: string, page = 1) => {
    const self_ref = `#/texts/${texts.length}`;
    texts.push({ self_ref, parent: { $ref: parent }, children: [], content_layer: 'body', label, prov: [{ page_no: page }], orig: text, text });
    return self_ref;
  };
  const body: { $ref: string }[] = [];
  if (opts.lead !== undefined) body.push({ $ref: mk('text', opts.lead, '#/body') });
  const kids = children.map((c) => ({ $ref: mk(c.label, c.text, '#/groups/0', c.page) }));
  body.push({ $ref: '#/groups/0' });
  if (opts.trail !== undefined) body.push({ $ref: mk('text', opts.trail, '#/body') });
  return artifactWith({
    body: { children: body },
    texts,
    groups: [{ self_ref: '#/groups/0', parent: { $ref: '#/body' }, children: kids, content_layer: 'body', label: 'inline' }],
    tables: [],
    pictures: [],
  });
}
