import assert from "node:assert/strict";
import test from "node:test";
import { chunks, documents, embeddingCache, entities } from "../src/db/schema.ts";
import { createDocumentIngestionService } from "../src/lib/ingestion/service.ts";
import { createTestDatabase } from "./helpers/db.ts";
import { useDatabase } from "./helpers/server.ts";
import { ingestionCompletion } from "./helpers/provider.ts";

test("ingestion keeps its embedding config through Settings changes, cache reuse and Source Refresh", async (t) => {
  const { db, close } = await createTestDatabase();
  t.after(close);
  useDatabase(db);
  const { saveAISettings, getAISettings } = await import("../src/actions/settings.ts");
  const oldConfig = { provider: "local" as const, baseUrl: "http://old.invalid/v1", model: "old", apiKey: "old-key" };
  const newConfig = { provider: "local" as const, baseUrl: "http://new.invalid/v1", model: "new", apiKey: "new-key" };
  await saveAISettings({ chat: oldConfig, embedding: oldConfig }, await getAISettings());
  const requests: { url: string; model: string; authorization: string | null }[] = [];
  t.mock.method(globalThis, "fetch", async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
    if (String(url) === "https://source.invalid/article") {
      return new Response("<html><title>Postgres</title><article><p>Postgres is a database with useful documents.</p></article></html>");
    }
    const body = JSON.parse(String(init?.body));
    if (String(url).endsWith("/embeddings")) {
      requests.push({ url: String(url), model: body.model, authorization: new Headers(init?.headers).get("authorization") });
      return Response.json({
        data: (Array.isArray(body.input) ? body.input : [body.input]).map((_: unknown, index: number) => ({
          index, embedding: body.model === "old" ? [1, 0, 0] : [0, 1],
        })),
        usage: { prompt_tokens: 1, total_tokens: 1 },
      });
    }
    return ingestionCompletion(body);
  });
  const service = createDocumentIngestionService({ database: db, revalidatePath: () => {} });
  await service.ingestUrlDocument("https://source.invalid/article", {
    onEvent: async (event) => {
      if (event.step === "summarizing" && event.progress === 35) {
        await saveAISettings({ chat: oldConfig, embedding: newConfig }, await getAISettings());
      }
    },
  });
  const [document] = await db.select().from(documents);
  assert.equal(document.embeddingModel, "old");
  assert.deepEqual(requests, Array(2).fill({ url: "http://old.invalid/v1/embeddings", model: "old", authorization: "Bearer old-key" }));
  assert.deepEqual((await db.select().from(chunks))[0].embedding, [1, 0, 0]);
  assert.deepEqual((await db.select().from(entities))[0].embedding, [1, 0, 0]);
  assert.deepEqual((await db.select().from(embeddingCache)).map(row => row.model), ["old", "old"]);

  await saveAISettings({ chat: oldConfig, embedding: oldConfig }, await getAISettings());
  assert.equal((await service.refreshDocument(document.id)).skipped, true);
  const { retrieveContext } = await import("../src/actions/chat.ts");
  await retrieveContext("Postgres");
  const requestCount = requests.length;
  await service.ingestUrlDocument("https://source.invalid/article");
  assert.equal(requests.length, requestCount, "the captured model reuses its cached Chunk embedding");

  await saveAISettings({ chat: oldConfig, embedding: newConfig }, await getAISettings());
  assert.equal((await service.refreshDocument(document.id)).skipped, false);
  assert.equal((await db.select().from(documents)).find(row => row.id === document.id)?.embeddingModel, "new");
  assert.deepEqual((await db.select().from(chunks)).find(row => row.documentId === document.id)?.embedding, [0, 1]);
  assert.deepEqual((await db.select().from(entities))[0].embedding, [0, 1]);
  for (const other of await db.select().from(documents)) {
    await service.refreshDocument(other.id);
  }
  assert.ok((await retrieveContext("Postgres")).entities.length > 0);
});
