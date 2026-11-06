import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { type Llm } from '@kg/kernel';
import { htmlPieces, ingest, markdownPieces, rebuild } from '../src';
import { fakeEmbedder, makeKg, scriptedLlm, tempDir } from './helpers';

describe('markdown', () => {
  it('does not take a # line inside a fenced code block for a heading, and does not cut a code block in two', () => {
    const pieces = markdownPieces('# Setup\n\nRun this:\n\n```sh\n# install\nnpm install\n\nnpm test\n```\n\n## Next\n\nDone.\n');
    expect(pieces.map((p) => p.sectionPath)).toEqual([['Setup'], ['Setup', 'Next']]);
    expect(pieces[0]!.text).toContain('# install\nnpm install\n\nnpm test');
  });
});

describe('very long paragraphs', () => {
  it('are cut so that no passage is over the limit, and nothing is lost', () => {
    const code = Array.from({ length: 120 }, (_, i) => `const value${i} = compute(${i}); // a line of code with no blank line around it`).join('\n');
    const pieces = markdownPieces(`# Big\n\n\`\`\`ts\n${code}\n\`\`\`\n`);
    expect(pieces.length).toBeGreaterThan(3);
    for (const p of pieces) expect(p.text.length).toBeLessThanOrEqual(1500);
    expect(pieces.map((p) => p.text).join('\n')).toContain('const value119 = compute(119);');
    const oneLine = markdownPieces(`# Wide\n\n${'word '.repeat(1200)}\n`);
    for (const p of oneLine) expect(p.text.length).toBeLessThanOrEqual(1500);
    expect(markdownPieces(`# Blob\n\n${'x'.repeat(4000)}\n`).every((p) => p.text.length <= 1500)).toBe(true);
  });
});

describe('very long paragraphs', () => {
  it('are cut so that no passage is over the limit, and nothing is lost', () => {
    const code = Array.from({ length: 120 }, (_, i) => `const value${i} = compute(${i}); // a line with no blank line around it`).join('\n');
    const pieces = markdownPieces('# Big\n\n```ts\n' + code + '\n```\n');
    expect(pieces.length).toBeGreaterThan(3);
    for (const p of pieces) expect(p.text.length).toBeLessThanOrEqual(1500);
    expect(pieces.map((p) => p.text).join('\n')).toContain('const value119 = compute(119);');
    for (const p of markdownPieces('# Wide\n\n' + 'word '.repeat(1200) + '\n')) expect(p.text.length).toBeLessThanOrEqual(1500);
    for (const p of markdownPieces('# Blob\n\n' + 'x'.repeat(4000) + '\n')) expect(p.text.length).toBeLessThanOrEqual(1500);
  });

  it('are also cut in an HTML page, such as a whole source listing in one block', () => {
    const listing = Array.from({ length: 200 }, (_, i) => `${i + 1}    return value_${i}`).join('\n');
    const pieces = htmlPieces('<body><h1>Module</h1><pre>' + listing + '</pre></body>');
    expect(pieces.length).toBeGreaterThan(3);
    for (const p of pieces) expect(p.text.length).toBeLessThanOrEqual(1500);
  });
});

describe('HTML pages', () => {
  const page = `<html><head><title>x</title><script>var a = 1;</script></head><body>
    <nav><a>Home</a><a>Docs</a></nav>
    <main><h1>Library</h1><p>Intro   text.</p>
      <h2>connect</h2><p>Opens a connection and waits for the <code>handshake</code>.</p>
      <pre>conn = connect(host)\n# retry\nconn.close()</pre>
      <ul><li>first</li><li>second</li></ul>
      <table><tr><th>name</th><th>default</th></tr><tr><td>timeout</td><td>30</td></tr></table>
      <h2>close</h2><p>Closes it. <a class="headerlink" href="#close">¶</a></p>
    </main><footer>copyright</footer></body></html>`;

  it('uses the headings as the section path and keeps paragraphs, code, lists and table rows, without the page furniture', () => {
    const pieces = htmlPieces(page);
    // "close" is too short to stand alone, so it is folded into its parent, which keeps the heading text in front of it
    expect(pieces.map((p) => p.sectionPath)).toEqual([['Library'], ['Library', 'connect']]);
    expect(pieces[0]!.text).toBe('Intro text.\n\nclose: Closes it.');
    const connect = pieces[1]!.text;
    expect(connect).toContain('Opens a connection and waits for the handshake.');
    expect(connect).toContain('conn = connect(host)\n# retry\nconn.close()');
    expect(connect).toContain('- first');
    expect(connect).toContain('name | default');
    expect(connect).toContain('timeout | 30');
    expect(pieces.map((p) => p.text).join(' ')).not.toMatch(/Home|copyright|var a|¶/);
  });

  it('reads the whole body when a page has no main part, and a heading closes every deeper one', () => {
    const long = (w: string) => `<p>${(w + ' ').repeat(100)}</p>`;
    const pieces = htmlPieces(`<body><h1>A</h1>${long('a')}<h2>B</h2>${long('b')}<h3>C</h3>${long('c')}<h2>D</h2>${long('d')}</body>`);
    expect(pieces.map((p) => p.sectionPath.join(' > '))).toEqual(['A', 'A > B', 'A > B > C', 'A > D']);
  });

  it('folds a short section into its parent and keeps a long one under its own heading', () => {
    const long = `<p>${'The connection is opened lazily on first use. '.repeat(5)}</p>`;
    const pieces = htmlPieces(`<body><h1>Client</h1>${long}<h2>Properties</h2><h3>host</h3><p>The host name.</p><h3>port</h3><p>The port number.</p><h2>connect</h2>${long}</body>`);
    expect(pieces.map((p) => p.sectionPath.join(' > '))).toEqual(['Client', 'Client > connect']);
    expect(pieces[0]!.text).toContain('Properties: host: The host name.\n\nport: The port number.');
  });

  it('is read from a folder of pages, minus the files an exclude pattern names', async () => {
    const dir = tempDir();
    const site = join(dir, 'site');
    mkdirSync(site);
    writeFileSync(join(site, 'index.html'), page);
    writeFileSync(join(site, 'genindex.html'), '<body><h1>Index</h1><p>a b c d</p></body>');
    const kg = makeKg({ sources: [{ path: site, exclude: '(^|/)genindex' }] }, { embedder: fakeEmbedder() });
    expect((await ingest(kg)).documents.map((d) => d.docKey)).toEqual(['index']);
    kg.close();
  });
});

describe('chunk metadata', () => {
  it('is refreshed when the text of a chunk did not change but its place in the log did', async () => {
    const f = join(tempDir(), 'log.md');
    writeFileSync(f, '## 2026-04-02: Store is SQLite\nThe store is SQLite.\n');
    const kg = makeKg({ sources: [{ path: f, adapter: 'decision-log', docKey: 'log' }] }, { embedder: fakeEmbedder() });
    await ingest(kg);
    const before = kg.index.currentChunks()[0]!;
    expect(before.meta.entryKey).toBe('2026-04-02#1');
    // an entry of the same day is inserted above: the first entry is now the second of its day
    writeFileSync(f, '## 2026-04-02: Search is hybrid\nSearch is hybrid.\n\n## 2026-04-02: Store is SQLite\nThe store is SQLite.\n');
    await ingest(kg);
    const after = kg.index.currentChunks().find((c) => c.id === before.id)!;
    expect(after).toBeDefined();
    expect(after.meta.entryKey).toBe('2026-04-02#2');
    kg.close();
  });
});

describe('sources that are folders', () => {
  const notes = (files: Record<string, string>) => {
    const dir = tempDir();
    const folder = join(dir, 'notes');
    mkdirSync(folder);
    for (const [name, text] of Object.entries(files)) writeFileSync(join(folder, name), text);
    return { folder, db: tempDir() };
  };

  it('reads every file in the folder, picks up new ones, and retires documents whose file is gone', async () => {
    const { folder, db } = notes({ 'a.md': '# A\n\nApples grow on trees.\n', 'b.md': '# B\n\nBananas grow in bunches.\n' });
    const kg = makeKg({ sources: [{ path: folder, adapter: 'markdown' }] }, { embedder: fakeEmbedder() }, db);
    expect((await ingest(kg)).documents.map((d) => d.docKey).sort()).toEqual(['a', 'b']);

    writeFileSync(join(folder, 'c.md'), '# C\n\nCherries have stones.\n');
    const second = await ingest(kg);
    expect(second.documents.filter((d) => !d.unchanged).map((d) => d.docKey)).toEqual(['c']);

    rmSync(join(folder, 'b.md'));
    const third = await ingest(kg);
    expect(third.retired).toEqual(['b']);
    expect(kg.index.currentChunks().map((c) => c.docKey).sort()).toEqual(['a', 'c']);
    expect(kg.index.stats()).toMatchObject({ documents: 2, retiredDocuments: 1 });

    writeFileSync(join(folder, 'b.md'), '# B\n\nBananas grow in bunches.\n');
    await ingest(kg);
    expect(kg.index.currentChunks().map((c) => c.docKey).sort()).toEqual(['a', 'b', 'c']);
    kg.close();
  });

  it('names nested files by their path, and refuses two files with the same key', async () => {
    const { folder, db } = notes({ 'top.md': '# T\n\nTop level text here.\n' });
    mkdirSync(join(folder, 'sub'));
    writeFileSync(join(folder, 'sub', 'inner.md'), '# I\n\nInner text here.\n');
    const kg = makeKg({ sources: [{ path: folder, adapter: 'markdown' }] }, { embedder: fakeEmbedder() }, db);
    expect((await ingest(kg)).documents.map((d) => d.docKey).sort()).toEqual(['sub › inner', 'top']);
    writeFileSync(join(folder, 'top.txt'), 'Same stem, other extension.\n');
    await expect(ingest(kg)).rejects.toThrow(/both have the document key/);
    kg.close();
  });

  it('retires the documents of a source taken off the list, and keeps those of a source whose path is missing', async () => {
    const { folder, db } = notes({ 'a.md': '# A\n\nApples grow on trees.\n' });
    const kg = makeKg({ sources: [{ path: folder, adapter: 'markdown' }] }, { embedder: fakeEmbedder() }, db);
    await ingest(kg);

    rmSync(folder, { recursive: true });
    const missing = await ingest(kg);
    expect(missing.missing).toEqual([folder]);
    expect(missing.retired).toEqual([]);
    expect(kg.index.currentChunks()).toHaveLength(1);
    await expect(rebuild(kg)).rejects.toThrow(/cannot read/);

    kg.saveConfig({ sources: [] });
    expect((await ingest(kg)).retired).toEqual(['a']);
    expect(kg.index.currentChunks()).toHaveLength(0);
    kg.close();
  });

  it('an ingest of named files retires nothing', async () => {
    const { folder, db } = notes({ 'a.md': '# A\n\nApples grow on trees.\n', 'b.md': '# B\n\nBananas grow in bunches.\n' });
    const kg = makeKg({ sources: [{ path: folder, adapter: 'markdown' }] }, { embedder: fakeEmbedder() }, db);
    await ingest(kg);
    rmSync(join(folder, 'b.md'));
    const r = await ingest(kg, { sources: [{ path: join(folder, 'a.md'), adapter: 'markdown' }] });
    expect(r.retired).toEqual([]);
    expect(kg.index.currentChunks()).toHaveLength(2);
    kg.close();
  });
});

describe('extraction on one machine, search on another', () => {
  const table = { Apples: [{ text: 'Apples grow on trees in orchards across temperate regions.', names: ['Apples', 'trees'] }] };
  const extract = { enabled: true, secondPass: false, maxFactsPerChunk: 12 };
  const source = () => {
    const f = join(tempDir(), 'notes.md');
    writeFileSync(f, '# Fruit\n\nApples grow on trees.\n');
    return { path: f, adapter: 'markdown' };
  };

  it('replays a cache brought from the other machine without calling a model, and refuses to call one when asked not to', async () => {
    const src = source();
    const strong = scriptedLlm(table);
    const a = makeKg({ sources: [src], extract }, { embedder: fakeEmbedder(), llm: strong }, tempDir());
    const first = await ingest(a);
    expect(first.facts).toBe(1);
    expect(strong.calls).toBe(1);
    expect(first.llm).toEqual({ made: 1, cached: 0 });
    const exported = join(tempDir(), 'cache.sqlite');
    a.cache.backupTo(exported);
    a.close();

    const never: Llm = { complete: async () => { throw new Error('a model was called'); } };
    const weak = makeKg({ sources: [src], extract }, { embedder: fakeEmbedder(), llm: never }, tempDir());
    await expect(ingest(weak, { cacheOnly: true })).rejects.toThrow(/cache has no response/);
    expect(weak.cache.importFrom(exported).added).toBe(1);
    const replay = await ingest(weak, { cacheOnly: true });
    expect(replay.facts).toBe(1);
    expect(replay.llm).toEqual({ made: 0, cached: 1 });
    weak.close();
  });
});

describe('the shadow machine', () => {
  const setup = async () => {
    const f = join(tempDir(), 'log.md');
    writeFileSync(f, '## 2026-03-01: Store is JSON files\nThe store is JSON files.\n\n## 2026-04-02: Store is SQLite\nThe store is SQLite, replacing the decision of 2026-03-01.\n');
    const kg = makeKg({ sources: [{ path: f, adapter: 'decision-log', docKey: 'log' }], searchMachine: 'current-state' }, { embedder: fakeEmbedder() });
    await ingest(kg);
    return { kg, session: kg.openSession('agent') };
  };

  it('logs what the baseline would have returned beside the chosen machine, without returning it', async () => {
    const { kg, session } = await setup();
    const r = await kg.search({ query: 'what is the store', k: 3, sessionId: session, shadow: true });
    expect(r.machine).toBe('current-state');
    const shadow = kg.history.eventsOfType('search.shadow');
    expect(shadow).toHaveLength(1);
    expect(shadow[0]!.searchId).toBe(r.searchId);
    expect(shadow[0]!.payload).toMatchObject({ machine: 'chunk-search', chosen: 'current-state' });
    // the chosen machine dropped the replaced entry; the baseline kept it
    expect((shadow[0]!.payload as { onlyShadow: number }).onlyShadow).toBeGreaterThan(0);
    kg.close();
  });

  it('does nothing when asked not to, or when the chosen machine is the shadow', async () => {
    const { kg, session } = await setup();
    await kg.search({ query: 'what is the store', sessionId: session });
    await kg.search({ query: 'what is the store', sessionId: session, shadow: true, machine: 'chunk-search' });
    expect(kg.history.eventsOfType('search.shadow')).toHaveLength(0);
    kg.close();
  });
});
