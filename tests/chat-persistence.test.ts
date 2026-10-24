import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import { chatThreads, chunks, documents, entities } from "../src/db/schema.ts";
import { createTestDatabase } from "./helpers/db.ts";
import { useDatabase } from "./helpers/server.ts";
import { chatStream, embeddings } from "./helpers/provider.ts";

const historySchema = z.object({
  messages: z.array(z.object({
    role: z.string(),
    content: z.string(),
    metadata: z.object({
      sources: z.array(z.object({ documentId: z.string(), title: z.string(), score: z.number() })),
      entities: z.array(z.object({ id: z.string(), name: z.string(), type: z.string() })),
      createdAt: z.number(),
    }).nullable(),
  })),
});

for (const useTool of [true, false]) {
  test(`chat reload preserves ${useTool ? "text before and after a tool call" : "a single answer once"} with citation metadata`, async (t) => {
    const { db, close } = await createTestDatabase();
    t.after(close);
    useDatabase(db);
    const { saveAISettings } = await import("../src/actions/settings.ts");
    const config = { provider: "local", baseUrl: "http://provider.invalid/v1", model: "test" } as const;
    await saveAISettings({ chat: config, embedding: config });
    const [document] = await db.insert(documents).values({ title: "Postgres notes", type: "note" }).returning();
    await db.insert(chunks).values({ documentId: document.id, content: "Postgres stores knowledge.", chunkIndex: 0, embedding: [1, 0, 0] });
    const [entity] = await db.insert(entities).values({ name: "Postgres", type: "technology", embedding: [1, 0, 0] }).returning();
    const [thread] = await db.insert(chatThreads).values({ title: "Postgres discussion" }).returning();
    let streamCount = 0;
    t.mock.method(globalThis, "fetch", async (url: Parameters<typeof fetch>[0], init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      if (String(url).endsWith("/embeddings")) return embeddings(body);
      assert.equal(String(url), `${config.baseUrl}/chat/completions`);
      streamCount += 1;
      return useTool && streamCount === 1 ? chatStream({ role: "assistant", content: "Let me look that up.", tool_calls: [{
        index: 0, id: "lookup", type: "function", function: {
          name: "lookupEntity", arguments: JSON.stringify({ name: "Postgres" }),
        },
      }] }, "tool_calls") : chatStream({ role: "assistant", content: "Here is the final answer." }, "stop");
    });
    const { POST } = await import("../src/app/api/chat/route.ts");
    const response = await POST(new Request("http://localhost/api/chat", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        threadId: thread.id,
        messages: [{ id: "message-1", role: "user", parts: [{ type: "text", text: "Find Postgres" }] }],
      }),
    }));
    assert.equal(response.status, 200);
    const output = await response.text();
    assert.match(output, /Here is the final answer\./);
    if (useTool) {
      assert.match(output, /Let me look that up\./);
      assert.match(output, /lookupEntity/);
      assert.match(output, /tool-output-available/);
    }
    const { GET } = await import("../src/app/api/chats/[id]/route.ts");
    const reloaded = await GET(new Request(`http://localhost/api/chats/${thread.id}`), { params: Promise.resolve({ id: thread.id }) });
    assert.equal(reloaded.status, 200);
    const { messages } = historySchema.parse(await reloaded.json());
    assert.deepEqual(messages.map(({ role, content }) => ({ role, content })), [
      { role: "user", content: "Find Postgres" },
      { role: "assistant", content: useTool ? "Let me look that up.Here is the final answer." : "Here is the final answer." },
    ]);
    assert.deepEqual(messages[1].metadata?.sources, [{ documentId: document.id, title: document.title, score: 1 }]);
    assert.deepEqual(messages[1].metadata?.entities, [{ id: entity.id, name: entity.name, type: entity.type }]);
    assert.ok(messages[1].metadata?.createdAt);
    assert.equal(streamCount, useTool ? 2 : 1);
  });
}

for (const scenario of [
  { name: "document scope includes its fourth-ranked relevant Document", category: "document", betterMatches: 3, embedding: [0.6, 0.8, 0], includesTarget: true },
  { name: "general scope keeps the three best results", category: "general", betterMatches: 3, embedding: [0.6, 0.8, 0], includesTarget: false },
  { name: "entity scope keeps the three best results and its Entity", category: "entity", betterMatches: 3, embedding: [0.6, 0.8, 0], includesTarget: false },
  { name: "document scope excludes its Document below the relevance threshold", category: "document", betterMatches: 3, embedding: [0, 1, 0], includesTarget: false },
  { name: "document scope keeps the existing nine-candidate limit", category: "document", betterMatches: 9, embedding: [0.6, 0.8, 0], includesTarget: false },
]) {
  test(`chat model context ${scenario.name}`, async (t) => {
    const { db, close } = await createTestDatabase();
    t.after(close);
    useDatabase(db);
    const { saveAISettings } = await import("../src/actions/settings.ts");
    const config = { provider: "local", baseUrl: "http://provider.invalid/v1", model: "test" } as const;
    await saveAISettings({ chat: config, embedding: config });
    const [target, ...others] = await db.insert(documents).values([
      { title: "Target report", type: "note" },
      ...Array.from({ length: scenario.betterMatches }, (_, index) => ({ title: `Other ${index}`, type: "note" })),
    ]).returning();
    await db.insert(chunks).values([
      { documentId: target.id, content: "TARGET_DOCUMENT_ONLY", chunkIndex: 0, embedding: scenario.embedding },
      ...others.map((document) => ({ documentId: document.id, content: "OTHER_DOCUMENT_ONLY", chunkIndex: 0, embedding: [1, 0, 0] })),
    ]);
    const [entity] = await db.insert(entities).values({ name: "Postgres", type: "technology", description: "Database" }).returning();
    const [thread] = await db.insert(chatThreads).values({
      title: "Context discussion", category: scenario.category,
      documentId: scenario.category === "document" ? target.id : null,
      entityId: scenario.category === "entity" ? entity.id : null,
    }).returning();
    let systemPrompt = "";
    t.mock.method(globalThis, "fetch", async (url: Parameters<typeof fetch>[0], init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      if (String(url).endsWith("/embeddings")) return embeddings(body);
      assert.equal(String(url), `${config.baseUrl}/chat/completions`);
      systemPrompt = z.object({ messages: z.array(z.object({ content: z.string() })) }).parse(body).messages[0].content;
      return chatStream({ role: "assistant", content: "Here is the answer." }, "stop");
    });
    const { POST } = await import("../src/app/api/chat/route.ts");
    const response = await POST(new Request("http://localhost/api/chat", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        threadId: thread.id,
        messages: [{ id: "message-1", role: "user", parts: [{ type: "text", text: "What does this say?" }] }],
      }),
    }));
    assert.equal(response.status, 200);
    await response.text();
    assert.equal(systemPrompt.includes("TARGET_DOCUMENT_ONLY"), scenario.includesTarget);
    assert.equal(systemPrompt.match(/### From /g)?.length, 3);
    assert.equal(systemPrompt.includes("Postgres"), scenario.category === "entity");
    if (scenario.includesTarget) {
      assert.ok(systemPrompt.indexOf("TARGET_DOCUMENT_ONLY") < systemPrompt.indexOf("OTHER_DOCUMENT_ONLY"));
    }
  });
}
