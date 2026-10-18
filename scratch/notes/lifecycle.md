# Notes: lifecycle document (Sprint 1, Wave 0 item 3)

Output: `scratch/sprint-1/lifecycle.md`. Read: core src/ports/test, testkit conformance and meta tests, architecture-proposal, contract-revisions (R-23..R-25, P-1/P-2), pipeline-recipes (5d), prov-review (A5/A6), package cards (ingest, search), skeleton ingest.ts and search.ts.

Findings while verifying:
- `done` skip (P-2a) is not in contract 0.2.0 and has no test; deferred. The doc marks it "not a v0 acceptance criterion".
- `pools` do not exist in core yet; section 2.4 is marked pending 0.3.0 and left to be filled from the final contract text.
- `ingest.completed` carries only the new docVersionId; no event carries the old document-pointer value.
- `build.created` is emitted whenever the current build moves, including to a pre-existing build (revert); `parentId` then differs from the stored `builds.parent_id`.
- No test: first-seen build parent with a differing parent (S-11), `putDocVersion` on existing `dv_` with different chunks (S-7), triggers beyond events/items/documents (S-1), pool size 100 (Q-9), duplicate docKey in a request and embedder/space precondition (I-11), pointer order (I-12), `build.created.parentId` payload (I-13), failure inside the commit transaction (I-7 partial), full pointer-event rule (E-4).
- Did not run the test suites; test names were taken from source, not from a run.
