# Keeping a project log

A project log is a dated record of decisions, changes of direction and results. kg-rag reads it as one passage per entry,
and when an entry says it replaces an earlier one, searches stop returning the earlier entry. That is what lets an agent ask
"what is the store?" and get the current answer instead of two contradicting ones.

kg-rag only reads the log. Your agent or you write it, in the format below.

## Set it up

```sh
./kg init --machine current-state --db ~/kg/myproject
./kg add PROJECT_LOG.md --adapter decision-log --db ~/kg/myproject
./kg ingest --db ~/kg/myproject
```

Start `serve mcp` with `--watch` so new entries are searchable without a manual ingest.

## What the reader looks for

- Each entry is a level-two heading that starts with an ISO date: `## 2026-10-17: Store is SQLite`.
- Replacement is found by a sentence in the entry that contains one of *supersede, replace, override, reverse, retire* and
  an ISO date naming the earlier entry: "This supersedes the decision of 2026-10-01 that the store is JSON files." The
  passive form works too: "Replaced by the decision of 2026-10-17."
- When several entries share the date named, the sentence must also use at least two words (four letters or more) from the
  title of the one it means. Otherwise the link is skipped, and the step log (`./kg serve viewer`) records why.
- A replacement that the text never states is not detected. If you notice one, run
  `./kg correct replaces <newer-chunk-id> <older-chunk-id>`; the correction survives rebuilds.

## Prompt for your agent

Add this to the instructions your agent reads, naming the log file:

```markdown
## Project log

Keep `PROJECT_LOG.md` as a dated log, newest entries last. Add an entry when a decision is made, a direction changes, an
approach is tried and fails, or a milestone is reached. Do not edit or delete earlier entries.

Format of an entry:

    ## YYYY-MM-DD: Short specific title
    Two to six sentences: what was decided or found, and why.

Rules:
- One decision or result per entry. The title must tell it apart from other entries of the same day.
- Write for a reader who has seen nothing else. Name things in full ("the project store", "the embedding model"). Do not
  write "it", "this", "the above" or "as discussed".
- When an entry replaces an earlier one, say so in a sentence that names the earlier entry's date and uses words from its
  title: "This replaces the decision of 2026-10-01 to keep the store as JSON files."
- State numbers and versions that matter, with what they were measured on.
- If something was tried and failed, record it, with the reason, so that nobody tries it again.
```

The rules about naming things in full matter beyond style: fact extraction refuses sentences that begin with a pronoun or
refer to "the chapter" or "the above", and a log written that way yields more usable facts.
