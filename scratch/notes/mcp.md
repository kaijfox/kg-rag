# @kg/mcp notes

## What was done
- Wrote `packages/mcp/src/index.ts` with `createMcpServer(api, o)` and `serveStdio(api, o)`.
- Wrote `packages/mcp/test/roundtrip.test.ts` with the exact text from CARD.md.
- Wrote `packages/mcp/README.md`.
- `pnpm --filter @kg/mcp test`: 4 of 4 pass against the real SDK 1.32.0 in-memory transport.
- `pnpm --filter @kg/mcp typecheck`: exit 0.

## Decisions
- Tools use the low-level `Server` request handlers (`tools/list`, `tools/call`) on the `McpServer`'s `server`,
  not `registerTool`. Reason: `registerTool` makes the SDK validate arguments with the zod schema and throw a
  protocol error on failure. The card's error case expects an `isError` result with the `invalid_input:` code, which
  only comes from core's `runTool` validation (which also logs the failed call). `tools/list` serves core's
  `toolInputJsonSchema(k)`, so the schemas come from core and not from SDK internals.
- Session opened on the `initialized` notification, with a memoized promise so a tool call that arrives first
  shares it. A rejected open is dropped from the memo, so the next call retries (test: `session.test.ts`).

## Surprises
- `registerTool` in SDK 1.32.0 validates arguments before the handler runs, so the card's error-case test would
  fail with that path. That is the reason for the low-level handlers.
- `zod` is not resolvable from this package (pnpm strict layout); core's `toolInputJsonSchema` supplies the JSON schemas.

## Would flag
- Non-KgError exceptions are mapped to `internal: <message>` rather than thrown as protocol errors. The card does
  not say what to do with them; this choice keeps the stdio session alive.
- No `outputSchema` is advertised.
