CREATE TABLE IF NOT EXISTS "tags" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "tags_name_idx" ON "tags" ("name");

CREATE TABLE IF NOT EXISTS "document_tags" (
  "document_id" uuid NOT NULL,
  "tag_id" uuid NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "document_tags_pk" PRIMARY KEY ("document_id", "tag_id")
);

CREATE INDEX IF NOT EXISTS "document_tags_document_idx" ON "document_tags" ("document_id");
CREATE INDEX IF NOT EXISTS "document_tags_tag_idx" ON "document_tags" ("tag_id");

DO $$ BEGIN
  ALTER TABLE "document_tags" ADD CONSTRAINT "document_tags_document_id_documents_id_fk"
    FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "document_tags" ADD CONSTRAINT "document_tags_tag_id_tags_id_fk"
    FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
