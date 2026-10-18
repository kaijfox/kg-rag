# Oracle diff: skeleton vs chunk, ingest, search, api, embed

Method: both implementations run side by side with ad-hoc scripts (in `/private/tmp/claude-501/-Users-kaifox-projects-obsidian-kg-rag/b3ffbe4d-db25-4a6e-890f-f24051bb8dfd/scratchpad/od/`: chunk.ts, split.ts, ingest.ts, search.ts, emb.ts, edge.ts). Same `FixedClock`/`SeqIds`, same fakes, ids and messages normalised. Package chunker used for both ingest runs, so only ingest logic is compared there.

## Agreement
- chunk: mini v1/v2 (4 docs), dupsec and the 3 real docling slices are identical to the skeleton (text, ids, pages, blockRefs).
- ingest: 17 scenarios (first, repeat, v2, revert, artifact import, space switch, custom docKey, duplicate docKey, fresh-DB failure, mid-batch embedder failure, extras failure, empty/missing) give equal reports, equal domain events and payloads, equal embedder texts (54/54, 45/45), equal final build and doc versions.
- api: all 11 handler paths equal (events, tags, results, error codes), including Rule 6 after a build switch and `reportOutcome` without a search.
- search: results, scores, ranks, considered/output lists, `search.result`, stale flag equal on 6 fixture queries, k=1/50, pinned v1.
- embed: request URL, method and body byte-equal; batching and empty input equal.

## Divergences

| # | Area | Divergence | Verdict | Deciding text |
|---|---|---|---|---|
| 1 | chunk `split.ts:51` | Sentence cut requires the uppercase letter to lie inside the window; skeleton accepts a `.` inside the window followed by whitespace+uppercase beyond it. 116/2000 random sentence-prose blocks split differently (ids differ). | skeleton-is-right | mini-corpus README:18 "last `. `+uppercase boundary that keeps the piece <= M"; the piece ends at the period. Card rule 3 "last `.` in it that is followed by..." is ambiguous. |
| 2 | chunk `split.ts:57` | Hard cut `shortestPrefixReaching` can overshoot M: normText jumps by 2 across whitespace, so length M may be unattainable and the piece is M+1 (e.g. 23 > 22). 313/2000 sentence-less 400-word blocks at M=1500 produce a piece > M. Skeleton falls back to the longest prefix <= M. | skeleton-is-right | Card rule 3 "SHORTEST prefix whose normalized length is M" has no case for unattainable M; sizes invariant (chunk <= M). |
| 3 | chunk inline group | Package puts the group's own `#/groups/N` in blockRefs and joins raw `t.text`; skeleton omits the group ref and uses `[formula]` for empty formula children. | ambiguous (refs); package-wrong for formulas | Card rule 1 "join the texts of its text descendants". See #4. |
| 4 | chunk render | A formula inside an inline group is not a whole block, so `renderChunkView(..,'placeholder')` throws `invalid_input` and the whole ingest fails (confirmed, edge.ts). Latent: the 3 real slices have no inline groups with formulas. | package-is-wrong (bug) | Card: "a formula block that cannot be found in order is an invalid_input error" assumes whole blocks. |
| 5 | chunk | Formulas measured at placeholder length; skeleton uses real text length. | package-is-right | Card rule 5 note. Goldens cannot tell (undecoded). |
| 6 | chunk | `page_header`/`page_footer` skipped in groups, tables, pictures too; recipe validated (`invalid_input`); dangling/invalid refs fine. Missing `body` throws a bare `TypeError` (skeleton: `KgError invalid_input`). Empty heading starts a section with path `[""]` (skeleton drops it). | mostly package-is-right; TypeError is a package bug; empty heading ambiguous | Card rule 1 "Skip ... labels page_header and page_footer whatever their layer"; card silent on empty headings. |
| 7 | search `truncate.ts:22` | Trace `params` is `{}` when the recipe gives no k; skeleton records the effective `{k}`. Testkit fixtures (`fixtures/machine/search-run.jsonl`, log fixtures) all show `params:{"k":N}`. | skeleton-is-right | Rule 4 (record the recipe actually used); fixtures. |
| 8 | search service | Package rejects unknown keys in settings, wrong topology, unregistered `machine@version`; skeleton ran all of them. Missing item text becomes `internal` instead of `''`. | package-is-right | Card service step 2. |
| 9 | ingest `steps.ts:57` | Package refuses an imported artifact whose recipe is neither the configured nor its plain form (`precondition`); skeleton imports any recipe and `composeBuild` flags `mixedRecipes`. | ambiguous; undocumented in card, leans skeleton | Card behaviour 2 is silent; `mixedRecipes` becomes unreachable via ingest. Needs a decision. |
| 10 | ingest `deps.ts:17` | `chunkView` is optional with silent fallback to stored text. | package-wrong | Card signature makes it required; omitting it would silently embed `full` text under a `placeholder` space. |
| 11 | ingest `steps.ts:220` | Extras path renders other documents' chunks with the item's first-seen `blockRefs`, not the current version's. Item refs may come from another artifact. | package-wrong (latent) | Store contract: "per-version blockRefs are kept with the doc version". |
| 12 | ingest | Precondition failure (embedder mismatch) now emits `pipeline.started/finished(failed)`; skeleton emitted nothing. Topology is the real fingerprint. | package-is-right | Card: events bracket every run. |
| 13 | embed | Package checks vector count, finiteness, JSON body, `digest`, `dims`/`batchSize` args, sets content-type. Skeleton silently accepts short/long responses and null components, ignores `o.fetch`. Package drops the response body from the non-2xx message. | package-is-right (nit: keep body text) | Card "checked ... else upstream". |

## Duplicated logic that belongs in core
- `sameRecipe` (ingest `deps.ts:38`) repeats `canonicalJson(a)===canonicalJson(b)` also in `parse/src/subprocess.ts:89` and `artifactDir.ts:21`. Add `recipesEqual` to core.
- Stripping `formulaDecoding` (`plainParseRecipe`) is a recipe rule; core owns the recipe schema.
- Hashing bytes: `parse/src/artifactFile.ts:1` uses `createHash`; core has `sha256hex(Uint8Array)`.
- `onError: assign({error: toKgError(...)})` repeated about 20 times across ingest, search and eval machines; a `failTo` helper in `@kg/pipeline`.
- The text a chunk is embedded as (view then `renderDocument`) lives in ingest; search embeds queries through core `renderQuery`. The document side should be a core function so both paths (main and extras) cannot drift.
- The block separator `\n\n` and `[formula]` are defined in chunk only and re-derived by ingest's dependency on the renderer; fine, but mention in core.

## Recommendations
1. Fix #1 and #2 in chunk before the chunker freeze (changes ids; bump recipe `version`); clarify card rule 3. Needs the user because it changes frozen ids.
2. Fix #4 (render inline formulas) and the missing-body `TypeError`.
3. Fix #7 (record effective k) or document `{}`.
4. Make `chunkView` required (#10) and use the version's refs in extras (#11).
5. Decide #9.
