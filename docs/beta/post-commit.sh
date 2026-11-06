#!/bin/sh
# Git hook: after each commit, rebuild the code documentation and read it into the knowledge base.
# Install: cp post-commit.sh .git/hooks/post-commit && chmod +x .git/hooks/post-commit, then set the three paths below.
# The documentation command shown is TypeDoc; replace it with your language's generator (see code-map-prompt.md).

KG=/path/to/kg-rag/kg                  # the launcher in the kg-rag checkout
DB=$HOME/kg/myproject                  # the database folder
SITE=$HOME/kg/myproject-docs/site      # where the generated pages go (outside this repository)

ROOT=$(git rev-parse --show-toplevel)
mkdir -p "$SITE"
cd "$ROOT" || exit 0
# a failure here must never block or undo a commit
npx typedoc --out "$SITE" --entryPoints src --entryPointStrategy expand --excludePrivate false --skipErrorChecking >/dev/null 2>&1 || exit 0
"$KG" ingest --db "$DB" >/dev/null 2>&1 || exit 0
