# Spike 5d: can the v0 search contract express decomposition and critique? (Phase 1, written, not implemented)

Contract under test (core `ports/search.ts`, 0.1.0): a search recipe is a linear list `steps: {type, params}[]`;
each step maps `SearchState {query, k, buildId, queries[], candidates[], seeds[], done, notes}` to a new state
plus a `StepTrace {considered, output, queries?, seeds?, details?}`; the runner runs every step in order,
logs one `search.step` per step, ignores `done`, returns the first k of the final candidates.
Candidates are unique per item (searchStepConformance), sorted by score then itemId, each with one `queryId`.

## A. Query decomposition with per-subquery fusion

Intent: an LLM splits a multi-hop question into sub-questions; each sub-question retrieves its own ranked
list; the lists are fused by rank (RRF), so that every sub-question is represented in the top k even when one
sub-question's chunks all score lower in absolute cosine than the other's.

Recipe as written against 0.1.0:
```json
{ "kind": "search", "version": "decompose/1", "spec": { "steps": [
  { "type": "decompose", "params": { "model": "qwen3.5:latest", "maxSubqueries": 4, "keepOriginal": true } },
  { "type": "vector-knn", "params": { "pool": 50, "kinds": ["chunk"] } },
  { "type": "rrf", "params": { "k0": 60, "groupBy": "queryId" } },
  { "type": "truncate", "params": {} }
]}}
```
- `decompose` appends `QueryVariant {id: 'q1'.., origin: 'decompose', parentId: 'q0'}` to `queries` and puts the
  prompt and raw output in `details`. Expressible as is (`parentId` was added in Phase 1 for exactly this).
- `vector-knn` already loops over all variants. **But it fuses by max** (contract: "fuse by max score"), and
  candidates must be unique per item: an item at rank 3 for q1 and rank 1 for q2 survives once, with q2's score
  and `queryId: 'q2'`. Per-subquery ranks are gone before `rrf` runs.
- `rrf` therefore cannot compute 1/(k0 + rank_q(item)) for each q: the state holds one list. It could re-embed
  and re-query per variant itself, but then it is a retrieval step, not a fusion step, and the vector-knn trace
  no longer explains what was fused.
- Workarounds inside 0.1.0: (a) a single `decompose-retrieve-fuse` composite step that does all three and puts
  the per-query lists in `details` (the log keeps them, but as opaque JSON, and steps cannot be recombined);
  (b) stash per-query lists in `state.notes` (a side channel the trace does not show as candidates).

Verdict: **does not say what is intended.** The linear list is not the problem; a single candidate list is.
Smallest fix (proposal P-1, not applied): add `pools: Record<string, Candidate[]>` to `SearchState` ({} in v0) and
an optional `pools` summary to `StepTrace`; `vector-knn` gains `params.into` (write per-query lists to pools
`q0`, `q1`, ... or fuse into `candidates` as today, the default); `rrf`/`fuse` reads named pools and writes
`candidates`. The extensible draft had named pools; the proposal dropped them as unneeded in v0. Cost now: one
reserved field and a trace slot; cost after fan-out: a core change touching search, viewer and the steps' tests.

## B. Critique loop

Intent: retrieve; an LLM reads the candidates (and optionally drafts an answer) and either declares the
evidence sufficient or proposes follow-up queries; new queries retrieve more; repeat up to N rounds; return k.

Recipe as written against 0.1.0 (loop unrolled, N = 2):
```json
{ "kind": "search", "version": "critique/1", "spec": { "steps": [
  { "type": "vector-knn", "params": { "pool": 50, "kinds": ["chunk"] } },
  { "type": "critique",   "params": { "model": "qwen3.5:latest", "maxNewQueries": 2, "draftAnswer": true } },
  { "type": "vector-knn", "params": { "pool": 50, "kinds": ["chunk"], "onlyNew": true, "merge": true } },
  { "type": "critique",   "params": { "model": "qwen3.5:latest", "maxNewQueries": 2, "draftAnswer": true } },
  { "type": "vector-knn", "params": { "pool": 50, "kinds": ["chunk"], "onlyNew": true, "merge": true } },
  { "type": "truncate",   "params": {} }
]}}
```
- `critique` writes new variants (`origin: 'critique'`, `parentId`), its draft answer and reasons into `notes`
  and `details`, and sets `done: true` when satisfied. All of that fits the state as reserved in 0.1.0.
- Unrolling expresses a bounded loop. What is missing is meaning, not structure:
  1. **`done` has no semantics**: the v0 runner ignores it, so the later steps run anyway. Each step would have to
     treat `done` as "no-op", which every step implementer must remember.
  2. **Retrieval steps replace candidates**: nothing says whether a second `vector-knn` merges with what is there.
     The skeleton's `vector-knn` replaces. `merge` must become a contract-level rule or a common param.
  3. **"Which variants are already searched"** is not in the state: `onlyNew` needs it. It can be derived from
     earlier traces only by the runner, not by a step. A `searched: true` marker on `QueryVariant` (or a note
     convention) is needed.
- With those three conventions the unrolled recipe says what is intended, and the log stays flat and
  diagnosable (one `search.step` per round, each with its considered/output lists and the critique's text).
  A real loop (`repeatFrom`) is a runner change the proposal already anticipated; unrolling avoids it.

Verdict: **expressible by unrolling, but only with three conventions the contract does not state.** Proposal
P-2 (not applied): (a) the runner skips remaining steps once `done` is true, except steps whose spec says
`"final": true` (truncate); (b) retrieval steps merge into existing candidates with `fuseMax` (re-running one is
then idempotent); (c) `QueryVariant.searched?: boolean`, set by retrieval steps.

## What this says about the contract
Graph walk and reranking were already judged additive. The two query-refinement shapes both strain the single
candidate list and the unspecified runner semantics, not the linear list or the logging. Both fixes are small
and additive now; recommendation in contract-revisions.md (P-1, P-2): adopt before fan-out because `search`,
`viewer` and the step conformance suite would otherwise be built against semantics that later change.
