import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import test from "node:test";
import { chunks, documents, documentTags, entityMentions, relationships } from "../src/db/schema.ts";
import { createDocumentIngestionService } from "../src/lib/ingestion/service.ts";
import { persistDerivedDocumentData } from "../src/lib/ingestion/persistence.ts";
import { createTestDatabase } from "./helpers/db.ts";
import { useDatabase } from "./helpers/server.ts";
import { embeddings, ingestionCompletion } from "./helpers/provider.ts";

for (const stage of ["tags", "entities"]) {
  test(`failed ${stage} generation preserves Derived Document Data and permits retry`, async (t) => {
    const { db, close } = await createTestDatabase();
    t.after(close);
    useDatabase(db);
    const { saveAISettings, getAISettings } = await import("../src/actions/settings.ts");
    const config = { provider: "local" as const, baseUrl: "http://provider.invalid/v1", model: "test" };
    await saveAISettings({ chat: config, embedding: config }, await getAISettings());
    const [doc] = await db.insert(documents).values({ title: "Postgres", type: "note" }).returning();
    await persistDerivedDocumentData(db, {
      documentId: doc.id, replaceExisting: false,
      source: { title: "Postgres", content: "Original Postgres text", type: "note", url: "https://drive.google.com/file/d/doc-1/view" },
      derived: {
        contentHash: "original", embeddingModel: "test", summary: "Original summary", tags: ["original"],
        chunks: [{ content: "Postgres uses SQL", contentHash: "original-chunk", index: 0, tokenCount: 4 }],
        chunkEmbeddings: [[1, 0, 0]], entityEmbeddingsByKey: new Map(),
        entities: [{ name: "Postgres", type: "technology", description: null }, { name: "SQL", type: "technology", description: null }],
        relationships: [{ source: "Postgres", target: "SQL", type: "uses", description: null }],
      },
    });
    const before = {
      chunks: await db.select().from(chunks), tags: await db.select().from(documentTags),
      mentions: await db.select().from(entityMentions), relationships: await db.select().from(relationships),
    };
    let failing = true;
    t.mock.method(globalThis, "fetch", async (url: Parameters<typeof fetch>[0], init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      if (String(url).endsWith("/embeddings")) return embeddings(body);
      const system: string = body.messages[0].content;
      if (failing && system.includes(stage === "tags" ? "reusable tags" : "extracting structured knowledge")) {
        return Response.json({ error: { message: "Generation failed", type: "invalid_request_error" } }, { status: 400 });
      }
      return ingestionCompletion(body);
    });
    const service = createDocumentIngestionService({ database: db, revalidatePath: () => {} });
    const options = { driveRunner: async (args: string[]) => {
      if (args[1] === "get") return { id: "doc-1", name: "Postgres", mimeType: "text/plain" };
      await writeFile(args[args.indexOf("--out") + 1], "Postgres updated content.");
      return {};
    } };
    await assert.rejects(service.refreshDocument(doc.id, options), /Generation failed/);
    assert.deepEqual(await db.select().from(chunks), before.chunks);
    assert.deepEqual(await db.select().from(documentTags), before.tags);
    assert.deepEqual(await db.select().from(entityMentions), before.mentions);
    assert.deepEqual(await db.select().from(relationships), before.relationships);
    assert.equal((await db.select().from(documents))[0].contentHash, "original");
    failing = false;
    const result = await service.refreshDocument(doc.id, options);
    assert.equal(result.action, "refreshed");
    assert.equal((await db.select().from(documents))[0].processingStatus, "completed");
  });
}
