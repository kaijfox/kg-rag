# @kg/core (contract 0.1.0, frozen at fan-out)

The shared contract every package imports, and the only package with no `@kg/*` dependency (runtime dep: zod).
Read in this order: `src/model.ts` (data model), `src/ids.ts` (every ID derivation), `src/ports/*` (the
interfaces between packages; each method documents its error codes), `src/events.ts` (event catalog and
envelope rules), `src/api.ts` + `src/runTool.ts` (the tool contract and the single logging path),
`src/scoring.ts` and `src/conditioning.ts` (rules every step and store must share), `src/schema.sql`.
Changes go through a change proposal and bump `CONTRACT_VERSION`. Tests: `pnpm --filter @kg/core test`
(schema.sql on real SQLite, scoring, conditioning, runTool failure paths, JSON Schema freshness); the ID
functions are checked against `packages/testkit/golden`.
