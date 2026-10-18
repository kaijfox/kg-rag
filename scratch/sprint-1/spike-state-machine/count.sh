#!/bin/sh
# code lines = non-blank, not a pure comment line
for f in "$@"; do
  n=$(grep -v '^\s*$' "$f" | grep -v '^\s*//' | grep -v '^\s*/\?\*' | wc -l | tr -d ' ')
  printf "%5s  %s\n" "$n" "$f"
done
