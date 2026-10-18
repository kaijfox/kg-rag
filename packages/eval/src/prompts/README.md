# Prompt files

Written by the lead, not by the package implementer. Each file has a system part, a line `=== user ===`, and a user part.
`{{name}}` marks a value the loader fills in; no other templating. The sha256 over the files in this directory (sorted by name,
file name and content) is the `promptDigest` of the machines that use them, so any edit changes the recipe id.

Placeholders: `{{passages}}` is the numbered passages, one per block, as `[0] text`, `[1] text`, ...; `{{count}}` the number of questions
asked for; `{{section}}` a section's heading path; `{{question}}`, `{{reference}}`, `{{answer}}`, `{{context}}` as named.

Model output is always one JSON object (see each file). Passages are referred to by their number; the parser maps numbers back to chunk ids.
