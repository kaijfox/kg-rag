# PROV / Nix / Bazel / DVC review of the provenance model (Sprint 1, item 6)

Reviewer pass, 2026-10-18. Inputs: `design/260916_initial-roadmap.md` (with Amendments), `packages/core/src` (`ids.ts`, `model.ts`, `builds.ts`, `schema.sql`, `events.ts`, `ports/store.ts`, `ports/ingest.ts`, `defaults.ts`), `scratch/sprint-0/architecture-proposal.md`. Sources were checked on the web (list at the end). This is review only: no design, package or code changes.

## 1. Mapping (ours -> theirs)

| Ours | W3C PROV-DM | Nix | Bazel / Shake | DVC |
|---|---|---|---|---|
| Recipe (`rc_`, hash of canonical spec) | `prov:Plan` ("a set of actions or steps intended by one or more agents") | the builder plus its args inside a `.drv` | action definition (command line, env, tools) | stage `cmd` + `params` |
| Recipe applied to specific inputs (**we have no name for this**) | Activity together with its Plan (qualified association) | **derivation** (`.drv`) | **action**, key = action hash | stage instance |
| Derived item, ID = f(recipe, input chunk IDs) (reserved) | Entity, `wasGeneratedBy` + `wasDerivedFrom` | **input-addressed** output | action-cache entry -> outputs in CAS | `outs` |
| Chunk ID = f(docKey, section path, text hash, occurrence), no recipe | Entity | **content-addressed** output | CAS object | `md5` of an out |
| Parse artifact `pa_` = f(source sha256, parse recipe) | Entity, `wasDerivedFrom` source | input-addressed output; source file = **fixed-output** input | action output | stage out |
| Imported artifact (`origin: 'imported'`) | Entity with a different generating Activity/Agent | **substitution** from a substituter | remote cache hit | `dvc pull` |
| DocVersion `dv_`, document key | `specializationOf(docVersion, document)`; successive versions `wasRevisionOf` | | | |
| Build `bd_` (manifest + item set, copies no data) | `prov:Collection` + `hadMember` | closure / profile contents | | `dvc.lock` (the lock file is the closest analogue) |
| `current` build pointer, `documents.current_version` | (outside PROV) | **profile generation** symlink | | git HEAD of the lock file |
| Build label (insert-only name) | | | | git tag |
| Mapping `same-as` / `duplicate-of` | `alternateOf` ("two alternate entities present aspects of the same thing") | | | |
| Mapping `supersedes` / `refines` | `wasRevisionOf` / `specializationOf` | | | |
| DerivationRun `dr_` (set-level) | Activity (`used` base build, `hadPlan` recipe) | impure derivation | non-hermetic action | `always_changed` stage |
| Event log, sessions | Activities + `wasInformedBy` (our `parentId`); a session's events form a **Bundle** ("a named set of provenance descriptions") | | build event log | |
| Rule 5 stale build | ~ `wasInvalidatedBy` of the superseded doc version | | dirty / out of date | `dvc status` "changed deps" |
| `llm.called` request/response sha256 | Activity with `used` / `wasGeneratedBy` digests | | action cache keyed by request hash | |

The fit is close: the model is a constructive-trace build system (Mokhov et al.) whose base layer (chunks) is content-addressed and whose next layer (derived items) is meant to be input-addressed over those chunks. Most of the findings below follow from that framing.

## 2. Adopt now (docs, cards, small contract proposals; nothing here blocks Wave 2)

**A1. Name the two addressing modes per ID, in `ids.ts` docs and the lifecycle document.** Content-addressed (the ID is a hash of the output): `ch_`, `bd_`, `mp_`, `qs_`. Input-addressed (the ID is a hash of the recipe and inputs; the output is trusted, not checked): `pa_`, `dv_`, `rc_`/`es_` (spec hashes), and the reserved `rl_`/`sm_`. The deferred derived-ID question ("does the text hash enter the ID?") is exactly Nix's input-addressed vs content-addressed derivation choice. Bazel's answer is both: action key -> output digest. Recommendation for the relation-layer sprint: ID = input-addressed (recipe, inputs, output index), and store the text hash next to it as an output digest, so rerunning a nondeterministic producer is detectable and not silently merged.

**A2. Mismatch: input-addressed rows are first-writer-wins, so an unrecorded producer change is silently dropped.** Input addressing is only safe if the recipe captures everything that affects the output (Bazel: tools outside the workspace are untracked, and "can produce different outputs under the same action hash"; Mokhov et al. §6.3 call this "untracked dependencies"). Two concrete holes in core 0.2.0:
- `DEFAULT_SPACE.model = 'embeddinggemma:latest'`. That tag is mutable; `putEmbeddings` keeps the first `(space, item)` row. After an `ollama pull`, new chunks get vectors from the new weights under the same `es_` ID as old chunks from the old weights, and nothing records it. Ollama's `/api/tags` returns a per-model `digest`. Proposal: put the digest in `EmbeddingSpaceSpec`, or at least have `embed` verify it against a recorded digest and fail on mismatch. The same applies to any LLM named in a recipe later.
- `ChunkRecipeSpec` names `algorithm: 'section-pack/1'` and parameters, not the chunker code. `putDocVersion` on an existing `dv_` returns `{inserted: [], reused: all}` without comparing chunk lists, so a chunker bug fix without a recipe bump is silently ignored on re-ingest, and ingest reports `unchanged`. Proposal: (a) chunk card rule "any change in output bumps `algorithm` or `version`" (golden vectors catch some cases); (b) `putDocVersion` throws `immutable_violation` when the stored chunk list differs, which is what `putItems` already does for items. That is a Nix-style hash-mismatch check and is cheap. Raise it as a store change proposal before `store` is built.

**A3. Separate Plan from Activity in the docs.** PROV distinguishes the plan (recipe) from the activity that ran it (time, agent, inputs actually used). The design uses "recipe" for both and has no word for "recipe applied to these inputs". Adopt **derivation** for that (as in Nix; Bazel says "action") and keep "recipe" for the plan. "Local/set-level derivation" in Core Concepts already uses the word in roughly this sense. For local derivations the activity is not needed for identity, but the item should be able to point to the event that generated it (`wasGeneratedBy`). Chunks get this implicitly from `ingest.chunked`; derived items should carry a generating run or event ID when the relation layer arrives.

**A4. Mapping direction reads backwards for `supersedes`.** `Mapping.toId` is documented as the "canonical / newer side", so `{kind: 'supersedes', fromId: old, toId: new}` reads "old supersedes new". PROV and plain English put the newer entity first (`wasRevisionOf(new, old)`). `refines` has the same ambiguity. Before any mapping is written: either rename the kinds to read from `fromId` (`superseded-by`, `refined-by`) or document "from KIND to" for each kind with an example. This costs nothing now and is painful once mappings exist.

**A5. Build parent is history, not identity: document it.** `buildId` correctly excludes `parentId` (a build is like a git tree or a Nix closure, not a git commit), but `putBuild` keeps the first writer's parent. When ingest returns to an earlier state the stored parent is wrong for that path. The true lineage is the `build.created` event (which carries `parentId`). Say so in the store card and the lifecycle document: `builds.parent_id` = first-seen parent; history comes from the log.

**A6. Log every pointer move.** The two mutable pointers are Nix's profile generations (or git's reflog). Today the current-build move is implied by `build.created`, and the doc-version move by `ingest.completed`. Neither covers a later "make build X current" (design: "the winning build becomes current") or a rollback. The lifecycle document (item 3) should state the rule "every pointer change emits an event with old and new value", even if v0 has only the ingest path. Adding an event type such as `build.current` waits for the tool that needs it.

**A7. Terms to use in docs:** *content-addressed / input-addressed*, *derivation* (recipe + inputs), *plan*, *early cutoff*, *substitution* (importing an artifact made elsewhere), *untracked dependency*, *lineage* (the source-chunk graph). Definitions are in section 1 and the sources. Avoid *bundle* for builds: in PROV a bundle is provenance about provenance, which is closer to a session's events.

## 3. Consider later

- **C1. Early cutoff is a property we already have; keep it.** Chunk IDs exclude the parse and chunk recipes, so a parser or chunker change that leaves a chunk's text and section path unchanged keeps its ID, its embedding and (later) its derived items. In the paper's terms that is early cutoff. Input-addressed derived IDs keyed on content-addressed chunk IDs are depth-1 constructive traces, which keep it one level up. If relations ever feed relations, keying on recipe + *source chunks* (deep traces) would lose it: Mokhov et al. §4.2.4 say deep constructive traces "cannot support early cutoff" and need deterministic tasks. Key on immediate inputs.
- **C2. Trust for imported artifacts.** Nix requires a signature from a trusted key for any non-content-addressed path copied in (`require-sigs`, `trusted-public-keys`); content-addressed paths are exempt. Our imported parse artifacts are input-addressed: the store cannot check that recipe X produced them. `producedOn` is the only trace. When the GPU server is real, record the producer identity (and optionally verify by re-parsing a sample, the way the Phase 0 round-trip spike did).
- **C3. Determinism check (`--check` style).** Periodically re-run a local derivation on a sample and compare it to the stored output: parse artifact hash, chunk list, embedding cosine ~1. This catches A2-type drift that recipes miss. Cheap to script once ingest exists.
- **C4. GC roots.** Everything is insert-only, so embeddings for every space and superseded versions accumulate. If size ever matters, use Nix's model: roots = current build, labeled builds, builds referenced by eval runs or events; everything unreachable is collectable. This would be a deliberate exception to "never delete" and needs a design decision; nothing to do now.
- **C5. Build = data snapshot + search recipe.** The manifest includes `searchRecipeId`, so comparing two search recipes on identical data yields two builds with the same `itemIds`. That is fine for Rule 6, but "diff two builds" tooling should diff manifest fields separately (data vs configuration). Bazel keeps configuration out of the target identity in a similar way. Splitting it out is only worth doing if the analysis tools find it awkward.
- **C6. `mixedRecipes` boolean -> recipe histogram.** DVC's lock file records per-stage hashes. A map recipe -> doc count in the manifest (or computed on demand) would make "mixed" interpretable in comparisons, as the design asks. It is derivable from `docVersions` today, so this is a viewer or analysis feature, not a contract change.
- **C7. PROV export for one item's lineage** (PROV-JSON) from the viewer or analysis tools, if an external tool ever wants it. The internal model needs no change for it.

## 4. Ignore

- RDF / PROV-O storage, OpenLineage, RO-Crate: no consumer exists, and the SQLite schema already holds the same relations.
- PROV agents and roles in full (delegation, `actedOnBehalfOf`). Record the model and digest in the recipe; agent modelling adds nothing for one user.
- Nix's floating CA derivations machinery (experimental, with output rewriting). The useful idea (an output digest next to an input key) is in A1.
- DVC `frozen` stages and experiments: builds plus labels already cover pinning and comparison.
- A volatile ("always_changed") class for search or eval. LLM-judged eval is non-deterministic, but `llm.called` digests and eval runs pinned to builds already record what ran.

## Sources (checked 2026-10-18)

- W3C PROV-DM, https://www.w3.org/TR/prov-dm/ : definitions of Plan, Revision, Invalidation, Specialization, Alternate, Collection/Membership, Bundle, Communication.
- Nix manual, content-addressed outputs: https://nix.dev/manual/nix/latest/store/derivation/outputs/content-address (input vs content addressing, fixed-output, floating CA); configuration file: https://nix.dev/manual/nix/latest/command-ref/conf-file (`substituters`, `trusted-public-keys`, `require-sigs` exempting content-addressed paths, GC roots and `keep-outputs`).
- Bazel remote caching, https://bazel.build/remote/caching : action cache = action hash -> result metadata; CAS of outputs; untracked tools give different outputs under one action hash.
- DVC dvc.yaml / dvc.lock, https://doc.dvc.org/user-guide/project-structure/dvcyaml-files : lock records stage definitions, dep/out hashes and params values; `frozen`, `always_changed`.
- Mokhov, Mitchell, Peyton Jones, "Build Systems à la Carte", ICFP 2018: https://www.microsoft.com/en-us/research/uploads/prod/2018/03/build-systems-a-la-carte.pdf (§2.3 early cutoff, §4.2.3-4 constructive and deep constructive traces, §6.3 impure tasks).
- Ollama API, https://github.com/ollama/ollama/blob/main/docs/api.md : `/api/tags` returns `digest` per model.
