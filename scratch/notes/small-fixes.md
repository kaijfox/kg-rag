# Small fixes

## pipeline.finished state on work-state failure
Added a test in packages/pipeline/test/pipeline.test.ts (work actor throws KgError precondition; asserts status failed, state 'work', error code). Two older tests already asserted state 'work'. With the mutation (always `state`) the new test fails; src restored.

## search: `pool < k` check
packages/search/CARD.md has no such requirement. Settings validation (card step 2 and similarity.ts parseSettings) covers unknown keys, pool as positive integer and kinds only; k belongs to the request, not the recipe. Nothing in the card says a pool smaller than k is an error (truncate keeps the top k of whatever exists). The review notes do not mention `pool < k` either (item 3 only lists the knn `limit: pool` gap). No behaviour added; needs a design decision first.
