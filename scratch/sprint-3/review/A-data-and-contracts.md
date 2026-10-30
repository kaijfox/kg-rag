# Reviewer A: data and contracts (core, store, eventlog, api, design/)

Read: the brief, both design docs, sprint 0/1/2 briefs and retros, decision log, open questions, design feedback, architecture proposal, contract 0.6.1, the four packages' source and cards, their tests. Ran: the four packages' tests (all pass, 4.1 s wall), SQL audits of the two real Sprint 2 databases (copies in the scratchpad), an append-rate probe (0.1 ms per event on a file database; not a concern). No repo file was changed.

## Summary

The data layer is sound and small where it matters. Rules 1, 5 and 6 hold on the real baseline databases (zero violations in SQL audits of `scratch/sprint-2/kardar.kg.sqlite` and `plischke.kg.sqlite`; no seq gaps). Store, eventlog and api total 1,094 lines of source. The weak points are structural. There is no schema migration, so every deferred change (relation order, summary storage) is a trap, and this is probably why 6 empty tables were committed up front. The first expansion cannot write a derived item without contract work. About a quarter of the schema and a good part of `SearchState` serve layers nobody has scheduled. Build names can be written but never read. Findings: 11 (3 arbitrary, 4 evidence-resolvable, 4 needs the user).

## Findings, most severe first

### 1. No schema migration, and two places hold the schema version
- **Finding.** A database file cannot be upgraded; bumping the version would make every open re-run the whole DDL without ever converging.
- **Where.** `packages/core/src/schema.sql:9` (hard-codes `'1'` with `INSERT OR IGNORE`), `core/src/schema.ts:4`, `store/src/db.ts:47-52` and `eventlog/src/sqliteLog.ts:84,193-197` (version check, otherwise `exec` the whole file), and the deferred schema work: `store/src/sqlite-store.ts:221-223` (summary needs a run column), `:288-290` (relation order by rowid; `position` column deferred).
- **Evidence.** Everything in the file is `CREATE ... IF NOT EXISTS`, which never alters an existing table. With `SCHEMA_VERSION = 2` the stored value stays `'1'`, so `schemaCurrent` is false on every open and the write lock is taken each time (the problem review should-fix 2 fixed). The Sprint 2 baseline databases and eval sets are pinned to v1 files, and the roadmap requires that anyone can reproduce the numbers from them.
- **Lens.** 5, 3. **Kind.** Evidence-resolvable. Check: bump the constant in a scratch copy and open a v1 file; the claim above follows from reading, not from a run.
- **Proposed direction.** Own migration list keyed by `PRAGMA user_version` (about 20 lines, no dependency). `schema.sql` becomes migration 1.
- **Plain-language line.** When the relation layer needs one more column, the baseline databases we measured against could not be upgraded in place, and the numbers could not be re-run on the same file.

### 2. The first expansion cannot write a derived item yet
- **Finding.** Whatever Q17 picks, its first step is contract work, because identity, ordering and storage of relations and summaries are all undecided.
- **Where.** `core/src/ids.ts:218-225` (`derivedItemId` throws `not_implemented`), `store/src/sqlite-store.ts:221-223` (summaries rejected), `:288` (rowid order), `scratch/sprint-1/proposed-amendments.md` AM-7 (held), `scratch/sprint-1/retro.md` (Rule 1 and 4 audits "vacuous for derived items").
- **Evidence.** No derived item has ever been written by real code. The Sprint 2 pilot got 83% coverage on 24 chunks, but its relation shape never passed through the store (`scratch/sprint-2/results.md:20`).
- **Lens.** 1, 5. **Kind.** Evidence-resolvable. Check: write the 24 pilot relations through `putItems` and see what breaks.
- **Proposed direction.** Smallest identity: `H(recipe, sorted source chunk ids, normText(text))`. Re-extraction then yields new immutable items, which is what Rule 2 wants. Do it together with finding 1.
- **Plain-language line.** The relation layer is the next big thing, but the storage it will rely on was only ever tested with empty tables, so the first week of that work is plumbing.

### 3. Build names can be written and never read; "winning build becomes current" has no operation
- **Finding.** A build can be given a permanent name, but nothing accepts a name; nothing promotes a build to current except re-ingesting.
- **Where.** `api/src/index.ts:95-103` (`snapshotBuild`), `store/src/sqlite-store.ts:414-433` (`getLabel` has no caller outside store and tests), `search/src/service.ts:51` (takes a build id only), `design/260916_initial-roadmap.md` ("Two builds run ... The winning build becomes current", "Build names are insert-only labels").
- **Evidence.** Grep for `getLabel` and `setCurrentBuild` in non-test source: only `ingest/src/steps.ts:270` moves the pointer.
- **Lens.** 1. **Kind.** Needs the user (finish labels and a promote step, or drop labels; either changes what "build" means to someone using it).
- **Proposed direction.** Smallest useful version: let `search` and eval accept a label wherever they accept a build id, and add promote. Otherwise delete labels and the MCP tool.
- **Plain-language line.** You can name a snapshot but cannot say "search the baseline build" or "make this one live"; the compare-two-builds workflow in the design needs hand-copied ids.

### 4. A quarter of the schema, and much of the search state, serves layers not yet scheduled
- **Finding.** Six tables, 12 triggers, five ID prefixes and four `SearchState` fields are scaffolding with no writer or no reader.
- **Where.** `schema.sql:67-88` (nodes, relation_nodes, summary_members, derivation_runs, mappings, build_runs) and `:139-150` (their triggers); `store/src/sqlite-store.ts:452-494` (`putMappings`: no caller, no reader); `core/src/ids.ts:207-211,245-246` (`nodeId`, `mappingId`, `normName`); `core/src/ports/search.ts:61-80` (`seeds`, `pools`, `notes`, `queries`); `decision-log.md:99` (pools adopted by the user although earlier deferred; the `fuse` step is unbuilt, so pools are write-only); `builds.parent_id` (`schema.sql:58`) is vestigial since AM-5 says lineage is read from the log; `mixedRecipes` is written to the manifest, the column and an event, and read by nobody.
- **Evidence.** 6 of 25 tables never written (all six have 0 rows in the Kardar baseline database). The architecture proposal rated the "cheap seams" as additive; finding 1 is why they were committed early.
- **Lens.** 1, 2. **Kind.** Needs the user (the roadmap's Phase 0 scope asks for "room for derived items, mappings and builds"; removing it changes that scope).
- **Proposed direction.** Once finding 1 exists, delete tables and fields with no scheduled consumer and add them with the layer. Keep nodes, relation_nodes and relation types only if Q17 chooses the relation layer.
- **Plain-language line.** Part of what the tool carries and a newcomer must learn (mappings, derivation runs, pools, seeds) does nothing today.

### 5. Wiring fingerprint and model digest are pinned as literals inside core
- **Finding.** The search machine's topology hash and the embedding model's digest are typed into core's defaults, so core and the golden vectors change when a label is renamed or a model is re-pulled.
- **Where.** `core/src/defaults.ts:35` (`topology: 'ab74647e68ade0b3'`), `:46` (model digest), `testkit/golden/README.md` (an `rc_` and an `es_` each regenerated in 0.5.0 and 0.6.0), `scratch/sprint-1/retro.md` (`topologyOf` "changes with cosmetic labels, so a rename moves every build id").
- **Evidence.** `app/src/compose.ts:105` passes the digest to the embedder, which refuses on mismatch; on any other machine, or after an Ollama update, every ingest and search stops with `precondition`.
- **Lens.** 2. **Kind.** Digest literal: arbitrary (it belongs in the app config file; behaviour is unchanged). Topology fingerprint: needs the user (AM-1, user override of the spike rule; the pipeline retro says its benefit has no consumer).
- **Proposed direction.** Move the digest out of core into config. Smallest recipe for a machine: name, version, settings, with no topology hash.
- **Plain-language line.** Renaming a state in a search step, or updating the embedding model, can silently change the identity of every stored build or stop the tool, and neither shows up as a clear message.

### 6. The log is 87 to 90% of each database, and one step event is about 15 KB
- **Finding.** Event payloads dominate file size; each `search.step` stores the whole 100-candidate list twice as long JSON.
- **Where.** `scratch/sprint-2/kardar.kg.sqlite`: events 8.31 MB against chunk text 0.18 MB, vectors 0.69 MB, parse artifact 0.16 MB. `search.step`: 496 events, 7.22 MB (86.9%), 14.6 KB each; `considered` averages 8.9 KB and `output` 5.3 KB. `scratch/sprint-2/results.md:38` and `design-feedback.md` T1.
- **Evidence.** The Sprint 2 claim (30 to 34 KB per search, 87% step events) checks out: 33.5 KB per search. The Plischke file matches (6.0 of 6.9 MB). Each candidate repeats `"queryId":"q0"` and a 17-digit score. Eval runs write the same events, so a 190-question run adds about 6 MB.
- **Lens.** 4, 5. **Kind.** Evidence-resolvable. Check: re-measure after the first expansion adds steps; delta encoding was deliberately deferred and is still reasonable at 12 MB.
- **Proposed direction.** When it matters: log `considered` only when it differs from the previous step's output, drop `queryId` when only one query exists, round scores.
- **Plain-language line.** The file you would copy to a server is mostly a record of past searches, not your documents; that is fine now but will grow faster once more steps exist.

### 7. Store and eventlog duplicate their database plumbing, and `api` is a package of 115 lines
- **Finding.** The same helpers and the same defect live in two places because the dependency rule forbids sharing.
- **Where.** `store/src/db.ts:17-71` against `eventlog/src/sqliteLog.ts:24-84,192-210` (pragmas, schema-current check, busy mapping); `sprint-1/review-store-eventlog-api-mcp.md` should-fix 1 and 2 hit both files; `api/src/index.ts` depends on `core` only.
- **Evidence.** Both packages run the entire `schema.sql` and write one file through one handle. `api` has two test files and its own card and README for 115 lines that import only core types.
- **Lens.** 3, 2. **Kind.** Arbitrary (layout; behaviour does not change).
- **Proposed direction.** One `sqlite` package owning database open, schema and both ports. Move `api` handlers next to `runTool` in core, or into `app`.
- **Plain-language line.** A fix to how the database is opened has to be made twice and could be made once, which is how one agent can ship a concurrency bug that a second package repeats.

### 8. Contract churn and test scaffolding outweigh the code they protect
- **Finding.** The contract went from 0.4.0 to 0.6.1 within one day, and the fakes, conformance suites and cross-checks for these three packages are larger than the packages.
- **Where.** `design/260916_initial-roadmap.md` amendments (0.4.0, 0.5.0, 0.6.0, 0.6.1 all dated 2026-10-18); 24 files carry the version stamp (`grep 0.6.1`); 9 change-proposal files; `scratch/sprint-0/contract-revisions.md` (36 distinct R numbers). testkit: `fakes/store.ts` 396, `fakes/eventlog.ts` 135, `fakes/kgapi.ts` 114, conformance for store, log, api and eval repo about 990, plus `store/test/crosscheck.test.ts` 166, against 1,094 lines of production code.
- **Evidence.** `scratch/notes/store.md` records the fake and SQLite diverging on clock and float width and the cross-check ignoring `createdAt`. No cross-check divergence turned into a defect (the review lists it as real, but names none found). The real SQLite suite takes 3 s with `:memory:` databases.
- **Lens.** 4. **Kind.** Evidence-resolvable. Check: list defects the fake-versus-real cross-check found; if none, `InMemoryCorpusStore` and `InMemoryEventLog` can go and consumers use `:memory:` SQLite.
- **Proposed direction.** Keep the conformance suites. Stamp the version only in core and let cards say "see core".
- **Plain-language line.** Much of the process cost in these packages went into keeping stand-ins in step with the real thing, not into anything a user of the tool would see.

### 9. Review nits left in place, so some comments are wrong
- **Finding.** Two stale comments and a dead column were noted in Sprint 1 and never applied.
- **Where.** `schema.sql:54` ("L2-normalized"; the store stores vectors as given) and `:58` (`build_id = buildId(manifest)`; it also hashes item ids, `ids.ts:237-243`); `eventlog/src/sqliteLog.ts:230` (returns literal `schemaVersion: 1`, ignores the column); `review-store-eventlog-api-mcp.md` nits 7 and 9.
- **Evidence.** Reading. Cosine search is scale-invariant, so the "normalized" promise on the embedder (`core/src/ports/embed.ts:4`) is needed by nothing downstream.
- **Lens.** 1. **Kind.** Arbitrary.
- **Proposed direction.** Fix the comments; drop either the event `schema_version` column or the literal.
- **Plain-language line.** A person reading the schema to understand what is stored is told two things that are not true.

### 10. Every type is written twice (TypeScript type and a zod mirror)
- **Finding.** `model.ts` (426 lines) declares each shape as a TS type and `schemas.ts` (316 lines) restates it as `z.ZodType<T>`; a field added in 0.6.1 was edited in four files.
- **Where.** `core/src/model.ts:75-82` against `schemas.ts:108-129`; 0.6.1 judge/answerer in `evalTool.ts:26-45`, `schemas.ts:315-316`, `events.ts:184-185`.
- **Evidence.** The compiler catches drift between the two, so it costs effort, not correctness.
- **Lens.** 3. **Kind.** Arbitrary. Candidate: `z.infer` with `.brand()` (zod 4 is already a dependency; no new concept).
- **Proposed direction.** Derive types from the schemas for new shapes; leave existing ones.
- **Plain-language line.** Every contract change costs extra edits that add no behaviour.

### 11. The design doc has accumulated process vocabulary beyond what v0 uses
- **Finding.** The 2026-10-18 amendments add content-addressed, input-addressed, derivation, plan and early cutoff, plus five ID addressing modes and 16 ID prefixes.
- **Where.** `design/260916_initial-roadmap.md` (the "every producer is pinned or guarded" amendment); `core/src/ids.ts:4-16`.
- **Evidence.** "Early cutoff" appears in no code. Five prefixes (`rl_`, `sm_`, `nd_`, `mp_`, `dr_`) have no writer.
- **Lens.** 2. **Kind.** Needs the user (the doc is human-owned).
- **Proposed direction.** Keep two addressing ideas (hash of content or inputs; time-ordered) in the doc. Move the rest to `lifecycle.md`.
- **Plain-language line.** Someone skimming the design doc must learn a taxonomy of ID kinds that has no visible effect on what the tool does.

## Concepts in this area

| Concept | Status |
|---|---|
| Chunk id from document, section path, text, occurrence | needed now |
| Item, kind `chunk`, source chunk list (Rule 1) | needed now |
| Relation, node, node ref, surface, role | needed later (only if Q17 chooses relations) |
| Summary, summary members | unused; needed later only for topic-level work |
| Mapping, mapping kind, derivation run, `build_runs` | unused |
| Recipe, recipe id (Rule 4) | needed now |
| Machine recipe: topology fingerprint, prompt digest | name and settings needed now; topology only guards un-bumped edits |
| Embedding space (model, digest, templates, formula view) | needed now; formula view needed for the decoded-build follow-up |
| Parse artifact (portable, gzipped in database) | needed now as cache; portability needed later (GPU server) |
| Document version, current pointer | needed now |
| Build manifest, item list, current pointer, stale check | needed now |
| Build label | half-built (finding 3) |
| Build parent, mixed-recipes flag | stored, never read |
| Event log, 26 event types, envelope rules, `parentId`, per-session seq | needed now |
| Event `schema_version` | dead column |
| `runTool`, `KgApi`, `ToolDef` | needed now |
| Search state: queries, seeds, pools, notes | unused |
| Insert-only triggers | needed now on 19 tables; 12 triggers sit on unused ones |
| Five ID addressing modes, 16 prefixes | needed: two; 5 prefixes unused |
| Eval run record, orphaned gold | needed now |

## Hand-rolled pieces

- Canonical JSON (RFC 8785): own 30 lines, checked by a Python oracle (`testkit/golden`). The `canonicalize` package would replace it; gain is nil and the oracle already covers the risk. Keep.
- base32 and ULID generator: own, about 40 lines. Candidates (`ulid`) add nothing; the injectable clock is the reason to stay. Keep.
- Schema migration: none (finding 1); own `user_version` list, not a library.
- SQLite error mapping, prepared-statement cache (`store/src/db.ts:57-91`): own. The cache is premature (arbitrary) but cheap.
- Event log, build manifest, immutability triggers: SQLite is already the standard tool; nothing to replace.
- Vector search: `sqlite-vec` brute force already; 34 ms median at 20,000 x 384 (`store/test/latency.test.ts`).
- Otherwise: none found.

## Surprises

- The rules hold on real data with no help: SQL audits show Rule 1, 5, 6 at zero and no seq gaps; `tool.failed` appears 2 and 3 times in the two baselines.
- `design/260916` Rule 5 has no way to retire a document: `documents_no_delete` (`schema.sql:118`) and ingest takes only add or replace (grep found no removal), so chunks of a deleted source file stay current and searchable. Fine for the static corpus; needed later for project databases.
- `getItems` returns only build members and logs the requested ids, not the returned ones (`api/src/index.ts:58-59`), so a refused item leaves no trace.
- `app/src/index.ts:24,43` still builds the skeleton on `InMemoryCorpusStore` from testkit and `app/src/skeleton/api.ts` duplicates `@kg/api`, which Reviewer C should weigh.
- Claims from the retros that checked out: Sprint 0 "storage easier" (store is 502 lines); Sprint 0 "Rule 5 and 6 needed machinery" (`builds.ts`, `ids.ts:237-243`, `events.ts:201-280`); Sprint 1 multi-process loss fixed (`eventlog/test/concurrency.test.ts`, 588 ms); Sprint 2 log size (33.5 KB per search, 86.9%).
- Not found harder than expected: ID derivation and chunk-ID stability held; the golden-vector oracle caught nothing but is cheap to keep.
