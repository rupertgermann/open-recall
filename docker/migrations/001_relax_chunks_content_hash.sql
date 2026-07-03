DROP INDEX IF EXISTS chunks_content_hash_idx;

CREATE UNIQUE INDEX IF NOT EXISTS chunks_document_content_hash_idx
  ON chunks (document_id, content_hash);
