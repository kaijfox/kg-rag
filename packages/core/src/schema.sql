-- kg-rag SQLite schema, version 1. One file per database. Applied idempotently by `store` and `eventlog`
-- (both run this whole text; every statement is IF NOT EXISTS). Owner per table: S = store, L = eventlog.
-- Mutable rows: db_meta (current_build pointer and schema_version) and documents.current_version. Everything
-- else is insert-only, enforced by the triggers at the end (Rules 2 and 3; append-only log).

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS db_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);                       -- S
INSERT OR IGNORE INTO db_meta (key, value) VALUES ('schema_version', '1');

CREATE TABLE IF NOT EXISTS recipes (                                                                   -- S
  recipe_id TEXT PRIMARY KEY, kind TEXT NOT NULL, version TEXT NOT NULL, spec TEXT NOT NULL);           -- spec = canonical JSON of RecipeSpec

CREATE TABLE IF NOT EXISTS parse_artifacts (                                                           -- S
  artifact_id TEXT PRIMARY KEY, source_sha256 TEXT NOT NULL, recipe_id TEXT NOT NULL REFERENCES recipes(recipe_id),
  source_name TEXT NOT NULL, produced_at TEXT NOT NULL, produced_on TEXT NOT NULL, stats TEXT NOT NULL,
  body BLOB NOT NULL,                                                                                  -- gzip of the envelope JSON
  UNIQUE (source_sha256, recipe_id));

CREATE TABLE IF NOT EXISTS documents (doc_key TEXT PRIMARY KEY, current_version TEXT);                -- S (mutable pointer)

CREATE TABLE IF NOT EXISTS doc_versions (                                                              -- S
  doc_version_id TEXT PRIMARY KEY, doc_key TEXT NOT NULL REFERENCES documents(doc_key),
  artifact_id TEXT NOT NULL REFERENCES parse_artifacts(artifact_id),
  chunk_recipe_id TEXT NOT NULL REFERENCES recipes(recipe_id), created_at TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS items (                                                                     -- S
  item_id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK (kind IN ('chunk', 'relation', 'summary')),
  text TEXT NOT NULL, recipe_id TEXT REFERENCES recipes(recipe_id), meta TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  CHECK ((kind = 'chunk') = (recipe_id IS NULL)));                                                     -- Rule 4

-- Chunk identity columns plus first-seen provenance (pages, block refs of the doc version that inserted it).
CREATE TABLE IF NOT EXISTS chunks (                                                                    -- S
  chunk_id TEXT PRIMARY KEY REFERENCES items(item_id), doc_key TEXT NOT NULL, section_path TEXT NOT NULL, -- JSON array
  occurrence INTEGER NOT NULL, pages TEXT NOT NULL, block_refs TEXT NOT NULL);                         -- JSON arrays

-- Reading order and per-version provenance (a reused chunk keeps its ID while its docling refs may differ).
CREATE TABLE IF NOT EXISTS doc_version_chunks (                                                        -- S
  doc_version_id TEXT NOT NULL REFERENCES doc_versions(doc_version_id), ordinal INTEGER NOT NULL,
  chunk_id TEXT NOT NULL REFERENCES chunks(chunk_id), pages TEXT NOT NULL, block_refs TEXT NOT NULL,
  PRIMARY KEY (doc_version_id, ordinal));
CREATE INDEX IF NOT EXISTS dvc_chunk ON doc_version_chunks(chunk_id);

CREATE TABLE IF NOT EXISTS item_sources (                                                              -- S; Rule 1, both directions indexed
  item_id TEXT NOT NULL REFERENCES items(item_id), chunk_id TEXT NOT NULL REFERENCES chunks(chunk_id),
  PRIMARY KEY (item_id, chunk_id));
CREATE INDEX IF NOT EXISTS item_sources_by_chunk ON item_sources(chunk_id, item_id);

CREATE TABLE IF NOT EXISTS embedding_spaces (                                                          -- S
  space_id TEXT PRIMARY KEY, model TEXT NOT NULL, dims INTEGER NOT NULL, spec TEXT NOT NULL);          -- spec = canonical JSON
CREATE TABLE IF NOT EXISTS embeddings (                                                                -- S; knn = vec_distance_cosine, brute force
  space_id TEXT NOT NULL REFERENCES embedding_spaces(space_id), item_id TEXT NOT NULL REFERENCES items(item_id),
  vector BLOB NOT NULL,                                                                                -- float32 little-endian, L2-normalized
  PRIMARY KEY (space_id, item_id));

CREATE TABLE IF NOT EXISTS builds (                                                                    -- S; build_id = buildId(manifest)
  build_id TEXT PRIMARY KEY, parent_id TEXT, created_at TEXT NOT NULL, manifest TEXT NOT NULL,         -- manifest = canonical JSON
  mixed_recipes INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS build_items (                                                               -- S
  build_id TEXT NOT NULL REFERENCES builds(build_id), item_id TEXT NOT NULL REFERENCES items(item_id),
  PRIMARY KEY (build_id, item_id));
CREATE INDEX IF NOT EXISTS build_items_by_item ON build_items(item_id);
CREATE TABLE IF NOT EXISTS build_labels (                                                              -- S; a name, once given, is permanent
  name TEXT PRIMARY KEY, build_id TEXT NOT NULL REFERENCES builds(build_id), created_at TEXT NOT NULL);

-- ---- v0-empty tables (shape committed now)
CREATE TABLE IF NOT EXISTS nodes (node_id TEXT PRIMARY KEY, name TEXT NOT NULL);                      -- S
CREATE TABLE IF NOT EXISTS relation_nodes (                                                            -- S
  item_id TEXT NOT NULL REFERENCES items(item_id), node_id TEXT NOT NULL REFERENCES nodes(node_id),
  surface TEXT NOT NULL, role TEXT, PRIMARY KEY (item_id, node_id, surface));
CREATE INDEX IF NOT EXISTS relation_nodes_by_node ON relation_nodes(node_id, item_id);
CREATE TABLE IF NOT EXISTS summary_members (                                                           -- S
  item_id TEXT NOT NULL REFERENCES items(item_id), member_id TEXT NOT NULL REFERENCES items(item_id),
  PRIMARY KEY (item_id, member_id));
CREATE INDEX IF NOT EXISTS summary_members_by_member ON summary_members(member_id, item_id);
CREATE TABLE IF NOT EXISTS derivation_runs (                                                           -- S
  run_id TEXT PRIMARY KEY, recipe_id TEXT NOT NULL REFERENCES recipes(recipe_id),
  input_state_hash TEXT NOT NULL, base_build_id TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS mappings (                                                                  -- S
  mapping_id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK (kind IN ('same-as', 'duplicate-of', 'refines', 'supersedes')),
  subject TEXT NOT NULL CHECK (subject IN ('node', 'item')), from_id TEXT NOT NULL, to_id TEXT NOT NULL,
  run_id TEXT NOT NULL REFERENCES derivation_runs(run_id), confidence REAL, note TEXT);
CREATE INDEX IF NOT EXISTS mappings_from ON mappings(from_id);
CREATE INDEX IF NOT EXISTS mappings_to ON mappings(to_id);
CREATE TABLE IF NOT EXISTS build_runs (                                                                -- S
  build_id TEXT NOT NULL REFERENCES builds(build_id), run_id TEXT NOT NULL REFERENCES derivation_runs(run_id),
  PRIMARY KEY (build_id, run_id));

-- ---- eval (eval sets themselves are canonical JSON files, evals/<setId>.json)
CREATE TABLE IF NOT EXISTS eval_runs (                                                                 -- S
  run_id TEXT PRIMARY KEY, eval_set_id TEXT NOT NULL, eval_set_sha256 TEXT NOT NULL, build_id TEXT NOT NULL,
  session_id TEXT NOT NULL, config TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS eval_results (                                                              -- S
  run_id TEXT NOT NULL REFERENCES eval_runs(run_id), question_id TEXT NOT NULL, condition TEXT NOT NULL,
  search_id TEXT, retrieved TEXT, recall TEXT, answer TEXT, judge_score REAL, judge_raw TEXT,          -- retrieved, recall: JSON
  PRIMARY KEY (run_id, question_id, condition));

-- ---- log
CREATE TABLE IF NOT EXISTS sessions (                                                                  -- L
  session_id TEXT PRIMARY KEY, kind TEXT NOT NULL, label TEXT, meta TEXT NOT NULL, started_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS events (                                                                    -- L; append-only
  event_id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(session_id), seq INTEGER NOT NULL,
  ts TEXT NOT NULL, type TEXT NOT NULL, schema_version INTEGER NOT NULL, build_id TEXT, search_id TEXT,
  parent_id TEXT, payload TEXT NOT NULL,                                                               -- payload = JSON
  UNIQUE (session_id, seq));
CREATE INDEX IF NOT EXISTS events_search ON events(search_id) WHERE search_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS events_type_ts ON events(type, ts);
CREATE TABLE IF NOT EXISTS session_notes (                                                             -- L
  note_id INTEGER PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(session_id),
  ts TEXT NOT NULL, text TEXT NOT NULL);

-- ---- insert-only enforcement
CREATE TRIGGER IF NOT EXISTS recipes_no_update BEFORE UPDATE ON recipes BEGIN SELECT RAISE(ABORT, 'recipes is insert-only'); END;
CREATE TRIGGER IF NOT EXISTS recipes_no_delete BEFORE DELETE ON recipes BEGIN SELECT RAISE(ABORT, 'recipes is insert-only'); END;
CREATE TRIGGER IF NOT EXISTS parse_artifacts_no_update BEFORE UPDATE ON parse_artifacts BEGIN SELECT RAISE(ABORT, 'parse_artifacts is insert-only'); END;
CREATE TRIGGER IF NOT EXISTS parse_artifacts_no_delete BEFORE DELETE ON parse_artifacts BEGIN SELECT RAISE(ABORT, 'parse_artifacts is insert-only'); END;
CREATE TRIGGER IF NOT EXISTS documents_no_delete BEFORE DELETE ON documents BEGIN SELECT RAISE(ABORT, 'documents rows are never deleted'); END;
CREATE TRIGGER IF NOT EXISTS doc_versions_no_update BEFORE UPDATE ON doc_versions BEGIN SELECT RAISE(ABORT, 'doc_versions is insert-only'); END;
CREATE TRIGGER IF NOT EXISTS doc_versions_no_delete BEFORE DELETE ON doc_versions BEGIN SELECT RAISE(ABORT, 'doc_versions is insert-only'); END;
CREATE TRIGGER IF NOT EXISTS items_no_update BEFORE UPDATE ON items BEGIN SELECT RAISE(ABORT, 'items is insert-only'); END;
CREATE TRIGGER IF NOT EXISTS items_no_delete BEFORE DELETE ON items BEGIN SELECT RAISE(ABORT, 'items is insert-only'); END;
CREATE TRIGGER IF NOT EXISTS chunks_no_update BEFORE UPDATE ON chunks BEGIN SELECT RAISE(ABORT, 'chunks is insert-only'); END;
CREATE TRIGGER IF NOT EXISTS chunks_no_delete BEFORE DELETE ON chunks BEGIN SELECT RAISE(ABORT, 'chunks is insert-only'); END;
CREATE TRIGGER IF NOT EXISTS doc_version_chunks_no_update BEFORE UPDATE ON doc_version_chunks BEGIN SELECT RAISE(ABORT, 'doc_version_chunks is insert-only'); END;
CREATE TRIGGER IF NOT EXISTS doc_version_chunks_no_delete BEFORE DELETE ON doc_version_chunks BEGIN SELECT RAISE(ABORT, 'doc_version_chunks is insert-only'); END;
CREATE TRIGGER IF NOT EXISTS item_sources_no_update BEFORE UPDATE ON item_sources BEGIN SELECT RAISE(ABORT, 'item_sources is insert-only'); END;
CREATE TRIGGER IF NOT EXISTS item_sources_no_delete BEFORE DELETE ON item_sources BEGIN SELECT RAISE(ABORT, 'item_sources is insert-only'); END;
CREATE TRIGGER IF NOT EXISTS embedding_spaces_no_update BEFORE UPDATE ON embedding_spaces BEGIN SELECT RAISE(ABORT, 'embedding_spaces is insert-only'); END;
CREATE TRIGGER IF NOT EXISTS embedding_spaces_no_delete BEFORE DELETE ON embedding_spaces BEGIN SELECT RAISE(ABORT, 'embedding_spaces is insert-only'); END;
CREATE TRIGGER IF NOT EXISTS embeddings_no_update BEFORE UPDATE ON embeddings BEGIN SELECT RAISE(ABORT, 'embeddings is insert-only'); END;
CREATE TRIGGER IF NOT EXISTS embeddings_no_delete BEFORE DELETE ON embeddings BEGIN SELECT RAISE(ABORT, 'embeddings is insert-only'); END;
CREATE TRIGGER IF NOT EXISTS builds_no_update BEFORE UPDATE ON builds BEGIN SELECT RAISE(ABORT, 'builds is insert-only'); END;
CREATE TRIGGER IF NOT EXISTS builds_no_delete BEFORE DELETE ON builds BEGIN SELECT RAISE(ABORT, 'builds is insert-only'); END;
CREATE TRIGGER IF NOT EXISTS build_items_no_update BEFORE UPDATE ON build_items BEGIN SELECT RAISE(ABORT, 'build_items is insert-only'); END;
CREATE TRIGGER IF NOT EXISTS build_items_no_delete BEFORE DELETE ON build_items BEGIN SELECT RAISE(ABORT, 'build_items is insert-only'); END;
CREATE TRIGGER IF NOT EXISTS build_labels_no_update BEFORE UPDATE ON build_labels BEGIN SELECT RAISE(ABORT, 'build_labels is insert-only'); END;
CREATE TRIGGER IF NOT EXISTS build_labels_no_delete BEFORE DELETE ON build_labels BEGIN SELECT RAISE(ABORT, 'build_labels is insert-only'); END;
CREATE TRIGGER IF NOT EXISTS nodes_no_update BEFORE UPDATE ON nodes BEGIN SELECT RAISE(ABORT, 'nodes is insert-only'); END;
CREATE TRIGGER IF NOT EXISTS nodes_no_delete BEFORE DELETE ON nodes BEGIN SELECT RAISE(ABORT, 'nodes is insert-only'); END;
CREATE TRIGGER IF NOT EXISTS relation_nodes_no_update BEFORE UPDATE ON relation_nodes BEGIN SELECT RAISE(ABORT, 'relation_nodes is insert-only'); END;
CREATE TRIGGER IF NOT EXISTS relation_nodes_no_delete BEFORE DELETE ON relation_nodes BEGIN SELECT RAISE(ABORT, 'relation_nodes is insert-only'); END;
CREATE TRIGGER IF NOT EXISTS summary_members_no_update BEFORE UPDATE ON summary_members BEGIN SELECT RAISE(ABORT, 'summary_members is insert-only'); END;
CREATE TRIGGER IF NOT EXISTS summary_members_no_delete BEFORE DELETE ON summary_members BEGIN SELECT RAISE(ABORT, 'summary_members is insert-only'); END;
CREATE TRIGGER IF NOT EXISTS derivation_runs_no_update BEFORE UPDATE ON derivation_runs BEGIN SELECT RAISE(ABORT, 'derivation_runs is insert-only'); END;
CREATE TRIGGER IF NOT EXISTS derivation_runs_no_delete BEFORE DELETE ON derivation_runs BEGIN SELECT RAISE(ABORT, 'derivation_runs is insert-only'); END;
CREATE TRIGGER IF NOT EXISTS mappings_no_update BEFORE UPDATE ON mappings BEGIN SELECT RAISE(ABORT, 'mappings is insert-only'); END;
CREATE TRIGGER IF NOT EXISTS mappings_no_delete BEFORE DELETE ON mappings BEGIN SELECT RAISE(ABORT, 'mappings is insert-only'); END;
CREATE TRIGGER IF NOT EXISTS build_runs_no_update BEFORE UPDATE ON build_runs BEGIN SELECT RAISE(ABORT, 'build_runs is insert-only'); END;
CREATE TRIGGER IF NOT EXISTS build_runs_no_delete BEFORE DELETE ON build_runs BEGIN SELECT RAISE(ABORT, 'build_runs is insert-only'); END;
CREATE TRIGGER IF NOT EXISTS eval_runs_no_update BEFORE UPDATE ON eval_runs BEGIN SELECT RAISE(ABORT, 'eval_runs is insert-only'); END;
CREATE TRIGGER IF NOT EXISTS eval_runs_no_delete BEFORE DELETE ON eval_runs BEGIN SELECT RAISE(ABORT, 'eval_runs is insert-only'); END;
CREATE TRIGGER IF NOT EXISTS eval_results_no_update BEFORE UPDATE ON eval_results BEGIN SELECT RAISE(ABORT, 'eval_results is insert-only'); END;
CREATE TRIGGER IF NOT EXISTS eval_results_no_delete BEFORE DELETE ON eval_results BEGIN SELECT RAISE(ABORT, 'eval_results is insert-only'); END;
CREATE TRIGGER IF NOT EXISTS sessions_no_update BEFORE UPDATE ON sessions BEGIN SELECT RAISE(ABORT, 'sessions is insert-only'); END;
CREATE TRIGGER IF NOT EXISTS sessions_no_delete BEFORE DELETE ON sessions BEGIN SELECT RAISE(ABORT, 'sessions is insert-only'); END;
CREATE TRIGGER IF NOT EXISTS events_no_update BEFORE UPDATE ON events BEGIN SELECT RAISE(ABORT, 'events is append-only'); END;
CREATE TRIGGER IF NOT EXISTS events_no_delete BEFORE DELETE ON events BEGIN SELECT RAISE(ABORT, 'events is append-only'); END;
CREATE TRIGGER IF NOT EXISTS session_notes_no_update BEFORE UPDATE ON session_notes BEGIN SELECT RAISE(ABORT, 'session_notes is insert-only'); END;
CREATE TRIGGER IF NOT EXISTS session_notes_no_delete BEFORE DELETE ON session_notes BEGIN SELECT RAISE(ABORT, 'session_notes is insert-only'); END;
