import assert from "node:assert/strict";
import test from "node:test";
import { chunks, documents, entityMentions } from "../src/db/schema.ts";
import { createTestDatabase } from "./helpers/db.ts";
import { useDatabase } from "./helpers/server.ts";
import { chatStream, embeddings, ingestionCompletion } from "./helpers/provider.ts";

test("the chat createNote tool completes ingestion before reporting success", async (t) => {
  const { db, close } = await createTestDatabase();
  t.after(close);
  useDatabase(db);
  const { saveAISettings, getAISettings } = await import("../src/actions/settings.ts");
  const config = { provider: "local" as const, baseUrl: "http://provider.invalid/v1", model: "test" };
  await saveAISettings({ chat: config, embedding: config }, await getAISettings());
  let streamCount = 0;
  t.mock.method(globalThis, "fetch", async (url: Parameters<typeof fetch>[0], init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    if (String(url).endsWith("/embeddings")) return embeddings(body);
    assert.equal(String(url), `${config.baseUrl}/chat/completions`);
    if (!body.stream) return ingestionCompletion(body);
    streamCount += 1;
    return streamCount === 1 ? chatStream({ role: "assistant", tool_calls: [{
      index: 0, id: "save-note", type: "function", function: {
        name: "createNote", arguments: JSON.stringify({ title: "Remember Postgres", content: "Postgres stores my knowledge base." }),
      },
    }] }, "tool_calls") : chatStream({ role: "assistant", content: "Your note is saved." }, "stop");
  });
  const { POST } = await import("../src/app/api/chat/route.ts");
  const response = await POST(new Request("http://localhost/api/chat", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
      messages: [{ id: "message-1", role: "user", parts: [{ type: "text", text: "Remember Postgres" }] }],
    }),
  }));
  assert.equal(response.status, 200);
  const output = await response.text();
  assert.match(output, /saved and added to the knowledge base/);
  const [document] = await db.select().from(documents);
  assert.equal(document.title, "Remember Postgres");
  assert.equal(document.processingStatus, "completed");
  assert.ok((await db.select().from(chunks)).length > 0);
  assert.ok((await db.select().from(entityMentions)).length > 0);
});
