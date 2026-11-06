/**
 * Reads an HTML page into passages. The page's headings (h1 to h6) are the section path, and the text under each heading is
 * cut into passages of about 1000 characters, the way the markdown adapter cuts a markdown section. Nothing here knows what
 * kind of site the page came from.
 *
 * A section too short to stand alone (a heading with one line under it, such as a property's name and type) is folded into
 * its parent section's passage, with its heading text in front, so the index is not filled with fragments of a few words and
 * every passage stays under the heading that describes it.
 *
 * Kept: paragraphs, list items, table rows (cells joined by " | "), and preformatted blocks (whole, with their line breaks).
 * Left out: scripts, styles, navigation, sidebars, footers, forms, anything hidden, and permalink anchors. When the page has a
 * `<main>`, a `role="main"` element or an `<article>`, only that is read, which leaves out the menus that documentation
 * themes put around the content.
 */
import { parse } from 'parse5';
import type { ChunkPiece } from './index';
import { packParagraphs } from './pack';

interface N {
  nodeName: string;
  tagName?: string;
  value?: string;
  attrs?: { name: string; value: string }[];
  childNodes?: N[];
}

const SKIP = new Set(['script', 'style', 'noscript', 'template', 'svg', 'nav', 'aside', 'footer', 'form', 'button', 'select', 'option', 'head', 'iframe', 'canvas', 'audio', 'video', 'input', 'textarea']);
const BLOCK = new Set(['address', 'article', 'blockquote', 'body', 'caption', 'dd', 'details', 'div', 'dl', 'dt', 'fieldset', 'figure', 'figcaption', 'header', 'hr', 'li', 'main', 'ol', 'p', 'section', 'summary', 'table', 'tbody', 'tfoot', 'thead', 'tr', 'ul']);

/** Characters below which a section is folded into the next one. */
const MIN_PASSAGE = 120;

const attr = (n: N, name: string): string | undefined => n.attrs?.find((a) => a.name === name)?.value;
const children = (n: N): N[] => n.childNodes ?? [];

function hidden(n: N): boolean {
  const tag = n.tagName;
  if (tag === undefined) return false;
  if (SKIP.has(tag)) return true;
  if (attr(n, 'hidden') !== undefined || attr(n, 'aria-hidden') === 'true' || attr(n, 'role') === 'navigation') return true;
  return (attr(n, 'class') ?? '').split(/\s+/).includes('headerlink');
}

function find(n: N, test: (e: N) => boolean): N | null {
  if (n.tagName !== undefined && test(n)) return n;
  for (const c of children(n)) {
    const r = find(c, test);
    if (r) return r;
  }
  return null;
}

/** The content of the page: `<main>`, else `role="main"`, else `<article>`, else the body. */
const contentRoot = (doc: N): N =>
  find(doc, (e) => e.tagName === 'main') ?? find(doc, (e) => attr(e, 'role') === 'main') ?? find(doc, (e) => e.tagName === 'article') ?? find(doc, (e) => e.tagName === 'body') ?? doc;

/** Text of a node on one line: whitespace collapsed, hidden parts dropped. */
function inline(n: N): string {
  if (n.nodeName === '#text') return (n.value ?? '').replace(/\s+/g, ' ');
  if (n.tagName === undefined || hidden(n)) return '';
  if (n.tagName === 'br') return ' ';
  return children(n).map(inline).join('');
}

/** Text of a node as written, line breaks kept (for preformatted blocks). */
function raw(n: N): string {
  if (n.nodeName === '#text') return n.value ?? '';
  if (n.tagName === undefined || hidden(n)) return '';
  if (n.tagName === 'br') return '\n';
  return children(n).map(raw).join('');
}

const clean = (s: string): string => s.replace(/\s+/g, ' ').replace(/\s*[¶]+$/, '').trim();

interface Section {
  level: number;
  path: string[];
  paras: string[];
  kids: Section[];
}

/**
 * Turns a section and its subsections into passages. A subsection whose own text is under MIN_PASSAGE characters (and that
 * has no subsections of its own left over) comes back as one line of text for the parent to include.
 */
function settle(sec: Section, top: boolean): ChunkPiece[] | string {
  const folded: string[] = [];
  const kidPieces: ChunkPiece[] = [];
  for (const kid of sec.kids) {
    const r = settle(kid, false);
    if (typeof r === 'string') folded.push(r);
    else kidPieces.push(...r);
  }
  const text = [...sec.paras, ...folded].join('\n\n');
  if (!top && kidPieces.length === 0 && text.length < MIN_PASSAGE) {
    if (text === '') return '';
    const heading = sec.path[sec.path.length - 1]!;
    return `${heading}: ${text}`;
  }
  return [...packParagraphs([...sec.paras, ...folded], sec.path), ...kidPieces];
}

export function htmlPieces(source: string): ChunkPiece[] {
  const root = contentRoot(parse(source) as unknown as N);
  const top: Section = { level: 0, path: [], paras: [], kids: [] };
  const open: Section[] = [top];
  const add = (s: string) => {
    if (s !== '') open[open.length - 1]!.paras.push(s);
  };

  const walk = (n: N): void => {
    let run = '';
    const endRun = () => {
      add(clean(run));
      run = '';
    };
    for (const c of children(n)) {
      if (c.nodeName === '#text') {
        run += (c.value ?? '').replace(/\s+/g, ' ');
        continue;
      }
      const tag = c.tagName;
      if (tag === undefined || hidden(c)) continue;
      const heading = /^h([1-6])$/.exec(tag);
      if (!heading && tag !== 'pre' && !BLOCK.has(tag)) {
        run += inline(c);
        continue;
      }
      endRun();
      if (heading) {
        const text = clean(inline(c));
        if (text === '') continue;
        const level = Number(heading[1]);
        while (open[open.length - 1]!.level >= level) open.pop();
        const parent = open[open.length - 1]!;
        const sec: Section = { level, path: [...parent.path, text], paras: [], kids: [] };
        parent.kids.push(sec);
        open.push(sec);
      } else if (tag === 'pre') {
        add(raw(c).replace(/^\n+|\s+$/g, ''));
      } else if (tag === 'li') {
        const holdsBlocks = children(c).some((k) => k.tagName !== undefined && !hidden(k) && (BLOCK.has(k.tagName) || k.tagName === 'pre'));
        if (holdsBlocks) walk(c);
        else {
          const text = clean(inline(c));
          if (text !== '') add(`- ${text}`);
        }
      } else if (tag === 'tr') {
        const cells = children(c)
          .filter((k) => k.tagName === 'td' || k.tagName === 'th')
          .map((k) => clean(inline(k)))
          .filter((x) => x !== '');
        if (cells.length) add(cells.join(' | '));
      } else if (tag !== 'hr') walk(c);
    }
    endRun();
  };
  walk(root);
  return settle(top, true) as ChunkPiece[];
}
