# Change proposals from @kg/search (WP8)

## 1. Testkit v1 search recipe names an unregistered machine version

`packages/testkit/src/minicorpus.ts` defines `V1_SEARCH_RECIPE` with `version: 'mini-v1'`. The search package looks up
`machine@version` in its registry, so a v1 build's recipe is refused with `invalid_input` (`unknown search machine
similarity@mini-v1`). This fails 8 of the fixture and conformance cases that search v1 builds (searchFixture s1-s6 and
s9, and the "explicitly requested build is honoured" service case).

Proposed fix (testkit, not made by this package): set `version: '1'` in `V1_SEARCH_RECIPE`. It keeps the different
settings (`pool: 50`), so its recipe id still differs from the v2 recipe and the M31 check still holds.

## 2. "strict zod" settings schema needs zod, which this package cannot declare

The card asks for `similaritySettingsSchema` as a strict zod schema. `packages/search/package.json` declares only
`@kg/core`, `@kg/pipeline`, `@kg/testkit` and `vitest`, zod is not resolvable from the package, and the card forbids
adding dependencies. The package therefore ships a hand-written strict parser with the same name and a `parse` and
`safeParse` method. Proposed: either a zod settings schema exported from core (it already depends on zod), or zod
declared in this package's `package.json` at the core version.

## 3. Core comment on DEFAULT_SEARCH_RECIPE is out of date

`packages/core/src/defaults.ts` still describes the topology as provisional and as a placeholder. The literal now equals
the real fingerprint (`ab74647e68ade0b3`). The comment should say so. The change was not made (only the literal was
edited, as the card allows).

## 4. Golden README mentions the topology as provisional

`packages/testkit/golden/README.md` says the search recipe's topology is a provisional literal. It is now the real
fingerprint, and the recipe id is `rc_o3vj74kof7ugqctjnqhn` (previously `rc_qabaozbopsfdecarndip`). The README was not
edited.
