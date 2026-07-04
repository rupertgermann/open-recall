-- Current sql file was generated after introspecting the database
-- If you want to run this migration please uncomment this code before executing migrations
/*
CREATE TABLE IF NOT EXISTS "entity_mentions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" uuid NOT NULL,
	"chunk_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"confidence" real DEFAULT 1,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "entities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"description" text,
	"embedding" vector,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "relationships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_entity_id" uuid NOT NULL,
	"target_entity_id" uuid NOT NULL,
	"relation_type" text NOT NULL,
	"description" text,
	"weight" real DEFAULT 1,
	"source_document_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"url" text,
	"title" text NOT NULL,
	"type" text NOT NULL,
	"content" text,
	"summary" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"processing_status" text DEFAULT 'pending' NOT NULL,
	"metadata" jsonb,
	"content_hash" text,
	"embedding_model" text,
	"embedding_version" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "settings_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "srs_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"question" text NOT NULL,
	"answer" text NOT NULL,
	"stability" real DEFAULT 0,
	"difficulty" real DEFAULT 0,
	"elapsed_days" integer DEFAULT 0,
	"scheduled_days" integer DEFAULT 0,
	"reps" integer DEFAULT 0,
	"lapses" integer DEFAULT 0,
	"state" integer DEFAULT 0,
	"due_date" timestamp DEFAULT now() NOT NULL,
	"last_review_date" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "chat_threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text DEFAULT 'New chat' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"last_message_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "chat_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thread_id" uuid NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"content" text NOT NULL,
	"embedding" vector,
	"chunk_index" integer NOT NULL,
	"token_count" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"content_hash" text,
	"embedding_cache_id" uuid,
	"embedding_status" text DEFAULT 'pending' NOT NULL,
	"embedding_purpose" text DEFAULT 'retrieval'
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "embedding_cache" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"content_hash" text NOT NULL,
	"model" text NOT NULL,
	"embedding" vector NOT NULL,
	"purpose" text DEFAULT 'retrieval' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "entity_mentions" ADD CONSTRAINT "entity_mentions_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "entity_mentions" ADD CONSTRAINT "entity_mentions_chunk_id_chunks_id_fk" FOREIGN KEY ("chunk_id") REFERENCES "public"."chunks"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "entity_mentions" ADD CONSTRAINT "entity_mentions_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "relationships" ADD CONSTRAINT "relationships_source_entity_id_entities_id_fk" FOREIGN KEY ("source_entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "relationships" ADD CONSTRAINT "relationships_target_entity_id_entities_id_fk" FOREIGN KEY ("target_entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "relationships" ADD CONSTRAINT "relationships_source_document_id_documents_id_fk" FOREIGN KEY ("source_document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "srs_items" ADD CONSTRAINT "srs_items_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_thread_id_chat_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."chat_threads"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "chunks" ADD CONSTRAINT "chunks_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "chunks" ADD CONSTRAINT "chunks_embedding_cache_id_embedding_cache_id_fk" FOREIGN KEY ("embedding_cache_id") REFERENCES "public"."embedding_cache"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mentions_chunk_idx" ON "entity_mentions" USING btree ("chunk_id" uuid_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mentions_document_idx" ON "entity_mentions" USING btree ("document_id" uuid_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mentions_entity_idx" ON "entity_mentions" USING btree ("entity_id" uuid_ops);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "entities_name_type_idx" ON "entities" USING btree ("name" text_ops,"type" text_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "entities_type_idx" ON "entities" USING btree ("type" text_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "relationships_source_idx" ON "relationships" USING btree ("source_entity_id" uuid_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "relationships_target_idx" ON "relationships" USING btree ("target_entity_id" uuid_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "relationships_type_idx" ON "relationships" USING btree ("relation_type" text_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "documents_content_hash_idx" ON "documents" USING btree ("content_hash" text_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "documents_status_idx" ON "documents" USING btree ("processing_status" text_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "documents_type_idx" ON "documents" USING btree ("type" text_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "documents_url_idx" ON "documents" USING btree ("url" text_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "srs_document_idx" ON "srs_items" USING btree ("document_id" uuid_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "srs_due_idx" ON "srs_items" USING btree ("due_date" timestamp_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "srs_state_idx" ON "srs_items" USING btree ("state" int4_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chat_threads_last_message_idx" ON "chat_threads" USING btree ("last_message_at" timestamp_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chat_messages_created_at_idx" ON "chat_messages" USING btree ("created_at" timestamp_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chat_messages_thread_idx" ON "chat_messages" USING btree ("thread_id" uuid_ops);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "chunks_content_hash_idx" ON "chunks" USING btree ("content_hash" text_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chunks_document_idx" ON "chunks" USING btree ("document_id" uuid_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chunks_embedding_status_idx" ON "chunks" USING btree ("embedding_status" text_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chunks_order_idx" ON "chunks" USING btree ("document_id" uuid_ops,"chunk_index" uuid_ops);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "embedding_cache_hash_model_purpose_idx" ON "embedding_cache" USING btree ("content_hash" text_ops,"model" text_ops,"purpose" text_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "embedding_cache_model_idx" ON "embedding_cache" USING btree ("model" text_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "embedding_cache_purpose_idx" ON "embedding_cache" USING btree ("purpose" text_ops);
*/