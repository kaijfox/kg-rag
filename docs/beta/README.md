# Beta guide

kg-rag lets your coding or research agent search the documents, notes and code documentation you give it, and records what
it found so that the search can be improved. You point it at files, it cuts them into passages, and your agent asks for the
passages it needs through a tool. This guide says what to expect and what to send back.

## What it does well, and where it does not

On a test set of two physics textbooks, plain similarity search put the passage that answers a specific question in the
top five results for 95% of questions. So for questions that one passage answers ("what does this paper assume about the
bath?", "how does this library's `connect` function handle timeouts?"), expect it to find the passage.

Questions that need a whole section ("what are the main arguments in this chapter?") are the weak spot: in the same test
only 36% had every supporting passage in the top five. A section summary is the planned fix, and your searches tell us how
often it matters.

Three more things to know:

- **Extraction is on, and it is slow.** On the author's laptop a local model took about half a minute per passage, so a
  long document can take hours. Run it on your fastest machine and move the result, as described in `moving-extraction.md`.
- **Extracted facts are unproven.** About one extracted sentence in four is refused by the checks, some of the rest repeat
  each other, and a small test did not show that searching with facts beats plain search. For that reason every search also
  runs the plain search in the background and logs what it would have returned. You see only the results of the machine your
  database uses.
- **PDFs are parsed with docling, and formulas are not decoded.** Equations appear as placeholders. Scanned PDFs without
  text are not read.

## What to do

1. Follow `setup.md` to install, create a database and register it with your agent.
2. Add the agent instructions from `agent-instructions.md` to your agent's project instructions, so that it reports which
   results it used and whether they helped. Those reports are the most useful thing you can give us.
3. Choose a starting point:
   - **Papers or library documentation:** `setup.md` covers adding PDFs and markdown.
   - **Tracking progress on a project:** `project-log-prompt.md`.
   - **A map of a codebase:** `code-map-prompt.md`.
4. Use it on real work. Every so often, send us an export as described in `sending-feedback.md`.

## What we do not do

kg-rag reads what you point it at. It does not download documents, convert formats, remove duplicates or organise your
files. If a format you need is missing (web pages, for instance), convert it to markdown with any tool and add the folder.
Tell us what you needed, and we will consider a helper for it.
