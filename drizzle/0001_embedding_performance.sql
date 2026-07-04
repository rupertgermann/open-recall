-- Migration: Embedding Performance Improvements
-- Implements schema changes for phases 2-8 of the embedding refactor plan

-- Phase 3: Create embedding cache table
CREATE TABLE IF NOT EXISTS "embedding_cache" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "content_hash" text NOT NULL,
  "model" text NOT NULL,
  "embedding" vector NOT NULL,
  "purpose" text DEFAULT 'retrieval' NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

-- Phase 3: Indexes for embedding cache
CREATE UNIQUE INDEX IF NOT EXISTS "embedding_cache_hash_model_purpose_idx" 
  ON "embedding_cache" ("content_hash", "model", "purpose");
CREATE INDEX IF NOT EXISTS "embedding_cache_model_idx" ON "embedding_cache" ("model");
CREATE INDEX IF NOT EXISTS "embedding_cache_purpose_idx" ON "embedding_cache" ("purpose");

-- Phase 8: Add content hash to documents for change detection
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "content_hash" text;
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "embedding_model" text;
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "embedding_version" text;
CREATE INDEX IF NOT EXISTS "documents_content_hash_idx" ON "documents" ("content_hash");

-- Phase 2: Add content hash to chunks for deduplication
ALTER TABLE "chunks" ADD COLUMN IF NOT EXISTS "content_hash" text;
CREATE UNIQUE INDEX IF NOT EXISTS "chunks_content_hash_idx" ON "chunks" ("content_hash");

-- Phase 3: Add embedding cache reference to chunks
ALTER TABLE "chunks" ADD COLUMN IF NOT EXISTS "embedding_cache_id" uuid 
  REFERENCES "embedding_cache" ("id");

-- Phase 7: Add embedding status for incremental embedding
ALTER TABLE "chunks" ADD COLUMN IF NOT EXISTS "embedding_status" text DEFAULT 'pending' NOT NULL;
CREATE INDEX IF NOT EXISTS "chunks_embedding_status_idx" ON "chunks" ("embedding_status");

-- Phase 4: Add embedding purpose to chunks
ALTER TABLE "chunks" ADD COLUMN IF NOT EXISTS "embedding_purpose" text DEFAULT 'retrieval';

-- Update existing chunks to have 'embedded' status if they have embeddings
UPDATE "chunks" SET "embedding_status" = 'embedded' WHERE "embedding" IS NOT NULL;
