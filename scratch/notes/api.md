# @kg/api notes

## Done
- packages/api/src/index.ts: createApiHandlers and createApi, one handler per KgApi method, logging left to core.
- packages/api/test/conformance.test.ts: exact text from the card.
- packages/api/README.md: assumptions and gaps.
- pnpm --filter @kg/api test: 15 of 15 passed. pnpm --filter @kg/api typecheck: no errors.

## Assumed
- Input-validation order: core validates input first, then the handler checks the search (not_found), then the
  returned-items rule (invalid_input). Matches the conformance cases.
- Outcome with a search records that search's build; without one, the current build.

## Surprised by / would flag
- The card's search-step details: the card does not mention search steps; search is a straight delegation, so
  the 0.5.0 recipe shape change has no effect here.
- The card's open question on usage naming fetched-but-not-returned items is still open; the strict rule is in place.
- The conformance suite's search case expects every search event to carry the search's searchId and buildId; that
  is handled by the search service, not this package.
