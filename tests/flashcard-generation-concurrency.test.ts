import assert from "node:assert/strict";
import test from "node:test";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "../src/db/schema.ts";
import { createTestDatabase } from "./helpers/db.ts";
import { useDatabase } from "./helpers/server.ts";
import { completion } from "./helpers/provider.ts";

const { generateDocumentFlashcards } = await import("../src/actions/srs.ts");
const { saveAISettings, getAISettings } = await import("../src/actions/settings.ts");

test("overlapping flashcard generation inserts each normalized question once", async (t) => {
  const database = await createTestDatabase();
  t.after(database.close);
  const queries: string[] = [];
  const db = drizzle(database.pglite, { schema, logger: { logQuery: (query) => queries.push(query) } });
  useDatabase(db);
  const config = { provider: "local" as const, baseUrl: "http://provider.invalid/v1", model: "test" };
  await saveAISettings({ chat: config, embedding: config }, await getAISettings());
  const [doc] = await db.insert(schema.documents).values({ title: "Flashcards", content: "An answer is 42.", type: "note" }).returning();
  const [reviewed] = await db.insert(schema.srsItems).values({ documentId: doc.id, question: "Reviewed?", answer: "Keep", reps: 12, stability: 30 }).returning();
  const bothStarted = Promise.withResolvers<void>();
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    const call = ++calls;
    if (call === 2) bothStarted.resolve();
    await bothStarted.promise;
    return completion(JSON.stringify({ flashcards: [
      { question: call % 2 ? "What is the answer?" : " what is the answer? ", answer: "42" },
      { question: "reviewed?", answer: "Replace?" },
    ] }));
  });

  const results = await Promise.all([generateDocumentFlashcards(doc.id, 2), generateDocumentFlashcards(doc.id, 2)]);
  assert.deepEqual(results.map((result) => result.created).sort(), [0, 1]);
  const rows = await db.select().from(schema.srsItems);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.find((row) => row.id === reviewed.id), reviewed);
  // PGlite serializes transactions; PostgreSQL sessions also need this Document row lock.
  assert.equal(queries.filter((query) => /select .* from "documents" .* for update$/i.test(query)).length, 2);
});

test("a Document deleted during generation reports not found without inserting cards", async (t) => {
  const { db, close } = await createTestDatabase();
  t.after(close);
  useDatabase(db);
  const config = { provider: "local" as const, baseUrl: "http://provider.invalid/v1", model: "test" };
  await saveAISettings({ chat: config, embedding: config }, await getAISettings());
  const [doc] = await db.insert(schema.documents).values({ title: "Gone", content: "Content", type: "note" }).returning();
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  t.mock.method(globalThis, "fetch", async () => {
    started.resolve();
    await release.promise;
    return completion(JSON.stringify({ flashcards: [{ question: "Question?", answer: "Answer" }] }));
  });
  const pending = generateDocumentFlashcards(doc.id, 1);
  await started.promise;
  const { eq } = await import("drizzle-orm");
  await db.delete(schema.documents).where(eq(schema.documents.id, doc.id));
  release.resolve();
  assert.deepEqual(await pending, { success: false, created: 0, cards: [], error: "Document not found" });
  assert.equal((await db.select().from(schema.srsItems)).length, 0);
});
