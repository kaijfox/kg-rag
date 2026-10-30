# Dependency inventory (snapshot 2026-10-28, not maintained)

Generated for the sprint 3 retro review. Snapshot only; do not treat as current.

## Workspace package third-party dependencies

| Package | Runtime deps | Dev deps |
|---|---|---|
| api | - | vitest@3.2.4 |
| app | @modelcontextprotocol/sdk@1.32.0 | - |
| chunk | - | vitest@3.2.4 |
| core | zod@4.1.12 | better-sqlite3@12.4.1, @types/better-sqlite3@7.6.13 |
| embed | - | vitest@3.2.4 |
| eval | - | vitest@3.2.4 |
| eventlog | better-sqlite3@12.4.1 | vitest@3.2.4, @types/better-sqlite3@7.6.13 |
| ingest | - | vitest@3.2.4 |
| mcp | @modelcontextprotocol/sdk@1.32.0 | vitest@3.2.4 |
| parse | - | vitest@3.2.4 |
| pipeline | xstate@5.33.2 | vitest@3.2.4 |
| search | - | vitest@3.2.4 |
| store | better-sqlite3@12.4.1, sqlite-vec@0.1.9 | vitest@3.2.4, @types/better-sqlite3@7.6.13 |
| testkit | vitest@3.2.4 | - |
| viewer | - | vitest@3.2.4 |

## Root

devDependencies: @types/node 22.20.5, dependency-cruiser 17.4.3, tsx 4.21.0, typescript 5.9.3, vitest 3.2.4

## Python sidecar (packages/parse-sidecar/pyproject.toml, kg-parse 0.1.0)

docling==2.140.0, pypdfium2==5.14.0, pillow==12.3.0, huggingface-hub==1.33.0, mlx-vlm==0.7.8 (darwin only). Dev: pytest, jsonschema.

## Vendored in the repo

packages/viewer/vendor/mermaid.min.js (5.5 MB, with its licence), used by the viewer's diagram rendering.

## Third-party imports observed in source and tests (count of import statements)

node:* built-ins dominate (fs, path, crypto, zlib, http, child_process, url, os, async_hooks). Non-built-in: @kg/* (internal), better-sqlite3 (8), xstate (6), zod (5), @modelcontextprotocol/sdk (about 11 across subpaths), sqlite-vec (1), vitest (52, tests).
