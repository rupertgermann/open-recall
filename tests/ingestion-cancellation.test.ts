import assert from "node:assert/strict";
import { setImmediate, setTimeout } from "node:timers/promises";
import test from "node:test";
import { eq } from "drizzle-orm";
import { chunks, documents } from "../src/db/schema.ts";
import { createTestDatabase } from "./helpers/db.ts";
import { useDatabase } from "./helpers/server.ts";
import { embeddings, ingestionCompletion } from "./helpers/provider.ts";

test("ingestion routes tolerate cancelled responses and preserve connected errors", async (t) => {
  const { db, close } = await createTestDatabase();
  t.after(close);
  useDatabase(db);
  const { saveAISettings } = await import("../src/actions/settings.ts");
  const config = { provider: "local" as const, baseUrl: "http://provider.invalid/v1", model: "test" };
  await saveAISettings({ chat: config, embedding: config });
  const ingest = await import("../src/app/api/ingest/route.ts");
  const update = await import("../src/app/api/update-document/route.ts");

  for (const route of [{ name: "ingest", POST: ingest.POST }, { name: "update-document", POST: update.POST }]) {
    for (const { cancelled, failed } of [
      { cancelled: true, failed: false },
      { cancelled: true, failed: true },
      { cancelled: false, failed: true },
    ]) {
      await t.test(`${route.name} ${failed ? "fails" : "completes"} ${cancelled ? "after cancellation" : "while connected"}`, { timeout: 15000 }, async (t) => {
        const title = `${route.name}-${cancelled}-${failed}`;
        const [seed] = route.name === "update-document"
          ? await db.insert(documents).values({ title, type: "article", url: "https://source.invalid/postgres", content: "Old content" }).returning()
          : [];
        const enteredProvider = Promise.withResolvers<void>();
        const releaseProvider = Promise.withResolvers<void>();
        t.after(() => releaseProvider.resolve());
        const controllerErrors: unknown[] = [];
        const originalEnqueue = ReadableStreamDefaultController.prototype.enqueue;
        const originalClose = ReadableStreamDefaultController.prototype.close;
        t.mock.method(ReadableStreamDefaultController.prototype, "enqueue", function (this: ReadableStreamDefaultController, chunk: unknown) {
          try { return originalEnqueue.call(this, chunk); }
          catch (error) { controllerErrors.push(error); throw error; }
        });
        t.mock.method(ReadableStreamDefaultController.prototype, "close", function (this: ReadableStreamDefaultController) {
          try { return originalClose.call(this); }
          catch (error) { controllerErrors.push(error); throw error; }
        });
        t.mock.method(globalThis, "fetch", async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
          if (String(url) === "https://source.invalid/postgres") {
            return new Response("<html><title>Postgres</title><article><p>Postgres stores the updated knowledge base.</p></article></html>");
          }
          assert.ok(String(url).startsWith(config.baseUrl));
          enteredProvider.resolve();
          await releaseProvider.promise;
          const body = JSON.parse(String(init?.body));
          if (String(url).endsWith("/embeddings")) return embeddings(body);
          if (failed) return Response.json({ error: { message: "Generation failed", type: "invalid_request_error" } }, { status: 400 });
          return ingestionCompletion(body);
        });
        const response = await route.POST(new Request(`http://localhost/api/${route.name}`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(seed ? { documentId: seed.id } : { type: "text", title, content: "Postgres stores my knowledge base." }),
        }));
        await enteredProvider.promise;
        assert.ok(response.body);
        if (cancelled) await response.body.cancel();
        releaseProvider.resolve();
        if (!cancelled) {
          const output = await response.text();
          assert.match(output, /"step":"error"/);
          assert.match(output, /Generation failed/);
          assert.doesNotMatch(output, /"step":"done"/);
        }
        const documentId = seed?.id ?? (await db.select().from(documents).where(eq(documents.title, title)))[0].id;
        const deadline = Date.now() + 5000;
        let document;
        do {
          [document] = await db.select().from(documents).where(eq(documents.id, documentId));
          if (document.processingStatus !== "processing") break;
          await setTimeout(10);
        } while (Date.now() < deadline);
        await setImmediate();
        assert.equal(document.processingStatus, failed ? "failed" : "completed");
        if (!failed) assert.ok((await db.select().from(chunks).where(eq(chunks.documentId, documentId))).length > 0);
        assert.deepEqual(controllerErrors, []);
      });
    }
  }
});
