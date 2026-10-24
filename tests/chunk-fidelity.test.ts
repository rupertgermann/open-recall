import assert from "node:assert/strict";
import test from "node:test";
import { eq } from "drizzle-orm";
import { chunks, embeddingCache } from "../src/db/schema.ts";
import { createDocumentIngestionService } from "../src/lib/ingestion/service.ts";
import { generateContentHash } from "../src/lib/text/index.ts";
import { createTestDatabase } from "./helpers/db.ts";
import { useDatabase } from "./helpers/server.ts";
import { embeddings, ingestionCompletion } from "./helpers/provider.ts";

test("default ingestion retains code, case-distinct Chunks and oversized headings", async (t) => {
  const { db, close } = await createTestDatabase();
  t.after(close);
  useDatabase(db);
  const { saveAISettings, getAISettings } = await import("../src/actions/settings.ts");
  const config = { provider: "local", baseUrl: "http://provider.invalid/v1", model: "test" } satisfies Parameters<typeof saveAISettings>[0]["embedding"];
  await saveAISettings({ chat: config, embedding: config }, await getAISettings());
  t.mock.method(globalThis, "fetch", async (url: Parameters<typeof fetch>[0], init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    return String(url).endsWith("/embeddings") ? embeddings(body) : ingestionCompletion(body);
  });
  const service = createDocumentIngestionService({ database: db, revalidatePath: () => {} });

  await t.test("code remains intact in stored Chunks and retrieved prompt context", async () => {
    const content = "def f():\n    if ready:\n        run()\n    cleanup()";
    const doc = await service.ingestTextDocument({ title: "Python", content });
    const saved = await db.select().from(chunks).where(eq(chunks.documentId, doc.documentId));
    assert.equal(saved.length, 1);
    assert.equal(saved[0].content, content);
    const { retrieveContext, buildPromptContext } = await import("../src/actions/chat.ts");
    assert.ok((await buildPromptContext(await retrieveContext("Python"))).includes(content));
  });

  await t.test("case-distinct passages survive while exact duplicates dedupe per Document", async () => {
    const upper = "Reference API_KEY is case-sensitive. ".repeat(75).trim() + "\n\n";
    const lower = upper.toLowerCase();
    const content = upper + lower + upper;
    const first = await service.ingestTextDocument({ title: "References", content });
    const second = await service.ingestTextDocument({ title: "Other references", content });
    for (const doc of [first, second]) {
      const saved = await db.select().from(chunks).where(eq(chunks.documentId, doc.documentId));
      assert.equal(saved.length, 2);
      assert.deepEqual(new Set(saved.map(chunk => chunk.content)), new Set([upper, lower]));
      assert.equal(new Set(saved.map(chunk => chunk.contentHash)).size, 2);
    }
  });

  await t.test("large sections and headings retain every character within the budget", async () => {
    for (const heading of ["UNIQUE_HEADING_7", "LONG_HEADING_".repeat(300)]) {
      const content = `# ${heading}\n\n${"Detail sentence. ".repeat(240)}`;
      const doc = await service.ingestTextDocument({ title: "Long section", content });
      const saved = await db.select().from(chunks).where(eq(chunks.documentId, doc.documentId)).orderBy(chunks.chunkIndex);
      assert.equal(saved.map(chunk => chunk.content).join(""), content);
      assert.ok(saved.every(chunk => chunk.tokenCount !== null && chunk.tokenCount <= 800));
    }
  });
});

test("embedding caches separate exact text from case, formatting and legacy normalized keys", async (t) => {
  const { db, close } = await createTestDatabase();
  t.after(close);
  useDatabase(db);
  const { getOrCreateEmbedding, batchGetOrCreateEmbeddings } = await import("../src/lib/embedding/cache.ts");
  const lower = "api_key";
  await db.insert(embeddingCache).values({ contentHash: generateContentHash(lower), model: "test", embedding: [9, 0, 0], purpose: "retrieval" });
  let calls = 0;
  const generate = async () => [++calls, 0, 0];
  assert.deepEqual(await getOrCreateEmbedding(lower, "test", generate), { embedding: [1, 0, 0], cached: false });
  assert.deepEqual(await getOrCreateEmbedding("API_KEY", "test", generate), { embedding: [2, 0, 0], cached: false });
  assert.deepEqual(await getOrCreateEmbedding("api_key\n", "test", generate), { embedding: [3, 0, 0], cached: false });
  assert.deepEqual(await getOrCreateEmbedding(lower, "test", generate), { embedding: [1, 0, 0], cached: true });
  const cached = await batchGetOrCreateEmbeddings(["API_KEY", lower, "api_key\n", lower], "test", async () => {
    assert.fail("all exact texts have cached vectors");
  });
  assert.deepEqual(cached.embeddings, [[2, 0, 0], [1, 0, 0], [3, 0, 0], [1, 0, 0]]);
  assert.equal(cached.cacheHits, 4);
});
