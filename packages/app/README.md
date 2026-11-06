# @kg/app

The composition root: the `kg` command line, the MCP server, the session viewer, and the tools for seeing how the system is
used. It is the only package that imports its siblings.

## Open first

| For | File |
|---|---|
| every command and option (the header lists them) | `src/cli.ts` |
| the tools an agent sees, their checks, the instructions the server gives | `src/mcp.ts` |
| the local page that shows sessions and what each step did | `src/viewer.ts`, `web/index.html` |
| opening a database with the Ollama clients | `src/open.ts` |
| `kg export`: the folder to send for review | `src/export.ts` |
| `kg report`: searches, ratings, and the comparison with the baseline | `src/report.ts` |
| `kg doctor`: checks an installation | `src/doctor.ts` |
| re-reading sources while a server runs | `src/watch.ts` |
| `kg diff`: two indexes chunk by chunk | `src/diff.ts` |

Run `./kg` from the repository root. `serve mcp` must be started through the root `./kg` launcher, because `pnpm` prints its
own header on stdout and the protocol uses stdout.

## Worth knowing

- Every agent search runs the shadow machine beside the chosen one and logs its results. Searches made by the command
  line and by evaluation runs do not.
- A running `serve mcp` or `serve viewer` keeps the index file it opened. After `kg rebuild`, restart it.
- `kg init` turns extraction on and chooses `facts-and-neighbours`. `--baseline` turns extraction off and keeps plain search.

## Tests

`test/app.test.ts` covers the command line, the MCP tools and the viewer. `test/beta.test.ts` covers export, report, questions
from real use, cache transfer, `doctor` and `watch`. `test/docs.test.ts` checks that the documents name commands, machines and
files that exist.
