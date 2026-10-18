# Change proposal from store/eventlog review: comments in core/src/schema.sql (comments only)

No DDL change. Two comments describe behaviour the store does not have:

1. Line 54, `embeddings.vector`: "float32 little-endian, L2-normalized". The store keeps vectors as given (cosine
   distance is scale-invariant). Suggest: "float32 little-endian, stored as given".
2. Line 57, `builds`: "build_id = buildId(manifest)". The id is derived from the manifest plus the item ids
   (`composeBuild`/`buildId`). Suggest: "build_id = buildId(manifest, itemIds)" (use the actual signature).

Also the header says both packages run the whole file on every open; they now run it only when `db_meta` lacks the
current `schema_version`. Suggest: "Applied idempotently by `store` and `eventlog` when the file does not yet carry
this schema_version."
Deferred (not proposed now): `relation_nodes.position INTEGER NOT NULL` for explicit node order.
