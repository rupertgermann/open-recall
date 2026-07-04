import assert from "node:assert/strict";
import test from "node:test";

import { eq } from "drizzle-orm";

import { chunks, documents } from "../src/db/schema.ts";
import { createTestDatabase } from "./helpers/db.ts";

test("PGlite test database applies migrations and round-trips pgvector embeddings", async (t) => {
  const { db, close } = await createTestDatabase();
  t.after(close);

  const [document] = await db
    .insert(documents)
    .values({
      title: "Vector test document",
      type: "note",
      content: "Content used by the vector test.",
      processingStatus: "completed",
    })
    .returning();

  const embedding = [0.125, -0.25, 0.5];
  const [chunk] = await db
    .insert(chunks)
    .values({
      documentId: document.id,
      content: "Content used by the vector test.",
      contentHash: "vector-test-chunk",
      embedding,
      chunkIndex: 0,
      embeddingStatus: "embedded",
    })
    .returning();

  const [row] = await db
    .select({
      documentTitle: documents.title,
      chunkContent: chunks.content,
      embedding: chunks.embedding,
    })
    .from(chunks)
    .innerJoin(documents, eq(chunks.documentId, documents.id))
    .where(eq(chunks.id, chunk.id));

  assert.deepEqual(row, {
    documentTitle: "Vector test document",
    chunkContent: "Content used by the vector test.",
    embedding,
  });
});

test("PGlite test database handles are isolated", async (t) => {
  const first = await createTestDatabase();
  t.after(first.close);

  await first.db.insert(documents).values({
    title: "Only in first database",
    type: "note",
  });

  const second = await createTestDatabase();
  t.after(second.close);

  const secondDocuments = await second.db.select().from(documents);

  assert.deepEqual(secondDocuments, []);
});
