import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout } from "node:timers/promises";
import { chatThreads, chatMessages, documents, chunks, entities } from "../src/db/schema.ts";
import { createTestDatabase } from "./helpers/db.ts";
import { useDatabase } from "./helpers/server.ts";
import { chatStream, embeddings } from "./helpers/provider.ts";

for (const cancellation of ["before text", "after partial text", "generation failure"]) {
  test(`chat completion persistence survives ${cancellation}`, async (t) => {
    const { db, close } = await createTestDatabase();
    t.after(close);
    useDatabase(db);
    const { saveAISettings, getAISettings } = await import("../src/actions/settings.ts");
    const config = { provider: "local", baseUrl: "http://provider.invalid/v1", model: "test" } as const;
    await saveAISettings({ chat: config, embedding: config }, await getAISettings());
    const [document] = await db.insert(documents).values({ title: "Knowledge", type: "note" }).returning();
    await db.insert(chunks).values({ documentId: document.id, content: "Knowledge context", chunkIndex: 0, embedding: [1, 0, 0] });
    const [entity] = await db.insert(entities).values({ name: "Knowledge", type: "concept", embedding: [1, 0, 0] }).returning();
    const [thread] = await db.insert(chatThreads).values({ title: "Saved discussion" }).returning();
    const release = Promise.withResolvers<void>();
    let providerCompleted = false;
    t.mock.method(globalThis, "fetch", async (url: Parameters<typeof fetch>[0], init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      if (String(url).endsWith("/embeddings")) return embeddings(body);
      return new Response(new ReadableStream({ async start(controller) {
        const emit = (content: string | null, finishReason: string | null = null) => controller.enqueue(new TextEncoder().encode(
          `data: ${JSON.stringify({ id: "test", model: "test", created: 0, choices: [{ index: 0, delta: { content }, finish_reason: finishReason }] })}\n\n`
        ));
        if (cancellation !== "before text") emit("First part. ");
        await release.promise;
        if (cancellation === "generation failure") controller.error(new Error("Generation interrupted"));
        else {
          emit(cancellation === "before text" ? "First part. Complete answer." : "Complete answer.");
          emit(null, "stop");
          controller.close();
        }
        providerCompleted = true;
      } }), { headers: { "Content-Type": "text/event-stream" } });
    });
    const { POST } = await import("../src/app/api/chat/route.ts");
    const response = await POST(new Request("http://localhost/api/chat", { method: "POST", body: JSON.stringify({
      threadId: thread.id, messages: [{ id: "user-1", role: "user", parts: [{ type: "text", text: "Hello" }] }],
    }) }));
    assert.ok(response.body);
    const reader = response.body.getReader();
    if (cancellation !== "before text") {
      let output = "";
      while (!output.includes("First part.")) {
        const { value, done } = await reader.read();
        assert.equal(done, false);
        output += new TextDecoder().decode(value);
      }
    }
    await reader.cancel();
    release.resolve();
    let rows = await db.select().from(chatMessages);
    for (let attempt = 0; attempt < 100 && (!providerCompleted || (cancellation !== "generation failure" && rows.length !== 2)); attempt++) {
      await setTimeout(10);
      rows = await db.select().from(chatMessages);
    }
    assert.equal(providerCompleted, true);
    if (cancellation === "generation failure") {
      await setTimeout(30);
      assert.deepEqual((await db.select().from(chatMessages)).map(row => row.role), ["user"]);
    } else {
      const { GET } = await import("../src/app/api/chats/[id]/route.ts");
      const reloaded = await GET(new Request(`http://localhost/api/chats/${thread.id}`), { params: Promise.resolve({ id: thread.id }) });
      const history = await reloaded.json();
      assert.deepEqual(history.messages.map(({ role, content }: { role: string; content: string }) => ({ role, content })), [
        { role: "user", content: "Hello" }, { role: "assistant", content: "First part. Complete answer." },
      ]);
      assert.ok(history.messages[1].metadata.createdAt);
      assert.deepEqual(history.messages[1].metadata.sources, [{ documentId: document.id, title: document.title, score: 1 }]);
      assert.deepEqual(history.messages[1].metadata.entities, [{ id: entity.id, name: entity.name, type: entity.type }]);
    }
  });
}

test("a later tool-step generation failure cannot persist a partial answer as completed", async (t) => {
  const { db, close } = await createTestDatabase();
  t.after(close);
  useDatabase(db);
  const { saveAISettings, getAISettings } = await import("../src/actions/settings.ts");
  const config = { provider: "local", baseUrl: "http://provider.invalid/v1", model: "test" } as const;
  await saveAISettings({ chat: config, embedding: config }, await getAISettings());
  const [thread] = await db.insert(chatThreads).values({ title: "Tool failure" }).returning();
  let requests = 0;
  t.mock.method(globalThis, "fetch", async (url: Parameters<typeof fetch>[0], init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    if (String(url).endsWith("/embeddings")) return embeddings(body);
    requests++;
    if (requests === 1) return chatStream({
      role: "assistant", content: "Let me look that up.",
      tool_calls: [{ index: 0, id: "lookup", type: "function",
        function: { name: "lookupEntity", arguments: JSON.stringify({ name: "Postgres" }) } }],
    }, "tool_calls");
    return Response.json({ error: { message: "Second step failed", type: "invalid_request_error" } }, { status: 400 });
  });
  const { POST } = await import("../src/app/api/chat/route.ts");
  const response = await POST(new Request("http://localhost/api/chat", {
    method: "POST", body: JSON.stringify({
      threadId: thread.id, messages: [{ id: "user-1", role: "user", parts: [{ type: "text", text: "Find Postgres" }] }],
    }),
  }));
  assert.match(await response.text(), /Second step failed/);
  assert.equal(requests, 2);
  assert.deepEqual((await db.select().from(chatMessages)).map(row => row.role), ["user"]);
});
