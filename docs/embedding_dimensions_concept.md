# Embedding Dimensions and Model Consistency

## The Constraint

Embedding models produce vectors with fixed but different dimensions:

- `nomic-embed-text`: 768 dimensions
- `text-embedding-3-small`: 1536 dimensions
- `text-embedding-3-large`: 3072 dimensions

PostgreSQL can store vectors from these models in generic pgvector `vector`
columns, but distance operations still compare one query vector with stored
vectors of the same dimensionality. A 1536-dimensional OpenAI query vector cannot
be compared with a 768-dimensional local embedding.

## Current Storage Model

open-recall uses generic `vector` columns instead of fixed `vector(N)` columns.
This keeps the schema flexible while preserving pgvector search behavior.

The embedding-related schema includes:

- `documents.embedding_model` and `documents.embedding_version`
- `chunks.embedding`
- `chunks.embedding_cache_id`
- `chunks.embedding_status`
- `chunks.embedding_purpose`
- `embedding_cache.content_hash`
- `embedding_cache.model`
- `embedding_cache.purpose`
- `embedding_cache.embedding`

The embedding cache is unique by `content_hash`, `model`, and `purpose`, so the
same text can have separate retrieval and graph embeddings and can be embedded
again under a different model without overwriting existing cached rows.

## Runtime Behavior

The ingestion pipeline records the current embedding model on each document. It
also stores `embedding_version` as the current application embedding version.

Source refresh compares:

- the latest source content hash with `documents.content_hash`
- the current configured embedding model with `documents.embedding_model`

When both values match, the document metadata can be refreshed without
rebuilding chunks, tags, mentions, relationships, or embeddings. When either
value differs, the pipeline rebuilds the document-owned derived rows and stores
embeddings from the current model.

Retrieval uses the currently configured embedding model to embed the query, then
compares that query vector against stored chunk and entity embeddings. Existing
stored vectors from a different dimensionality can still cause pgvector
dimension mismatch errors during retrieval.

## Operational Policy

Use one embedding model for a working library unless you are intentionally
re-indexing content.

When changing embedding providers or embedding models:

1. Select the target embedding model in Settings or `.env`.
2. Refresh source-backed documents from the library or document detail page.
3. Recreate pasted notes that were embedded with a different model.
4. Keep using the selected model for subsequent ingestion and retrieval.

For a clean local reset, clear the affected data and re-ingest with the selected
embedding model.

## Why Generic `vector` Columns Still Matter

Generic `vector` columns allow the same schema to accept local and OpenAI
embeddings without a migration for every model dimension. The tradeoff is that
runtime consistency is an application and operations concern: retrieval remains
dimension-sensitive even though storage accepts multiple dimensions.

## Current Boundaries

- There is no global background re-index worker.
- There is no automatic filtering of retrieval candidates by vector dimension.
- Pasted notes do not have a source URL, so they are recreated rather than
  source-refreshed.
- Document-level `embedding_model` tracks which model produced a document's
  derived retrieval data, while chunk rows do not independently store model
  names.

## Related Implementation Files

- `src/db/schema.ts`: vector columns, document embedding metadata, chunk
  embedding fields, and embedding cache schema
- `src/lib/embedding/cache.ts`: content hashing and cache lookup/insert logic
- `src/lib/embedding/service.ts`: model-aware cached embedding orchestration
- `src/lib/ingestion/service.ts`: source refresh, content-hash checks, and
  document-level embedding model tracking
- `src/actions/chat.ts`: retrieval entry point used by chat
