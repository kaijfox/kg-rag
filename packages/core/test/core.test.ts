import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import {
  CONTRACT_VERSION,
  DEFAULT_SPACE,
  DEFAULT_PARSE_RECIPE,
  parseRecipeSchema,
  stepTraceSchema,
  EVENT_TYPES,
  KgError,
  PAYLOADS,
  SCHEMA_VERSION,
  TOOLS,
  TOOL_NAMES,
  buildId,
  composeBuild,
  cosineScore,
  orphanedGold,
  derivedItemId,
  fuseMax,
  isProperlyRanked,
  renderDocument,
  renderQuery,
  runTool,
  schemaSql,
  sortCandidates,
  toRankedRefs,
  ulidGen,
  validateEventDraft,
  validateSpace,
  type BuildId,
  type EventDraft,
  type EventEnvelope,
  type EventLog,
  type ItemId,
  type RecipeId,
  type SessionId,
  type ArtifactId,
  type DocVersion,
  embeddingSpaceSpecSchema,
  spaceId,
  DEFAULT_SEARCH_RECIPE,
  EVAL_RUN_TOOL,
  machineMapSchema,
  recipeId,
  recipesEqual,
  searchRecipeSchema,
  validateMachineMap,
} from '../src/index';

describe('schema.sql', () => {
  const open = () => {
    const db = new Database(':memory:');
    db.exec(schemaSql());
    return db;
  };
  it('applies cleanly and idempotently, and records the schema version', () => {
    const db = open();
    db.exec(schemaSql());
    expect(db.prepare("select value from db_meta where key='schema_version'").get()).toEqual({ value: String(SCHEMA_VERSION) });
    const tables = (db.prepare("select name from sqlite_master where type='table' order by name").all() as { name: string }[]).map((r) => r.name);
    for (const t of ['items', 'chunks', 'doc_version_chunks', 'embeddings', 'builds', 'build_items', 'build_labels', 'mappings', 'derivation_runs', 'nodes', 'relation_nodes', 'summary_members', 'events', 'sessions', 'session_notes', 'eval_runs', 'eval_results'])
      expect(tables).toContain(t);
  });
  it('events are append-only and items insert-only (triggers)', () => {
    const db = open();
    db.prepare("insert into sessions values ('se_1','test',null,'{}','t')").run();
    db.prepare("insert into events values ('ev_1','se_1',1,'t','tool.called',1,null,null,null,'{}')").run();
    expect(() => db.prepare("update events set payload='x'").run()).toThrow(/append-only/);
    expect(() => db.prepare('delete from events').run()).toThrow(/append-only/);
    db.prepare("insert into items values ('ch_1','chunk','t',null,'{}','t')").run();
    expect(() => db.prepare("update items set text='y'").run()).toThrow(/insert-only/);
    expect(() => db.prepare('delete from items').run()).toThrow(/insert-only/);
  });
  it('Rule 4 CHECK: only chunks may lack a recipe; documents pointer is the mutable row', () => {
    const db = open();
    expect(() => db.prepare("insert into items values ('rl_1','relation','t',null,'{}','t')").run()).toThrow(/CHECK/);
    db.prepare("insert into documents values ('gas', null)").run();
    db.prepare("update documents set current_version='dv_1' where doc_key='gas'").run();
    expect(() => db.prepare('delete from documents').run()).toThrow();
  });
});

describe('scoring', () => {
  const id = (s: string) => s as ItemId;
  it('sortCandidates: score desc, then itemId asc; ranks 1-based', () => {
    const xs = [
      { itemId: id('ch_b'), score: 0.5 },
      { itemId: id('ch_a'), score: 0.5 },
      { itemId: id('ch_c'), score: 0.9 },
    ];
    const s = sortCandidates(xs);
    expect(s.map((x) => x.itemId)).toEqual(['ch_c', 'ch_a', 'ch_b']);
    expect(toRankedRefs(s).map((r) => r.rank)).toEqual([1, 2, 3]);
    expect(isProperlyRanked(toRankedRefs(s))).toBe(true);
    expect(isProperlyRanked(toRankedRefs(xs))).toBe(false);
  });
  it('fuseMax keeps the best score per item', () => {
    expect(fuseMax([{ itemId: id('a'), score: 0.2 }, { itemId: id('b'), score: 0.3 }, { itemId: id('a'), score: 0.7 }])).toEqual([
      { itemId: 'a', score: 0.7 },
      { itemId: 'b', score: 0.3 },
    ]);
  });
  it('cosineScore = 1 - cosine distance; zero vector scores 0', () => {
    expect(cosineScore([1, 0], [1, 0])).toBe(1);
    expect(cosineScore([1, 0], [0, 1])).toBe(0);
    expect(cosineScore([3, 4], [4, 3])).toBeCloseTo(24 / 25, 12);
    expect(cosineScore([0, 0], [1, 0])).toBe(0);
  });
});

describe('conditioning', () => {
  it('renders the default space templates', () => {
    expect(renderDocument(DEFAULT_SPACE, { text: 'S never decreases.', sectionPath: ['2 Entropy', '2.1 Definition'] })).toBe('title: 2 Entropy > 2.1 Definition | text: S never decreases.');
    expect(renderDocument(DEFAULT_SPACE, { text: 'x' })).toBe('title:  | text: x');
    expect(renderQuery(DEFAULT_SPACE, 'what is entropy')).toBe('task: search result | query: what is entropy');
  });
  it('rejects unknown placeholders and missing main placeholders', () => {
    expect(() => validateSpace({ ...DEFAULT_SPACE, documentTemplate: '{title} {text}' })).toThrow(KgError);
    expect(() => validateSpace({ ...DEFAULT_SPACE, queryTemplate: 'no placeholder' })).toThrow(KgError);
    expect(() => renderDocument({ ...DEFAULT_SPACE, documentTemplate: '{body}' }, { text: 'x' })).toThrow(KgError);
  });
  it('item text containing braces is not re-substituted', () => {
    expect(renderDocument({ ...DEFAULT_SPACE, documentTemplate: '{headings}|{text}' }, { text: 'a {headings} b', sectionPath: ['H'] })).toBe('H|a {headings} b');
  });
});

describe('events catalog', () => {
  it('every type has a payload schema; tool names are unique', () => {
    expect(EVENT_TYPES.length).toBe(Object.keys(PAYLOADS).length);
    expect(new Set(TOOL_NAMES.map((k) => TOOLS[k].name)).size).toBe(TOOL_NAMES.length);
  });
  it('validateEventDraft enforces buildId on build-dependent events', () => {
    const base = { sessionId: 'se_00000000000000000000000001', searchId: 'sr_00000000000000000000000001', parentId: null };
    const q = { ...base, type: 'query', buildId: null, payload: { query: 'x', k: 1, searchRecipeId: 'rc_aaaaaaaaaaaaaaaaaaaa' } };
    expect(() => validateEventDraft(q)).toThrow(/Rule 6/);
    expect(validateEventDraft({ ...q, buildId: 'bd_aaaaaaaaaaaaaaaaaaaa' }).type).toBe('query');
  });
  it('derivedItemId is reserved', () => {
    expect(() => derivedItemId('relation', 'rc_a' as RecipeId, [], 'x')).toThrow(/reserved/);
  });
});

describe('composeBuild', () => {
  it('sorts items, records mixed recipes, is content-addressed', () => {
    const dv = (k: string, a: string, c: string, ids: string[]): DocVersion => ({ id: `dv_${k}` as never, docKey: k as never, artifactId: a as ArtifactId, chunkRecipeId: c as RecipeId, chunkIds: ids as never, createdAt: 't' });
    const one = composeBuild({ docVersions: [dv('b', 'pa_1', 'rc_c', ['ch_z', 'ch_a']), dv('a', 'pa_2', 'rc_c', ['ch_m'])], parseRecipeOf: () => 'rc_p' as RecipeId, spaceIds: ['es_1' as never], searchRecipeId: 'rc_s' as RecipeId, parentId: null });
    expect(one.itemIds).toEqual(['ch_a', 'ch_m', 'ch_z']);
    expect(one.manifest.mixedRecipes).toBe(false);
    const mixed = composeBuild({ docVersions: [dv('b', 'pa_1', 'rc_c', ['ch_z']), dv('a', 'pa_2', 'rc_c', ['ch_m'])], parseRecipeOf: (a) => (a === 'pa_1' ? 'rc_p' : 'rc_q') as RecipeId, spaceIds: ['es_1' as never], searchRecipeId: 'rc_s' as RecipeId, parentId: null });
    expect(mixed.manifest.mixedRecipes).toBe(true);
    const again = composeBuild({ docVersions: [dv('a', 'pa_2', 'rc_c', ['ch_m']), dv('b', 'pa_1', 'rc_c', ['ch_a', 'ch_z'])], parseRecipeOf: () => 'rc_p' as RecipeId, spaceIds: ['es_1' as never], searchRecipeId: 'rc_s' as RecipeId, parentId: 'bd_x' as BuildId });
    expect(again.id).toBe(one.id); // parent and input order do not enter the ID
  });
});

describe('runTool', () => {
  function memLog() {
    const evs: EventEnvelope[] = [];
    let n = 0;
    const log: EventLog = {
      openSession: () => 'se_00000000000000000000000001' as SessionId,
      append(e: EventDraft) {
        const env = { ...validateEventDraft(e), id: `ev_${String(++n).padStart(26, '0')}`, seq: n + 1, ts: '2026-10-17T12:00:00.000Z', schemaVersion: 1 } as EventEnvelope;
        evs.push(env);
        return env;
      },
    };
    return { log, evs };
  }
  const rt = (log: EventLog) => ({ log, clock: { now: () => '2026-10-17T12:00:00.000Z', monotonicMs: () => 0 }, ids: ulidGen(), currentBuild: () => null });
  const S = 'se_00000000000000000000000001' as SessionId;
  it('a throwing handler yields tool.called then tool.failed with the KgError code, and rethrows', async () => {
    const { log, evs } = memLog();
    await expect(runTool(rt(log), TOOLS.addNote, S, { text: 'x' }, async () => { throw new KgError('precondition', 'nope'); })).rejects.toThrow('nope');
    expect(evs.map((e) => e.type)).toEqual(['tool.called', 'tool.failed']);
    expect(evs[1]!.payload).toMatchObject({ tool: 'add_note', error: { code: 'precondition', message: 'nope' } });
    expect(evs[1]!.parentId).toBe(evs[0]!.id);
  });
  it('a handler whose output violates the contract fails as internal', async () => {
    const { log, evs } = memLog();
    await expect(runTool(rt(log), TOOLS.addNote, S, { text: 'x' }, async () => ({ noteId: -1 }))).rejects.toThrow(/contract/);
    expect(evs.at(-1)!.payload).toMatchObject({ error: { code: 'internal' } });
  });
  it('a non-KgError is logged as internal', async () => {
    const { log, evs } = memLog();
    await expect(runTool(rt(log), TOOLS.addNote, S, { text: 'x' }, async () => { throw new Error('bug'); })).rejects.toThrow('bug');
    expect(evs.at(-1)!.payload).toMatchObject({ error: { code: 'internal', message: 'bug' } });
  });
});

describe('generated JSON Schemas', () => {
  it('schemas/*.schema.json are up to date with the zod schemas (run pnpm --filter @kg/core gen:schemas)', async () => {
    const { readFileSync } = await import('node:fs');
    const { parseArtifactJsonSchema, parseRecipeJsonSchema } = await import('../src/index');
    const read = (f: string) => JSON.parse(readFileSync(new URL(`../schemas/${f}`, import.meta.url), 'utf8'));
    expect(read('parse-artifact.schema.json')).toEqual(JSON.parse(JSON.stringify(parseArtifactJsonSchema())));
    expect(read('parse-recipe.schema.json')).toEqual(JSON.parse(JSON.stringify(parseRecipeJsonSchema())));
  });
});

describe('search tool input', () => {
  it('k defaults to 10 when omitted, and is still bounded', async () => {
    const { TOOLS, DEFAULT_K, MAX_K } = await import('../src/index');
    expect(DEFAULT_K).toBe(10);
    expect(TOOLS.search.input.parse({ query: 'x' })).toMatchObject({ query: 'x', k: 10 });
    expect(TOOLS.search.input.parse({ query: 'x', k: 3 })).toMatchObject({ k: 3 });
    expect(TOOLS.search.input.safeParse({ query: 'x', k: MAX_K + 1 }).success).toBe(false);
    expect(TOOLS.search.input.safeParse({ query: 'x', k: 0 }).success).toBe(false);
  });
  it('the MCP input schema lists k as optional with its default', async () => {
    const { toolInputJsonSchema } = await import('../src/index');
    const sch = toolInputJsonSchema('search') as unknown as { required?: string[]; properties: Record<string, { default?: number }> };
    expect(sch.required).toEqual(['query']);
    expect(sch.properties.k!.default).toBe(10);
  });
});

describe('0.2.0 additions', () => {
  const S = 'se_00000000000000000000000001' as SessionId;
  const S2 = 'se_00000000000000000000000002' as SessionId;
  function memLog() {
    const evs: EventEnvelope[] = [];
    let n = 0;
    const log: EventLog = {
      openSession: () => S,
      append(e: EventDraft) {
        const env = { ...validateEventDraft(e), id: `ev_${String(++n).padStart(26, '0')}`, seq: n + 1, ts: '2026-10-17T12:00:00.000Z', schemaVersion: 1 } as EventEnvelope;
        evs.push(env);
        return env;
      },
    };
    return { log, evs };
  }
  const B1 = 'bd_aaaaaaaaaaaaaaaaaaaa' as BuildId;
  const B2 = 'bd_bbbbbbbbbbbbbbbbbbbb' as BuildId;

  it('P-3: a nested runTool in the same session is parented to the enclosing tool.called; other sessions and parallel calls are not', async () => {
    const { log, evs } = memLog();
    const rt = { log, clock: { now: () => '2026-10-17T12:00:00.000Z', monotonicMs: () => 0 }, ids: ulidGen(), currentBuild: () => null };
    await runTool(rt, TOOLS.addNote, S, { text: 'outer' }, async () => {
      await runTool(rt, TOOLS.addNote, S, { text: 'inner' }, async () => ({ noteId: 2 }));
      await runTool(rt, TOOLS.addNote, S2, { text: 'other session' }, async () => ({ noteId: 3 }));
      return { noteId: 1 };
    });
    await Promise.all([1, 2].map((i) => runTool(rt, TOOLS.addNote, S, { text: `parallel ${i}` }, async () => ({ noteId: 10 + i }))));
    const called = evs.filter((e) => e.type === 'tool.called');
    const outer = called[0]!;
    expect(outer.parentId).toBeNull();
    expect(called[1]!.parentId).toBe(outer.id); // nested, same session
    expect(called[2]!.parentId).toBeNull(); // nested call for another session
    expect(called.slice(3).map((e) => e.parentId)).toEqual([null, null]); // top-level parallel calls
  });

  it('the default buildId is the current build when an event is written, not at call start (R-10)', async () => {
    const { log, evs } = memLog();
    let cur: BuildId = B1;
    const rt = { log, clock: { now: () => '2026-10-17T12:00:00.000Z', monotonicMs: () => 0 }, ids: ulidGen(), currentBuild: () => cur };
    await runTool(rt, TOOLS.getItems, S, { itemIds: ['ch_aaaaaaaaaaaaaaaaaaaa'] }, async (ctx, i) => {
      cur = B2;
      ctx.emit('items.fetched', { itemIds: i.itemIds });
      return { items: [] };
    });
    expect(evs.map((e) => [e.type, e.buildId])).toEqual([['tool.called', B1], ['items.fetched', B2], ['tool.returned', B2]]);
  });

  it('mixedRecipes is true for two chunk recipes with one parse recipe', () => {
    const dv = (k: string, c: string): DocVersion => ({ id: `dv_${k}` as never, docKey: k as never, artifactId: `pa_${k}` as ArtifactId, chunkRecipeId: c as RecipeId, chunkIds: [`ch_${k}`] as never, createdAt: 't' });
    const b = composeBuild({ docVersions: [dv('a', 'rc_c1'), dv('b', 'rc_c2')], parseRecipeOf: () => 'rc_p' as RecipeId, spaceIds: ['es_1' as never], searchRecipeId: 'rc_s' as RecipeId, parentId: null });
    expect(b.manifest.mixedRecipes).toBe(true);
  });

  it('S1: the build ID changes with the items even when the manifest does not', () => {
    const m = { docVersions: {}, embeddingSpaces: [], searchRecipeId: 'rc_s' as RecipeId, derivedRecipes: [], mappingRuns: [], mixedRecipes: false };
    expect(buildId(m, ['ch_a' as ItemId])).not.toBe(buildId(m, ['ch_a' as ItemId, 'rl_b' as ItemId]));
    expect(buildId(m, ['ch_b' as ItemId, 'ch_a' as ItemId, 'ch_a' as ItemId])).toBe(buildId(m, ['ch_a' as ItemId, 'ch_b' as ItemId]));
  });

  it('eval.run.started: payload buildId must equal the envelope buildId', () => {
    const base = { sessionId: S, searchId: null, parentId: null, type: 'eval.run.started', payload: { runId: 'er_00000000000000000000000001', buildId: B1, evalSetId: 'qs_aaaaaaaaaaaaaaaaaaaa', evalSetSha256: 'a'.repeat(64), conditions: ['retrieved'], ks: [1] } };
    expect(() => validateEventDraft({ ...base, buildId: B2 })).toThrow(/must equal payload.buildId/);
    expect(validateEventDraft({ ...base, buildId: B1 }).type).toBe('eval.run.started');
  });

  it('orphanedGold lists questions whose gold chunks are not in the build', () => {
    const store = { getBuild: (id: BuildId) => (id === B1 ? ({ itemIds: ['ch_a', 'ch_b'] } as never) : null) };
    const set = {
      questions: [
        { id: 'q1', goldChunkIds: ['ch_a'] },
        { id: 'q2', goldChunkIds: ['ch_b', 'ch_z'] },
        { id: 'q3', goldChunkIds: ['ch_y', 'ch_x'] },
      ] as never,
    };
    expect(orphanedGold(set, store, B1)).toEqual([
      { questionId: 'q2', missing: ['ch_z'], allMissing: false },
      { questionId: 'q3', missing: ['ch_x', 'ch_y'], allMissing: true },
    ]);
    expect(() => orphanedGold(set, store, B2)).toThrow(KgError);
  });
});

describe('0.3.0 additions (P-1 pools)', () => {
  it('stepTraceSchema accepts an optional pools summary and rejects a malformed one', () => {
    const base = { stepIndex: 0, state: 'retrieve', stepType: 'vector-knn', params: {}, considered: [], output: [], durationMs: 1 };
    expect(stepTraceSchema.safeParse(base).success).toBe(true);
    const ref = { itemId: 'ch_' + 'a'.repeat(20), score: 0.5, rank: 1, queryId: 'q0' };
    expect(stepTraceSchema.safeParse({ ...base, pools: { 'sub:q0': [ref] } }).success).toBe(true);
    expect(stepTraceSchema.safeParse({ ...base, pools: { '': [ref] } }).success).toBe(false);
    expect(stepTraceSchema.safeParse({ ...base, pools: { a: [{ ...ref, rank: 'x' }] } }).success).toBe(false);
  });
});

describe('0.4.0 additions (CP-01a digest, CP-02 mapping kinds, pointer events)', () => {
  it('CONTRACT_VERSION is 0.6.1', () => expect(CONTRACT_VERSION).toBe('0.6.1'));
  it('EmbeddingSpaceSpec requires a digest, and the digest enters the SpaceId', () => {
    expect(embeddingSpaceSpecSchema.safeParse(DEFAULT_SPACE).success).toBe(true);
    const { digest: _d, ...noDigest } = DEFAULT_SPACE;
    expect(embeddingSpaceSpecSchema.safeParse(noDigest).success).toBe(false);
    expect(embeddingSpaceSpecSchema.safeParse({ ...DEFAULT_SPACE, digest: '' }).success).toBe(false);
    expect(spaceId({ ...DEFAULT_SPACE, digest: 'other' })).not.toBe(spaceId(DEFAULT_SPACE));
  });
  it('mappings.kind accepts superseded-by / refined-by and rejects the old names', () => {
    const db = new Database(':memory:');
    db.exec(schemaSql());
    db.prepare("insert into recipes values ('rc_1','search','1','{}')").run();
    db.prepare("insert into derivation_runs values ('rn_1','rc_1','h',null,'t')").run();
    const ins = (id: string, kind: string) => db.prepare("insert into mappings values (?,?, 'item','ch_a','ch_b','rn_1',null,null)").run(id, kind);
    ins('mp_1', 'superseded-by');
    ins('mp_2', 'refined-by');
    expect(() => ins('mp_3', 'supersedes')).toThrow(/CHECK/);
    expect(() => ins('mp_4', 'refines')).toThrow(/CHECK/);
  });
  it('ingest.completed.previousDocVersionId and build.created.revert are optional additions', () => {
    const dv = 'dv_' + 'a'.repeat(20);
    const base = { docKey: 'gas', docVersionId: dv, unchanged: false };
    expect(PAYLOADS['ingest.completed'].safeParse(base).success).toBe(true);
    expect(PAYLOADS['ingest.completed'].safeParse({ ...base, previousDocVersionId: null }).success).toBe(true);
    expect(PAYLOADS['ingest.completed'].safeParse({ ...base, previousDocVersionId: dv }).success).toBe(true);
    expect(PAYLOADS['ingest.completed'].safeParse({ ...base, previousDocVersionId: 'x' }).success).toBe(false);
    const b = { buildId: 'bd_' + 'a'.repeat(20), parentId: null, mixedRecipes: false, itemCount: 1 };
    expect(PAYLOADS['build.created'].safeParse(b).success).toBe(true);
    expect(PAYLOADS['build.created'].safeParse({ ...b, revert: true }).success).toBe(true);
    expect(PAYLOADS['build.created'].safeParse({ ...b, revert: 'yes' }).success).toBe(false);
  });
});

describe('0.6.0 additions (formula view, formula decoding)', () => {
  it('the default space is the placeholder view and a missing or unknown view is rejected', () => {
    expect(DEFAULT_SPACE.formulaView).toBe('placeholder');
    expect(embeddingSpaceSpecSchema.safeParse(DEFAULT_SPACE).success).toBe(true);
    const { formulaView: _v, ...without } = DEFAULT_SPACE;
    expect(embeddingSpaceSpecSchema.safeParse(without).success).toBe(false);
    expect(embeddingSpaceSpecSchema.safeParse({ ...DEFAULT_SPACE, formulaView: 'latex' }).success).toBe(false);
  });
  it('the formula view is part of the space id', () => {
    expect(spaceId({ ...DEFAULT_SPACE, formulaView: 'full' })).not.toBe(spaceId(DEFAULT_SPACE));
  });
  it('formulaDecoding is optional on the parse recipe, strict when present, and absent keeps the recipe id', () => {
    expect(parseRecipeSchema.safeParse(DEFAULT_PARSE_RECIPE).success).toBe(true);
    const fd = { model: 'mlx-community/GLM-OCR-4bit', revision: 'abc123', prompt: 'Formula Recognition:', cropMargin: 0.18 };
    const withFd = { ...DEFAULT_PARSE_RECIPE, spec: { ...DEFAULT_PARSE_RECIPE.spec, formulaDecoding: fd } };
    expect(parseRecipeSchema.safeParse(withFd).success).toBe(true);
    expect(parseRecipeSchema.safeParse({ ...withFd, spec: { ...withFd.spec, formulaDecoding: { ...fd, extra: 1 } } }).success).toBe(false);
    expect(parseRecipeSchema.safeParse({ ...withFd, spec: { ...withFd.spec, formulaDecoding: { ...fd, cropMargin: -1 } } }).success).toBe(false);
    expect(recipeId(withFd)).not.toBe(recipeId(DEFAULT_PARSE_RECIPE));
    expect(recipeId(withFd)).not.toBe(recipeId({ ...withFd, spec: { ...withFd.spec, formulaDecoding: { ...fd, revision: 'other' } } }));
  });
});

describe('0.5.0 additions (machine recipes, pipeline events, state on traces)', () => {
  const S1 = 'se_00000000000000000000000001';
  const SR = 'sr_00000000000000000000000001';
  const B1 = 'bd_' + 'a'.repeat(20);
  const RC = 'rc_' + 'a'.repeat(20);
  const env = { sessionId: S1, parentId: null };
  const started = (pipeline: string) => ({ pipeline, machine: 'similarity', version: '1', topology: '0123456789abcdef', recipeId: RC });
  const finished = (pipeline: string) => ({ pipeline, status: 'done', state: 'done' });

  it('the default search recipe is a machine recipe and passes its strict schema', () => {
    expect(searchRecipeSchema.safeParse(DEFAULT_SEARCH_RECIPE).success).toBe(true);
    expect(DEFAULT_SEARCH_RECIPE.spec.machine).toBe('similarity');
    expect(recipeId(DEFAULT_SEARCH_RECIPE)).toMatch(/^rc_/);
  });
  it('searchRecipeSchema rejects the old step list, a bad topology and a bad prompt digest; accepts a digest', () => {
    const r = DEFAULT_SEARCH_RECIPE;
    expect(searchRecipeSchema.safeParse({ kind: 'search', version: '1', spec: { steps: [] } }).success).toBe(false);
    expect(searchRecipeSchema.safeParse({ ...r, spec: { ...r.spec, topology: 'XYZ' } }).success).toBe(false);
    expect(searchRecipeSchema.safeParse({ ...r, spec: { ...r.spec, promptDigest: 'abc' } }).success).toBe(false);
    expect(searchRecipeSchema.safeParse({ ...r, spec: { ...r.spec, promptDigest: 'a'.repeat(64) } }).success).toBe(true);
    expect(searchRecipeSchema.safeParse({ ...r, spec: { ...r.spec, extra: 1 } }).success).toBe(false);
  });
  it('promptDigest, settings and topology each change the recipe id', () => {
    const r = DEFAULT_SEARCH_RECIPE;
    const ids = new Set([
      recipeId(r),
      recipeId({ ...r, spec: { ...r.spec, promptDigest: 'a'.repeat(64) } }),
      recipeId({ ...r, spec: { ...r.spec, settings: { pool: 50, kinds: ['chunk'] } } }),
      recipeId({ ...r, spec: { ...r.spec, topology: '0'.repeat(16) } }),
    ]);
    expect(ids.size).toBe(4);
  });
  it('stepTraceSchema requires a non-empty state', () => {
    const base = { stepIndex: 0, stepType: 'vector-knn', params: {}, considered: [], output: [], durationMs: 0 };
    expect(stepTraceSchema.safeParse(base).success).toBe(false);
    expect(stepTraceSchema.safeParse({ ...base, state: '' }).success).toBe(false);
    expect(stepTraceSchema.safeParse({ ...base, state: 'retrieve' }).success).toBe(true);
  });
  it('pipeline.started / pipeline.finished payloads round-trip and are strict', () => {
    expect(PAYLOADS['pipeline.started'].safeParse(started('search')).success).toBe(true);
    expect(PAYLOADS['pipeline.started'].safeParse({ ...started('search'), recipeId: null }).success).toBe(true);
    expect(PAYLOADS['pipeline.started'].safeParse({ ...started('search'), topology: 'nope' }).success).toBe(false);
    expect(PAYLOADS['pipeline.started'].safeParse({ ...started('search'), pipeline: 'other' }).success).toBe(false);
    expect(PAYLOADS['pipeline.finished'].safeParse(finished('search')).success).toBe(true);
    const failed = { ...finished('ingest'), status: 'failed', state: 'parsing', error: { code: 'upstream', message: 'x' } };
    expect(PAYLOADS['pipeline.finished'].safeParse(failed).success).toBe(true);
    expect(PAYLOADS['pipeline.finished'].safeParse({ ...failed, status: 'paused' }).success).toBe(false);
    expect(PAYLOADS['pipeline.finished'].safeParse({ ...failed, extra: 1 }).success).toBe(false);
  });
  it('pipeline events: envelope tags depend on the pipeline kind', () => {
    const ev = (type: string, payload: unknown, buildId: string | null, searchId: string | null) => ({ ...env, type, payload, buildId, searchId });
    for (const type of ['pipeline.started', 'pipeline.finished']) {
      const p = (k: string) => (type === 'pipeline.started' ? started(k) : finished(k));
      expect(() => validateEventDraft(ev(type, p('search'), B1, SR))).not.toThrow();
      expect(() => validateEventDraft(ev(type, p('search'), null, SR))).toThrow(/buildId/);
      expect(() => validateEventDraft(ev(type, p('search'), B1, null))).toThrow(/searchId/);
      expect(() => validateEventDraft(ev(type, p('eval-run'), B1, null))).not.toThrow();
      expect(() => validateEventDraft(ev(type, p('eval-run'), null, null))).toThrow(/buildId/);
      expect(() => validateEventDraft(ev(type, p('ingest'), null, null))).not.toThrow();
      expect(() => validateEventDraft(ev(type, p('ingest'), B1, null))).not.toThrow();
      expect(() => validateEventDraft(ev(type, p('eval-generate'), null, null))).not.toThrow();
    }
  });
  it('eval.run.started and the eval_run tool accept an optional searchRecipes map', () => {
    const base = { runId: 'er_00000000000000000000000001', buildId: B1, evalSetId: 'qs_aaaaaaaaaaaaaaaaaaaa', evalSetSha256: 'a'.repeat(64), conditions: ['retrieved:k100'], ks: [1] };
    expect(PAYLOADS['eval.run.started'].safeParse(base).success).toBe(true);
    expect(PAYLOADS['eval.run.started'].safeParse({ ...base, searchRecipes: { 'retrieved:k100': RC } }).success).toBe(true);
    expect(PAYLOADS['eval.run.started'].safeParse({ ...base, searchRecipes: { 'retrieved:k100': 'x' } }).success).toBe(false);
    const { buildId: _b, runId: _r, ...input } = base;
    expect(EVAL_RUN_TOOL.input.safeParse({ ...input, searchRecipes: { a: RC } }).success).toBe(true);
    expect(EVAL_RUN_TOOL.input.safeParse({ ...input, searchRecipes: { a: 'x' } }).success).toBe(false);
  });
  it('eval.run.started records the judge and answerer (0.6.1): optional to parse, strict when present', () => {
    const base = { runId: 'er_00000000000000000000000001', buildId: B1, evalSetId: 'qs_aaaaaaaaaaaaaaaaaaaa', evalSetSha256: 'a'.repeat(64), conditions: ['retrieved'], ks: [1] };
    const judge = { recipeId: RC, model: 'qwen3.5' };
    const answerer = { model: 'qwen3.5', promptDigest: 'b'.repeat(64) };
    expect(PAYLOADS['eval.run.started'].safeParse({ ...base, judge, answerer }).success).toBe(true);
    expect(PAYLOADS['eval.run.started'].safeParse({ ...base, judge }).success).toBe(true);
    expect(PAYLOADS['eval.run.started'].safeParse({ ...base, judge: { ...judge, extra: 1 } }).success).toBe(false);
    expect(PAYLOADS['eval.run.started'].safeParse({ ...base, answerer: { ...answerer, promptDigest: 'x' } }).success).toBe(false);
    expect(PAYLOADS['eval.run.started'].safeParse({ ...base, judge: { recipeId: 'x', model: 'm' } }).success).toBe(false);
  });
  it('recipesEqual compares canonical JSON (key order does not matter, a setting does)', () => {
    const r = DEFAULT_PARSE_RECIPE;
    const reordered = JSON.parse(JSON.stringify({ spec: r.spec, version: r.version, kind: r.kind }));
    expect(recipesEqual(r, reordered)).toBe(true);
    expect(recipesEqual(r, { ...r, version: r.version + 'x' })).toBe(false);
    expect(recipesEqual(r, r)).toBe(recipeId(r) === recipeId(reordered));
  });
  it('MachineMap: zod shape and structural validation', () => {
    const map = {
      machine: 'similarity', version: '1', topology: '0123456789abcdef', initial: 'retrieve',
      nodes: [
        { id: 'retrieve', parent: null, kind: 'work', label: 'retrieve', logs: ['search.step'], step: 'vector-knn', loop: false },
        { id: 'cut', parent: null, kind: 'work', label: 'cut', logs: ['search.step'], step: 'truncate', loop: false },
        { id: 'done', parent: null, kind: 'final', label: 'done', logs: [], step: null, loop: false },
        { id: 'failed', parent: null, kind: 'final', label: 'failed', logs: [], step: null, loop: false },
      ],
      edges: [
        { from: 'retrieve', to: 'cut', event: 'done', guard: null },
        { from: 'retrieve', to: 'failed', event: 'error', guard: null },
        { from: 'cut', to: 'done', event: 'done', guard: null },
        { from: 'cut', to: 'failed', event: 'error', guard: null },
      ],
    };
    expect(machineMapSchema.safeParse(map).success).toBe(true);
    expect(validateMachineMap(map)).toEqual([]);
    expect(validateMachineMap({ ...map, initial: 'nowhere' })).toEqual([expect.stringMatching(/initial/)]);
    expect(validateMachineMap({ ...map, edges: map.edges.slice(1) })).toEqual([]);
    expect(validateMachineMap({ ...map, edges: [...map.edges, { from: 'cut', to: 'ghost', event: 'always', guard: null }] })).toEqual([expect.stringMatching(/ghost/)]);
    expect(validateMachineMap({ ...map, edges: [...map.edges, { from: 'done', to: 'cut', event: 'always', guard: null }] })).toEqual([expect.stringMatching(/final node done/)]);
    expect(validateMachineMap({ ...map, nodes: [...map.nodes, map.nodes[0]] })[0]).toMatch(/duplicate/);
    expect(validateMachineMap({ ...map, extra: 1 }).length).toBeGreaterThan(0);
  });
});
