import assert from "node:assert/strict";
import test from "node:test";
import { useDatabase } from "./helpers/server.ts";
import { createTestDatabase } from "./helpers/db.ts";

process.env.CHAT_BASE_URL = "http://provider.invalid/v1";
process.env.CHAT_MODEL = "local-model";

const { getModel, generateTags, extractEntitiesAndRelationships } = await import("../src/lib/ai/client.ts");
const localConfig = {
  provider: "local" as const,
  baseUrl: "http://provider.invalid/v1",
  model: "local-model",
};

test("local generation uses Chat Completions and OpenAI keeps Responses", () => {
  assert.equal(getModel(localConfig).provider, "openai.chat");
  assert.equal(getModel({ ...localConfig, provider: "openai" }).provider, "openai.responses");
});

test("entity extraction failure reaches the caller instead of an empty success", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response(
    JSON.stringify({ error: { message: "Extraction rejected", type: "invalid_request_error" } }),
    { status: 400, headers: { "Content-Type": "application/json" } }
  ));
  await assert.rejects(extractEntitiesAndRelationships("Document text", localConfig), /Extraction rejected/);
});

test("tag generation failure reaches the caller instead of removing existing tags", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response(
    JSON.stringify({ error: { message: "Tags rejected", type: "invalid_request_error" } }),
    { status: 400, headers: { "Content-Type": "application/json" } }
  ));
  await assert.rejects(generateTags({ content: "Document text" }, localConfig), /Tags rejected/);
});

test("an empty settings database uses environment provider defaults", async (t) => {
  const { db, close } = await createTestDatabase();
  t.after(close);
  useDatabase(db);
  const { getAISettings } = await import("../src/actions/settings.ts");
  const settings = await getAISettings();
  assert.equal(settings.chat.baseUrl, process.env.CHAT_BASE_URL);
  assert.equal(settings.chat.model, process.env.CHAT_MODEL);
});

test("entity web research requires the provider search tool and limits output", async (t) => {
  const { db, close } = await createTestDatabase();
  t.after(close);
  useDatabase(db);
  const { saveAISettings } = await import("../src/actions/settings.ts");
  await saveAISettings({
    chat: { ...localConfig, provider: "openai", apiKey: "audit-key" },
    embedding: localConfig,
  });
  let request: Record<string, unknown> | undefined;
  t.mock.method(globalThis, "fetch", async (_url: Parameters<typeof fetch>[0], init: RequestInit) => {
    request = JSON.parse(String(init.body));
    return new Response(JSON.stringify({ error: { message: "Audit response", type: "invalid_request_error" } }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  });
  const { aiWebSearchForEntity } = await import("../src/actions/websearch.ts");
  await assert.rejects(aiWebSearchForEntity({ entityName: "Postgres" }), /Audit response/);
  assert.deepEqual(request?.tools, [{ type: "web_search" }]);
  assert.deepEqual(request?.tool_choice, { type: "web_search" });
  assert.equal(request?.max_output_tokens, 800);
});
