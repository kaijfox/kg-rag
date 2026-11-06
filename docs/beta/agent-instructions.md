# Instructions to give your agent

The server already tells a connected agent how to report. Many agents follow those instructions only loosely, so add the
block below to the project instructions your agent reads (`CLAUDE.md`, `AGENTS.md` or the equivalent). The reports are how
we learn which searches helped, so they matter more than any other part of the beta.

```markdown
## Knowledge base (kg)

A knowledge base of this project's documents is available through the `kg` tools.

- Before answering a question about the documents, the library, or the code, call `search`. Read the passages it returns
  before relying on them. A result whose `meta` has a `source` and `line` names the file and line to open.
- After you use results, call `report_usage` with the IDs of the results you actually used.
- If results were poor, or exactly right, call `feedback` with a relevance from 0 to 1 and one sentence on what was
  missing or what made them good.
- When you learn whether the solution that used a search worked, call `report_outcome`.
- Never put secrets or personal data in a note.
```

Keep the notes short. A sentence such as "the answer was in the troubleshooting section, which ranked fifth" is the most
useful kind.
