# Project log: ingestion service

## 2026-03-02: Record store is JSON files
The ingestion service keeps every record as a JSON file in the data folder. JSON files need no database server, and the first prototype handles about two hundred records a day.

## 2026-03-04: Chunk size is 500 characters
The ingestion service cuts each document into pieces of about 500 characters before embedding them. Pieces of this size were chosen because the first embedding model accepts at most 512 tokens.

## 2026-03-10: Embedding model is MiniLM
The ingestion service computes embeddings with the MiniLM sentence model, which runs on a laptop processor in about 40 milliseconds per piece.

## 2026-03-12: Deployment is by hand with a copy script
A developer deploys the ingestion service by running the copy script, which uploads the build to the server over SSH and restarts the process.

## 2026-03-16: Record store is SQLite
Two ingestion workers now write records at the same time, and concurrent writes corrupted three JSON files in one week. This supersedes the decision of 2026-03-02 that the record store is JSON files. SQLite serialises writes and keeps all records in one file.

## 2026-03-18: Request rate limit is 60 per minute
The ingestion service caps requests to the upstream API at 60 per minute, because the API provider blocks clients that send more than 100.

## 2026-03-23: Chunk size is 1000 characters
Questions about long explanations lost their context when the passage holding the answer was cut at 500 characters. This overrides the 2026-03-04 chunk size of 500 characters. Pieces of about 1000 characters raised recall at five results from 0.71 to 0.82 on the review questions.

## 2026-03-30: Log lines are plain text
The ingestion service writes one plain text line per event to the log file, with the time, the level and a message.

## 2026-04-02: Query reranking was tried and rejected
A cross-encoder reranking step was added after the similarity search for one week. Recall at five results did not change on the review questions, and each search took 300 milliseconds longer, so the reranking step was removed.

## 2026-04-06: Record store is Postgres
Three services now write records, and SQLite on one machine cannot be shared between them. This replaces the decision of 2026-03-16 to keep the record store in SQLite. Postgres allows several machines to write at once.

## 2026-04-13: Embedding model is embeddinggemma
The ingestion service now computes embeddings with the embeddinggemma model, which handles 2048 tokens and raised recall at five results from 0.82 to 0.88. The MiniLM model is no longer used anywhere.

## 2026-04-20: Deployment runs from the continuous integration pipeline
A merge to the main branch now builds and deploys the ingestion service automatically. The manual deployment of 2026-03-12 is replaced by this pipeline, and the copy script has been deleted.

## 2026-04-27: Log lines are JSON
The ingestion service writes one JSON object per event, with the time, the level, the message and the request number. This reverses the 2026-03-30 decision to write plain text lines, because the log search tool cannot parse plain text.

## 2026-05-04: Authentication uses API keys
Clients of the ingestion service authenticate with an API key sent in a request header. Each client gets one key, which an administrator can revoke.

## 2026-05-04: Failed requests are retried three times
The ingestion service retries a failed upstream request up to three times, waiting twice as long before each new attempt.

## 2026-05-18: Authentication uses OAuth
Clients now authenticate with OAuth access tokens issued by the company login service, so that access ends when an employee leaves. This replaces the decision of 2026-05-04 that authentication uses API keys.
