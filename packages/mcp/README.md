# @kg/mcp

The MCP adapter over `KgApi` (from `@kg/core`). `createMcpServer(api)` returns an MCP server; `serveStdio(api)`
connects it to stdin and stdout. Each connection is one agent session: the session opens when the client finishes
initializing, and every tool call on that connection uses it.

Tools are the core `TOOLS` entries, one to one, with the same names, descriptions and input rules. `eval_run` is
never exposed. A `KgError` comes back as an error result whose text is `<code>: <message>`. Any other error comes
back the same way with the code `internal`.

## Assumptions and known gaps

- Only stdio is supported. There is no HTTP transport.
- One database per process. A client cannot choose a database; that question is still open in the card.
- Tools are served through the low-level MCP request handlers, not `McpServer.registerTool`. The SDK's own
  argument validation would turn bad input into a protocol error before core could log it, so the SDK does not
  validate arguments here. Core's `runTool` validates them and logs the failure.
- The `tools/list` JSON schemas come from the SDK's internal `server/zod-json-schema-compat.js` module, which is
  imported by deep path. A future SDK version may move or rename it.
- No `outputSchema` is advertised, so clients do not validate `structuredContent`.
- The session is opened on the `initialized` notification, or on the first tool call if that comes first.
  If `openSession` fails, the next tool call sees the same failure.
- `zod` is not a dependency of this package. It is not imported directly.
- Nothing is logged here; logging happens inside `KgApi`.
