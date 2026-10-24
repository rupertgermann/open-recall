import assert from "node:assert/strict";
import test from "node:test";
import { eq, sql } from "drizzle-orm";
import { chatMessages, chatThreads, chunks, documents, entities, entityMentions, relationships } from "../src/db/schema.ts";
import { createDocumentIngestionService } from "../src/lib/ingestion/service.ts";
import { createTestDatabase } from "./helpers/db.ts";
import { useDatabase } from "./helpers/server.ts";
import { completion } from "./helpers/provider.ts";

const config = (model: string) => ({ provider: "local" as const, baseUrl: "http://provider.invalid/v1", model });

test("Source Refresh repairs legacy and same-dimensional Entity models using the stored description", async (t) => {
  const { db, close } = await createTestDatabase();
  t.after(close);
  useDatabase(db);
  const { getAISettings, saveAISettings } = await import("../src/actions/settings.ts");
  const { retrieveContext } = await import("../src/actions/chat.ts");
  await saveAISettings({ chat: config("chat"), embedding: config("old") }, await getAISettings());
  const inputs: { model: string; text: string }[] = [];
  let description = "Original description";
  t.mock.method(globalThis, "fetch", async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
    if (String(url) === "https://source.invalid/article") {
      return new Response("<html><title>Database</title><article><p>Postgres is our database.</p></article></html>");
    }
    const body = JSON.parse(String(init?.body));
    if (String(url).endsWith("/embeddings")) {
      const texts: string[] = Array.isArray(body.input) ? body.input : [body.input];
      inputs.push(...texts.map(text => ({ model: body.model, text })));
      return Response.json({ data: texts.map((_, index) => ({ index, embedding: body.model === "old" ? [1, 0] : [0, 1] })) });
    }
    const system = body.messages[0].content;
    return completion(system.includes("reusable tags") ? '{"tags": []}' : system.includes("extracting structured knowledge")
      ? JSON.stringify({ entities: [{ name: "Postgres", type: "technology", description }], relationships: [] })
      : "Postgres is our database.");
  });
  const service = createDocumentIngestionService({ database: db, revalidatePath() {} });
  const result = await service.ingestUrlDocument("https://source.invalid/article");
  const [original] = await db.select().from(entities);
  description = "A different extracted description";
  await saveAISettings({ chat: config("chat"), embedding: config("new") }, await getAISettings());
  assert.equal((await service.refreshDocument(result.documentId)).action, "refreshed");
  const [refreshed] = await db.select().from(entities);
  assert.equal(refreshed.id, original.id);
  assert.equal(refreshed.description, "Original description");
  assert.equal(refreshed.embeddingModel, "new");
  assert.deepEqual(refreshed.embedding, [0, 1]);
  assert.ok(inputs.some(input => input.model === "new" && input.text === "Postgres: Original description"));
  assert.equal(inputs.some(input => input.text.includes("different extracted")), false);
  assert.ok((await retrieveContext("Postgres")).entities.some(entity => entity.id === original.id));

  for (const stale of [
    { embeddingModel: null, embedding: [1, 0] },
    { embeddingModel: "old", embedding: [1, 0] },
    { embeddingModel: "new", embedding: null },
  ]) {
    await db.update(entities).set(stale).where(eq(entities.id, original.id));
    const before = inputs.length;
    assert.equal((await service.refreshDocument(result.documentId)).skipped, false);
    const [repaired] = await db.select().from(entities);
    assert.equal(repaired.embeddingModel, "new");
    assert.deepEqual(repaired.embedding, [0, 1]);
    assert.equal(inputs.length, before, "repair reuses the graph and retrieval caches");
    assert.equal((await service.refreshDocument(result.documentId)).skipped, true);
  }
});

test("ingestion rebuilds outside persistence when a concurrent Entity has a different description", async (t) => {
  const { db, close } = await createTestDatabase();
  t.after(close);
  useDatabase(db);
  const { getAISettings, saveAISettings } = await import("../src/actions/settings.ts");
  await saveAISettings({ chat: config("chat"), embedding: config("new") }, await getAISettings());
  let winnerId: string | undefined;
  const embedded: string[] = [];
  let extractionCount = 0;
  t.mock.method(globalThis, "fetch", async (_url: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    if (String(_url).endsWith("/embeddings")) {
      const texts: string[] = Array.isArray(body.input) ? body.input : [body.input];
      embedded.push(...texts);
      if (texts.includes("Postgres: Extracted description") && !winnerId) {
        const [winner] = await db.insert(entities).values({
          name: "Postgres", type: "technology", description: "Concurrent description", embedding: [1, 0], embeddingModel: "old",
        }).returning();
        winnerId = winner.id;
      }
      return Response.json({ data: texts.map((_, index) => ({ index, embedding: [0, 1] })) });
    }
    const system = body.messages[0].content;
    if (system.includes("extracting structured knowledge")) extractionCount++;
    return completion(system.includes("reusable tags") ? '{"tags": []}' : system.includes("extracting structured knowledge")
      ? JSON.stringify({ entities: [{ name: "Postgres", type: "technology", description: "Extracted description" }], relationships: [] })
      : "Postgres is our database.");
  });
  const service = createDocumentIngestionService({ database: db, revalidatePath() {} });
  const result = await service.ingestTextDocument({ title: "Database", content: "Postgres is our database." });
  const [stored] = await db.select().from(entities);
  assert.equal(stored.id, winnerId);
  assert.equal(stored.description, "Concurrent description");
  assert.equal(stored.embeddingModel, "new");
  assert.deepEqual(stored.embedding, [0, 1]);
  assert.equal(extractionCount, 2, "the incompatible concurrent winner causes one rebuild");
  assert.ok(embedded.includes("Postgres: Concurrent description"));
  assert.equal((await db.select().from(chunks)).length, 1, "the failed persistence attempt rolled back");
  assert.equal((await db.select().from(entityMentions))[0].documentId, result.documentId);
});

test("Source Refresh prunes only abandoned Entities, preserves shared Entities and chat, and rolls back failed replacement", async (t) => {
  const { db, close } = await createTestDatabase();
  t.after(close);
  useDatabase(db);
  const { getAISettings, saveAISettings } = await import("../src/actions/settings.ts");
  const { retrieveContext } = await import("../src/actions/chat.ts");
  await saveAISettings({ chat: config("test"), embedding: config("test") }, await getAISettings());
  let current = "Postgres";
  t.mock.method(globalThis, "fetch", async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
    if (String(url).startsWith("https://source.invalid/")) {
      return new Response(`<html><title>Database plan</title><article><p>Our database is ${current}. Shared is retained elsewhere.</p></article></html>`);
    }
    const body = JSON.parse(String(init?.body));
    if (String(url).endsWith("/embeddings")) {
      return Response.json({ data: (Array.isArray(body.input) ? body.input : [body.input]).map((_: string, index: number) => ({ index, embedding: [1, 0] })) });
    }
    const system = body.messages[0].content;
    return completion(system.includes("reusable tags") ? '{"tags": []}' : system.includes("extracting structured knowledge")
      ? JSON.stringify({ entities: [current, "Shared"].map(name => ({ name, type: "technology", description: `${name} is selected.` })), relationships: [{ source: current, target: "Shared", type: "uses", description: null }] })
      : `We use ${current}.`);
  });
  const service = createDocumentIngestionService({ database: db, revalidatePath() {} });
  const first = await service.ingestUrlDocument("https://source.invalid/first");
  current = "Retained";
  await service.ingestUrlDocument("https://source.invalid/second");
  const [unrelated] = await db.insert(entities).values({ name: "Unrelated orphan", type: "concept" }).returning();
  const oldEntity = (await db.select().from(entities)).find(entity => entity.name === "Postgres");
  assert.ok(oldEntity);
  const [thread] = await db.insert(chatThreads).values({ entityId: oldEntity.id, title: "History" }).returning();
  const [message] = await db.insert(chatMessages).values({ threadId: thread.id, role: "assistant", content: "Historical chat" }).returning();
  const priorEntities = await db.select().from(entities);
  const priorMentions = await db.select().from(entityMentions);
  const priorRelationships = await db.select().from(relationships);
  const priorChunks = await db.select().from(chunks);
  await db.execute(sql`CREATE FUNCTION reject_entity_cleanup() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'cleanup failure'; END; $$ LANGUAGE plpgsql`);
  await db.execute(sql`CREATE TRIGGER reject_cleanup BEFORE DELETE ON entities FOR EACH ROW EXECUTE FUNCTION reject_entity_cleanup()`);
  current = "MongoDB";
  await assert.rejects(service.refreshDocument(first.documentId));
  assert.deepEqual(await db.select().from(entities), priorEntities);
  assert.deepEqual(await db.select().from(entityMentions), priorMentions);
  assert.deepEqual(await db.select().from(relationships), priorRelationships);
  assert.deepEqual(await db.select().from(chunks), priorChunks);
  assert.deepEqual(await db.select().from(chatMessages), [message]);
  await db.execute(sql`DROP TRIGGER reject_cleanup ON entities`);
  await service.refreshDocument(first.documentId);
  const remaining = await db.select().from(entities);
  assert.equal(remaining.some(entity => entity.id === oldEntity.id), false);
  assert.ok(remaining.some(entity => entity.name === "Shared"));
  assert.ok(remaining.some(entity => entity.id === unrelated.id));
  assert.deepEqual(await db.select().from(chatMessages), [message]);
  assert.equal((await db.select().from(chatThreads))[0].entityId, null);
  assert.equal((await retrieveContext("Postgres")).entities.some(entity => entity.id === oldEntity.id), false);
  assert.equal((await db.select().from(documents)).length, 2);
});
