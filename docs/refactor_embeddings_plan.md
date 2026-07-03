# Embedding Pipeline

## Objective

The embedding pipeline reduces repeated embedding work during GraphRAG ingestion
while preserving local-first operation and compatibility with OpenAI-compatible
embedding providers.

## Runtime Flow

1. Normalize source text and compute a document content hash.
2. Split content with structure-aware chunking.
3. Deduplicate repeated chunk hashes inside the current document ingestion run.
4. Generate retrieval embeddings for saved chunks.
5. Generate graph embeddings for entities created during the run.
6. Route embedding requests through the central embedding cache.
7. Store document-level embedding model/version metadata.
8. Skip source refresh rebuilds when source content and embedding model are
   unchanged.

## Structure-Aware Chunking

`src/lib/embedding/chunker.ts` splits text in this order:

- Markdown headings
- Paragraphs
- Sentence fallback for large paragraphs
- Small-chunk merging

Default chunk sizing is:

- Minimum chunk size: 100 estimated tokens
- Target chunk size: 500 estimated tokens
- Maximum chunk size: 800 estimated tokens

`src/lib/text/index.ts` normalizes whitespace and estimates tokens at roughly
four characters per token.

## Content Hashes

Content hashes use SHA-256 over lowercased, whitespace-normalized text.

The app stores hashes in:

- `documents.content_hash` for source-change detection
- `chunks.content_hash` for per-document chunk deduplication
- `embedding_cache.content_hash` for embedding reuse

Chunk uniqueness is scoped by document through
`chunks_document_content_hash_idx`, which allows the same chunk text to appear in
different documents while preventing duplicate chunk rows inside one document.

## Embedding Cache

`embedding_cache` is the central cache for generated vectors. It is unique by:

- `content_hash`
- `model`
- `purpose`

The `purpose` field separates retrieval embeddings from graph embeddings. The
same text can therefore have independent cached vectors for `retrieval` and
`graph` purposes under the same model.

`batchGetOrCreateEmbeddings` checks cache entries for a whole batch first,
generates only missing vectors, and writes missing vectors back to the cache.

## Batching and Concurrency

`generateEmbeddingsWithCache` processes embeddings in batches of 16 texts and
runs at most two embedding batches concurrently. This keeps Ollama/local
providers from being overloaded while still avoiding one request per text.

The embedding service exposes:

- `generateRetrievalEmbeddings(texts)`
- `generateGraphEmbeddings(texts)`
- `generateEmbeddingWithCache(text, purpose)`
- `generateEmbeddingsWithCache(texts, purpose)`

## Ingestion Behavior

The ingestion service uses retrieval embeddings for chunks and graph embeddings
for entities created during the run. Existing entities keep their existing
embedding. Entity mentions are mapped to chunks that contain matching entity
names, with a fallback mention on the first chunk when no literal mention is
found. Relationships whose endpoints cannot be resolved or are ambiguous are
dropped before insert.

Source refresh cleans document-owned derived rows before rebuilding:

- relationships with the document as `source_document_id`
- entity mentions for the document
- document tags for the document
- chunks for the document

The document row is then updated with the latest title, type, content,
`content_hash`, summary, `embedding_model`, `embedding_version`, status, and
timestamp.

## Metrics and Debugging

`EMBEDDING_DEBUG=true` enables debug logging in `src/lib/embedding/metrics.ts`.
The metrics collector tracks:

- chunks created
- chunks embedded
- embedding cache hits
- embedding cache misses
- total texts processed
- batch count
- embedding time
- total ingestion time

`src/lib/embedding/benchmark.ts` provides database-backed statistics for current
embedding state:

- total documents
- total chunks
- cached embeddings
- pending embeddings
- embedded chunks
- unique content hashes
- duplicate chunks avoided
- cache hit rate
- average chunks per document
- average tokens per chunk
- entity embedding counts

## Current Boundaries

- Retrieval chunks are embedded during ingestion.
- Pending retrieval chunk backfill is not handled by a background worker.
- Retrieval queries do not filter candidates by embedding model or dimension.
- Mixed-dimension libraries require source refresh, note recreation, or data
  reset under one embedding model.
- Benchmark helpers report database state; they do not run an automated
  before/after benchmark suite by themselves.

## Validation Surface

The unit tests cover the pure planning and scoring logic around ingestion,
retrieval, SRS, Discover, AI model lists, error messages, search results, chat
helpers, and text hashing.

```bash
npm test
```
