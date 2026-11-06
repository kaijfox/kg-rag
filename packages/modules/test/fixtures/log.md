# Decision log

A log of decisions, one entry each.

## 2026-03-01: Store is JSON files
The project store is JSON files on disk. Reason: it is the simplest thing that works.

## 2026-03-15: Search uses keyword matching
Search is keyword matching over the JSON files.

## 2026-04-02: Store is SQLite
Decision: the project store is SQLite. This supersedes the decision of 2026-03-01 that the store is JSON files.

## 2026-04-02: Embeddings come from a local model
Search uses embeddings from a local model. Replaces the keyword matching decided on 2026-03-15.

## 2026-05-01: Viewer shows sessions
The viewer lists sessions and their events.

## 2026-05-01: Viewer draws diagrams
The viewer draws a diagram of each machine.

## 2026-06-01: Something changes
This replaces the decision of 2026-05-01.
