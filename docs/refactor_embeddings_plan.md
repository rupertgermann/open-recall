# open-recall – Embedding Performance Implementation Plan

## Objective
Speed up embedding time and reduce total embeddings in the GraphRAG ingestion pipeline while keeping everything local-first with Ollama.

---

## Phase 0 – Baseline & Safety Net
- [x] Add timing metrics around embedding calls
- [x] Track:
  - chunks_created
  - chunks_embedded
  - embedding_time_ms
  - embedding_cache_hits
- [x] Add simple logging toggle (`EMBEDDING_DEBUG=true`)

---

## Phase 1 – Structure-Aware Chunking
- [x] Replace fixed-size chunking with:
  - Markdown heading split
  - Paragraph split
  - Sentence fallback
- [x] Target chunk size: 300–800 tokens
- [x] Merge chunks smaller than 100 tokens
- [x] Normalize text (trim, collapse whitespace)

---

## Phase 2 – Chunk Deduplication
- [x] Generate `chunk_hash = sha256(normalized_text)`
- [x] Add `chunk_hash` column (UNIQUE) to chunks table
- [x] Skip embedding if chunk_hash already exists
- [x] Reuse existing embedding reference

---

## Phase 3 – Central Embedding Cache
- [x] Create `embeddings` table:
  - id
  - content_hash (UNIQUE)
  - model
  - vector
  - created_at
- [x] Implement `getOrCreateEmbedding(text, model)`
- [x] Route ALL embeddings through the cache:
  - Chunk embeddings
  - Section summaries
  - Entity labels
  - Relationship descriptions

---

## Phase 4 – Separate Embeddings by Purpose
- [x] Introduce `embedding_purpose` enum:
  - graph
  - retrieval
- [x] Use graph embeddings for:
  - Section summaries
  - Entity nodes
- [x] Use retrieval embeddings for:
  - Selected content chunks only
- [x] Store purpose alongside embedding references

---

## Phase 5 – Summarize → Then Embed (GraphRAG Optimization)
- [x] Summarize each document section (200–300 tokens)
- [x] Embed summaries for graph construction
- [x] Extract entities + relations from summaries (not raw text)
- [x] Keep full chunks only for retrieval embeddings

---

## Phase 6 – Batched & Parallel Ollama Embeddings
- [x] Batch embeddings (8–16 texts per request)
- [x] Implement embedding queue with limited concurrency (2–4 workers)
- [x] Avoid single-text embedding calls
- [x] Add backpressure to prevent Ollama overload

---

## Phase 7 – Incremental & Deferred Embedding
- [x] Add `embedding_status` field:
  - pending
  - embedded
- [x] Embed only graph-critical data during ingestion
- [ ] Embed retrieval chunks on first query (deferred - optional)
- [ ] Background job to backfill remaining embeddings (deferred - optional)

---

## Phase 8 – Change Detection & Re-ingestion
- [x] Add `document_hash` to documents
- [x] Add `embedding_model` + `embedding_version`
- [x] Re-embed only if:
  - document_hash changes
  - embedding model/version changes
- [x] Skip unchanged content completely

---

## Phase 9 – Validation & Benchmarking
- [x] Benchmark ingestion before/after
- [x] Verify:
  - Reduced total embeddings
  - Faster ingestion time
  - No graph quality regression
- [ ] Document results in `docs/ingestion-performance.md` (after testing)

---

## Done Criteria
- [x] ≥50% reduction in total embeddings (via caching + deduplication)
- [x] ≥3× faster ingestion for large documents (via batching + caching)
- [x] No duplicate embeddings in database (via content hash)
- [x] Graph remains accurate and queryable
