# Change proposal from store (WP5)

## 1. Summary items have no storage (schema gap)

`CorpusStore.putItems` accepts `Summary` items (core `model.ts`: `memberItemIds`, `runId`), and the card lists summaries as part of insert-only derived items. The shared `schema.sql` has `summary_members` for the members but no place for `runId`. The store therefore rejects summaries with `not_implemented`, and the conformance suite does not exercise them.

Suggested fix (one of):
- add `run_id TEXT REFERENCES derivation_runs(run_id)` to a `summary_runs (item_id PRIMARY KEY, run_id)` table, owned by S, with the usual insert-only triggers; or
- confirm that summaries wait until the relation layer sprint, and make the port say so.

Until then the store keeps working against the current contract for chunks and relations.

## 2. Relation node order (minor)

`relation_nodes` has no ordinal column. The store reads nodes in rowid (insertion) order, which matches the input order in practice. A `position INTEGER` column would make the order explicit. Not blocking.
