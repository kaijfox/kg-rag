# Follow-up to prov-review.md: adopt W3C PROV directly?

2026-10-18. Question: use PROV (or a library) as the native provenance representation, or keep the SQLite model and borrow checks, with PROV-JSON export later? Review only; no changes to design/, packages or code.

## 1. The library (checked on npm registry and GitHub, not memory)

- `tsprov` and `prov-ts` do not exist on npm (404). The only match is **`@inflexa-ai/tsprov`**, so use that name.
- It is a TypeScript port of the Python `prov` library. v0.6.0, published 2026-08-27; the first release (0.5.1) was 2026-07-14. Only 2 versions, about 3 months old.
- GitHub repo `inflexa-ai/tsprov`: 6 stars, 8 open issues, not archived, last push 2026-10-13. Owned by a company (3 npm maintainers). Release provenance attestations and OpenSSF scorecard are present. It is young and small-community.
- License Apache-2.0. One runtime dependency (luxon). Typed fluent API (`doc.entity(...)`, `wasGeneratedBy`, ...), ESM+CJS, `.d.ts` shipped. Serializes and deserializes PROV-JSON; PROV-N output only. Has `/graph` lineage helpers.
- Size: 2.0 MB unpacked, 224 files (640 KB cjs); browser bundle 116 KB minified.
- Its own README lists what is missing: **PROV-XML, PROV-RDF, a PROV-N parser, and PROV-CONSTRAINTS validation.**

## 2. Does PROV enforce anything?

Mostly no. PROV-DM is vocabulary plus a graph shape. PROV-CONSTRAINTS (a separate W3C spec) defines validity rules: uniqueness, typing, ordering (generation before use, no cycles), and invalidation rules. The only library found that implements it is not this one: tsprov, like Python `prov`, only builds and serializes documents. So adopting tsprov gives us a typed container, not a checker. Any constraint we want we would write ourselves, which we can already do against SQLite.

Against the review's findings:

| Finding | Does PROV close it? |
|---|---|
| A2 untracked producer change (mutable model tag, chunker fix without bump) | No. PROV records that an activity ran with a plan; it does not detect that the same ID got different output. Needs the Ollama digest in the spec and an `immutable_violation` check in `putDocVersion`. Both are store-level checks. |
| A1 addressing modes | No. PROV has no notion of content or input addressing. |
| A3 plan vs activity | Vocabulary only; already adopted as naming. |
| A4 mapping direction | Vocabulary only (`wasRevisionOf(new, old)`); a doc fix does it. |
| A5 build parent is history | No. PROV would model it as `wasRevisionOf` between builds, which is the same ambiguity and still first-writer-wins. |
| A6 log pointer moves | Partly: `wasInvalidatedBy` and generation times could express it, but only if we emit the events. The rule is ours either way. |

Score: closes none of A2-A6 by enforcement; it only offers names for A3, A4 and A6.

## 3. Migration cost against packages/core

Native PROV means the store becomes a PROV document (or a PROV graph in SQLite), with the current tables as views. Concretely:

- `ids.ts` (249 lines): PROV identifiers are QNames (`ex:abc`). Our `ch_<base32>` prefixes would be wrapped in a namespace or kept as local parts. The ID regexes, brands and golden vectors stay, so the IDs themselves do not change, but every ID becomes a QName at the boundary.
- `model.ts` (331 lines): types such as `Build`, `DocVersion`, `Mapping` would either duplicate or be replaced by generic `Entity`/`Activity` records with attribute bags. That loses the Zod-typed, branded contracts that Wave 2 packages build against. Attribute values are loosely typed (`Literal` wrappers for ints).
- `builds.ts` (35 lines): a build is a manifest plus a sorted item list. In PROV it is a `Collection` with `hadMember` for every item. Large builds mean one membership record per chunk, so a build of N chunks becomes N relation records, where today it is one hashed row set. `buildId` hashes the manifest, which PROV does not do; we would keep that function unchanged.
- `schema.sql` (160 lines, 25+ tables, insert-only triggers, FKs, indexes, `vec_distance_cosine`): the relational schema is the operational store. FK integrity, uniqueness and the insert-only triggers are the enforcement we actually have (this is where A2-type checks live). A PROV document in memory has none of that, and a PROV-in-SQLite triple store would mean rebuilding indexes for the hot paths (`build_items_by_item`, `item_sources_by_chunk`, knn).
- `events.ts` (246 lines): the log is typed events with a Zod catalog. Mapping to PROV is a one-way projection (event -> Activity, `parentId` -> `wasInformedBy`, session -> Bundle). Making PROV the native log would drop the typed catalog.

Estimate: a rewrite of the storage contract and every Wave 2 package that has started on it, for no new enforcement. Not recommended in any form.

## 4. Fit with content/input-addressed IDs and builds as manifests

- PROV identifiers are opaque. It has no hash semantics, so the identity rules (A1) stay in `ids.ts` regardless. The two designs are orthogonal, not competing.
- Builds as manifests that copy no data map to a `Collection`, but PROV's per-member relation is the wrong cost model for a build that is "a hash of a manifest plus an itemIds list". Export can emit a build as one Entity with the manifest as attributes and `hadMember` only on request (per item lineage).
- Early cutoff (C1) is a property of which inputs enter the ID. PROV's `wasDerivedFrom` can describe it afterwards but cannot give it to us.
- Per-item lineage (`item_sources`, `build_items`) projects cleanly onto `wasDerivedFrom`/`hadMember`, which is what makes export cheap.

## 5. Dependency weight

For export only: one dependency (luxon, plus tsprov itself, 2 MB on disk, 116 KB bundled), from a 3-month-old, 2-release package. This is not needed to emit PROV-JSON. PROV-JSON is a small JSON shape (`entity`, `activity`, `wasGeneratedBy`, `used`, `wasDerivedFrom`, `hadMember` maps); a 60-100 line exporter in the viewer or analysis tools, tested against a PROV-JSON example, avoids the dependency. If we want parsing or validation against the 398-file corpus, add the library then, as a dev or tool-only dependency, not in `@kg/core` (which depends only on zod).

## 6. Nix / DVC as a backend (one line)

No: Nix (derivations over files in a store) and DVC (stages over files in git) track file-level artifacts, and we need row-level items in SQLite with vectors and queries; borrow their ideas (already in the review), do not host the data in them.

## Recommendation: do not adopt natively; adopt as export only, later, hand-rolled first

- Keep the SQLite model and its triggers as the source of truth. Keep the A1-A6 proposals from the review; they are the real robustness gain.
- Treat PROV-JSON as the C7 export (one item's lineage, one build, one session as a Bundle), written by hand against the PROV-JSON spec when a consumer exists.
- Do not add `@inflexa-ai/tsprov` to `@kg/core` or any Wave 2 package.

What would change this:
- A real external consumer that requires PROV (a collaborator, a publication, an RO-Crate or lineage tool): do the export, and then using tsprov as a tool-only dependency is reasonable if it is still maintained (several releases, more than one external contributor).
- A PROV-CONSTRAINTS validator for TypeScript appearing (tsprov's governance doc lists it as missing): then run it over an export in CI as a cross-check, not as the store.
- Wanting free-form, heterogeneous provenance (many agent types, third-party records) rather than our fixed schema: then a graph-native representation starts to pay off.

## Sources (checked 2026-10-18)

- npm registry (`npm view`): `@inflexa-ai/tsprov` 0.6.0, Apache-2.0, dependency luxon, 2,042,241 bytes unpacked, 224 files; `tsprov`, `prov-ts`, `prov-json`, `provjs` return 404; `@rdfine/prov` (generated RDF types, last published 2025-04).
- GitHub API, `inflexa-ai/tsprov`: 6 stars, pushed 2026-10-13, not archived, 8 open issues.
- The package README (unpacked tarball): features, install, serialization; lists PROV-CONSTRAINTS validation among missing items.
- W3C PROV-DM and PROV-CONSTRAINTS (https://www.w3.org/TR/prov-constraints/); from the earlier review: https://www.w3.org/TR/prov-dm/.
- packages/core line counts from `wc -l`; table list from `schema.sql`.
