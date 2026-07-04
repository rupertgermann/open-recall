CREATE TABLE IF NOT EXISTS "document_tags" (
	"document_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "document_tags_document_id_tag_id_pk" PRIMARY KEY("document_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX IF EXISTS "mentions_chunk_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "mentions_document_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "mentions_entity_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "entities_name_type_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "entities_type_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "relationships_source_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "relationships_target_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "relationships_type_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "documents_content_hash_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "documents_status_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "documents_type_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "documents_url_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "srs_document_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "srs_due_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "srs_state_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "chat_threads_last_message_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "chat_messages_created_at_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "chat_messages_thread_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "chunks_content_hash_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "chunks_document_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "chunks_embedding_status_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "chunks_order_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "embedding_cache_hash_model_purpose_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "embedding_cache_model_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "embedding_cache_purpose_idx";--> statement-breakpoint
ALTER TABLE "chat_threads" ADD COLUMN "category" text DEFAULT 'general' NOT NULL;--> statement-breakpoint
ALTER TABLE "chat_threads" ADD COLUMN "entity_id" uuid;--> statement-breakpoint
ALTER TABLE "chat_threads" ADD COLUMN "document_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "document_tags" ADD CONSTRAINT "document_tags_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "document_tags" ADD CONSTRAINT "document_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_tags_document_idx" ON "document_tags" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_tags_tag_idx" ON "document_tags" USING btree ("tag_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tags_name_idx" ON "tags" USING btree ("name");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "chat_threads" ADD CONSTRAINT "chat_threads_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "chat_threads" ADD CONSTRAINT "chat_threads_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chat_threads_entity_idx" ON "chat_threads" USING btree ("entity_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chat_threads_document_idx" ON "chat_threads" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chat_threads_category_idx" ON "chat_threads" USING btree ("category");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mentions_chunk_idx" ON "entity_mentions" USING btree ("chunk_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mentions_document_idx" ON "entity_mentions" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mentions_entity_idx" ON "entity_mentions" USING btree ("entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "entities_name_type_idx" ON "entities" USING btree ("name","type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "entities_type_idx" ON "entities" USING btree ("type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "relationships_source_idx" ON "relationships" USING btree ("source_entity_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "relationships_target_idx" ON "relationships" USING btree ("target_entity_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "relationships_type_idx" ON "relationships" USING btree ("relation_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "documents_content_hash_idx" ON "documents" USING btree ("content_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "documents_status_idx" ON "documents" USING btree ("processing_status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "documents_type_idx" ON "documents" USING btree ("type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "documents_url_idx" ON "documents" USING btree ("url");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "srs_document_idx" ON "srs_items" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "srs_due_idx" ON "srs_items" USING btree ("due_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "srs_state_idx" ON "srs_items" USING btree ("state");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chat_threads_last_message_idx" ON "chat_threads" USING btree ("last_message_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chat_messages_created_at_idx" ON "chat_messages" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chat_messages_thread_idx" ON "chat_messages" USING btree ("thread_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "chunks_content_hash_idx" ON "chunks" USING btree ("content_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chunks_document_idx" ON "chunks" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chunks_embedding_status_idx" ON "chunks" USING btree ("embedding_status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chunks_order_idx" ON "chunks" USING btree ("document_id","chunk_index");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "embedding_cache_hash_model_purpose_idx" ON "embedding_cache" USING btree ("content_hash","model","purpose");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "embedding_cache_model_idx" ON "embedding_cache" USING btree ("model");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "embedding_cache_purpose_idx" ON "embedding_cache" USING btree ("purpose");