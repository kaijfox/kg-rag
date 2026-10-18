# Review: chunk, embed, parse, parse-sidecar, search, pipeline

Mechanical: test and typecheck pass for chunk (29), search (81), pipeline (8), embed (20), parse (25, 1 live skipped); `pnpm depcruise` clean; sidecar `uv run pytest` 23 passed, 1 skipped (HF offline). No sprint/phase markers found in code or READMEs of these packages. Mutation testing ran in a scratch copy (chunk 28 applied, search 33, pipeline 24).

## Findings

**Should-fix**
1. chunk `blocks.ts`/`chunker.ts:107-119` + `render.ts`: an inline group containing a formula child is emitted as one prose block (formula text joined with spaces, measured at full length, refs include the formula's `self_ref`). `renderChunkView(..., 'placeholder')` then resolves that ref, finds a `formula` label, cannot find a whole block and throws `invalid_input`; probed with a 3-child inline group. Ingest would abort on any document with such a group (docling emits them for inline math). It also moves boundaries between decoded and undecoded parses (the card's own invariant). Real fixtures have 0 inline groups, so nothing tests it. Fix before freeze: treat formula children of an inline group as formula blocks (split the group around them), or skip non-block formula refs in the renderer. This is freeze-relevant (changes chunk ids), unlike the offset question.
2. embed `index.ts:55`: the request omits `truncate:false`; Ollama truncates silently at the model context (2048 tokens). The card says chunks are at most 1500 chars, but decoded-formula chunks reach 4851 (chunk proposal 3). A truncated chunk embeds only its head with no signal. Send `truncate:false` (Ollama then errors, mapped to `upstream`), or measure at embed time.
3. search tests miss: embedder model/dims mismatch precondition (service.ts, survived when dropped, including the whole `embedder.model` check), `recipe.kind !== 'search'`, knn `limit: pool` (pool+1 survived, so a "100-candidate pool" is not asserted), `truncate` off-by-one and `p.k` (masked by the service's final `slice`), `queryId` on candidates (set to null survived), merge with an existing pool (`fuseMax` without the old pool survived). Add cases to `search/test/machine.test.ts` or the testkit step suite.
4. chunk tests miss every boundary comparison in packing: `<=`/`<` on T, M, m, the final merge `>=2` and `<m`, surviving; also inline join separator, visited-set dedup, `\p{Lu}` vs `[A-Z]`, surrogate-pair cuts, page sort, ref de-duplication, `normLength` vs raw empty check. Add exact-boundary cases (block lengths T-2, T-1, T; m-1, m) and a non-ASCII uppercase sentence cut; these are what freeze the chunker.

**Nits**
5. pipeline `topologyOf` changes with: invoke src, targets, guard names, meta label/step/logs, `on`, `after`, machine id, named entry actions. It does not change with: `input` function bodies (so step params and the `at` name), guard bodies, actor implementations, initial context. For search, `stepActor(vectorKnn)` swapped for another step constructor under the same actor name is invisible. Cosmetic `meta.label` changes DO change the topology, hence the recipe id and every build id. Document both directions in the README; consider excluding `label` from the hash. A mutation dropping the `done` edges survives in the pipeline package's own tests (caught only by search conformance); add an assertion.
6. parse `SubprocessParser.parse` has no timeout (docling can hang) and a `maxBuffer` overflow reports "signal unknown". A missing source file gives `upstream` instead of `not_found`. `ArtifactDirParser` reads and validates every artifact in the directory per call, and one corrupt file blocks every lookup; filter by the `<sha[:16]>` file prefix first.
7. parse with a recipe carrying `formulaDecoding` returns an undecoded artifact labelled with the decoded recipe (sidecar echoes it, TS accepts). Decision log 2026-10-18 says ingest parses under the plain recipe, so it is not hit today; cheap guard: `SubprocessParser` rejects such a recipe (contradicts the card's "must not fail", so lead's call).
8. search service: `req.k` is not checked at the service (a negative k would slice from the end); the tool boundary rejects it, so only direct callers are exposed.
9. sidecar `stats.chars` (markdown length) and `charsPerPage` (texts only) do not sum to each other; define them.

Verified OK: chunk ids are `assignChunkIds(docKey, drafts)` (path + normText + occurrence, no ordinal), stable under whitespace variants; golden vectors pass. Recipe hash in the sidecar (sorted-key compact JSON, sha256) equals core `sha256hex(canonicalJson)` on a non-ASCII test recipe (file names only; the `rc_` id adds a tag and is TS-only). Search: `query`, `pipeline.started`, N x `search.step` (considered/output ranks, state, stepIndex, pools), `pipeline.finished`, `search.result` all carry the `buildId` tag (Rule 6); `stale` comes from `staleCheck(buildId)` (Rule 5; a boolean only, no reasons); pool semantics match core; unknown machine, wrong topology and bad settings give `invalid_input`. Parse maps ENOENT/exit 3 to `precondition`, exit 2/other, bad stdout, bad artifact, wrong sha, recipe not echoed to `upstream`. ArtifactDirParser keys on (sourceSha256, canonical recipe). No decision-log entries by these packages are unsupported.

## Chunk freeze recommendations
- Formula view offsets: do not add block offsets now. Offsets do not enter chunk ids or boundaries, so they can land after the freeze without invalidating the eval set; the residual failure (a paragraph identical to a formula text placed directly before it) is rare and the whole-block matcher fixes the realistic case. Defer. The inline-group issue (finding 1) is the real pre-freeze item.
- Length rule: the card's "every length is normText" and "+2 per join" disagree by one per join. Adopt the +2 reading (golden ids, oracle and tests agree); reword the card (block lengths are normText lengths, each join counts 2). Changing to +1 would change every id.
- Freeze order: fix finding 1, add boundary tests (finding 4), then freeze; question generation after.

## Mutation survivors (summary)
chunk: T/M/m boundaries x5, final-merge guard, page sort, ref dedup, visited dedup, inline join, furniture content_layer (header label check masks it), `\p{Lu}`, surrogate guards, `>=` split guard, `formula` normText check, ref regex. search: items 3 above. pipeline: onDone edge, loop `<=`, routing inference, `#id` resolution, `recipeId` in started, error-path resolve, `inspect`, `declaredLogsOf` registration.

## Change proposals
| Pkg # | Proposal | Recommendation | Who |
|---|---|---|---|
| chunk 1 | formula view offsets | defer (ids unaffected); fix inline-group case now | lead |
| chunk 2 | length rule wording | adopt +2 in card | lead |
| chunk 3 | maxChars check on decoded parses | adopt in testkit: check placeholder-measured length | lead |
| search 1 | V1 recipe version '1' | already applied in testkit; close | lead |
| search 2 | zod in settings schema | accept hand-written parser, or add zod to package.json; cosmetic | lead |
| search 3, 4 | stale comments/README on topology | apply (appear done) | lead |
| sidecar 1 | recipe hash serialization | adopt, add a cross-language vector test | lead |
| sidecar 2 | decode `producedAt` | adopt: set decode time and host (provenance; parse output is not byte-deterministic anyway) | lead |
| sidecar 3 | `undecodedFormulas` | adopt: count formula items with empty text in both commands | lead |
| sidecar 4 | decoded text form | decide before first decoded artifact: strip `$$` delimiters in the sidecar (keep `\tag`) and record it in the decode recipe; it changes chunk ids | lead; user if decoding enters the default recipe |
| sidecar 5 | parse exit 3 on bad recipe | adopt in card | lead |
| sidecar 6 | `charsPerPage` filled | adopt, define vs `chars` | lead |

No proposal needs the user unless formula decoding joins the default v0 recipe.

## Summary
All six packages pass tests, typecheck and depcruise, and the sidecar passes its pytest suite. The chunker matches the card and its golden ids. The main defect is an inline group containing a formula: the view renderer throws, which would abort ingest, and boundaries then differ between decoded and undecoded parses; fix it before the chunker freezes. Mutation testing shows the chunker's packing boundaries are unpinned. Search is sound on traces, pools, build tagging and staleness, with a few untested checks. embed should send `truncate:false`. `topologyOf` ignores step parameters, guard bodies and actor implementations, but cosmetic labels change it. Recommendations: defer block offsets, adopt the +2 length rule and sidecar proposals 1, 2, 3, 5, 6; decide the decoded text form before any decoded artifact exists.
