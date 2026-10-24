import assert from "node:assert/strict";
import { test } from "node:test";
import { createTestDatabase } from "./helpers/db.ts";
import { useDatabase } from "./helpers/server.ts";
import type { AISettings } from "../src/actions/settings.ts";

const { getAISettings, saveAISettings } = await import("../src/actions/settings.ts");

test("Settings rejects a stale tab without overwriting an accepted provider change", async (t) => {
  const database = await createTestDatabase();
  useDatabase(database.db);
  t.after(() => database.close());
  const baseline = await getAISettings();
  const tabA: AISettings = { ...baseline, embedding: { ...baseline.embedding, model: "embedding-new" } };
  const tabB: AISettings = { ...baseline, chat: { ...baseline.chat, model: "chat-new" } };
  assert.equal(await saveAISettings(tabA, baseline), "saved");
  assert.equal(await saveAISettings(tabB, baseline), "conflict");
  assert.deepEqual(await getAISettings(), JSON.parse(JSON.stringify(tabA)));
});

test("Settings rejects different stale fields within the same provider group", async (t) => {
  const database = await createTestDatabase();
  useDatabase(database.db);
  t.after(() => database.close());
  const baseline = await getAISettings();
  const changed = { ...baseline, chat: { ...baseline.chat, model: "new-chat-model" } };
  assert.equal(await saveAISettings(changed, baseline), "saved");
  assert.equal(await saveAISettings({ ...baseline, chat: { ...baseline.chat, baseUrl: "http://other.invalid/v1" } }, baseline), "conflict");
  assert.deepEqual(await getAISettings(), JSON.parse(JSON.stringify(changed)));
});

test("Settings simultaneous first saves accept one baseline and reject the other", async (t) => {
  const database = await createTestDatabase();
  useDatabase(database.db);
  t.after(() => database.close());
  const baseline = await getAISettings();
  const first = { ...baseline, chat: { ...baseline.chat, model: "first" } };
  const second = { ...baseline, embedding: { ...baseline.embedding, model: "second" } };
  const results = await Promise.all([saveAISettings(first, baseline), saveAISettings(second, baseline)]);
  assert.deepEqual([...results].sort(), ["conflict", "saved"]);
  const expected = results[0] === "saved" ? first : second;
  assert.deepEqual(await getAISettings(), JSON.parse(JSON.stringify(expected)));
});

test("Settings compares canonical migrated legacy values and retains independent credentials", async (t) => {
  const database = await createTestDatabase();
  useDatabase(database.db);
  t.after(() => database.close());
  const { settings } = await import("../src/db/schema.ts");
  await database.db.insert(settings).values({
    key: "ai_config",
    value: { provider: "local", baseUrl: "http://legacy.invalid/v1", model: "legacy-chat", embeddingModel: "legacy-embedding" },
  });
  const baseline = await getAISettings();
  const edited: AISettings = {
    ...baseline,
    chat: { ...baseline.chat, apiKey: "chat-secret" },
    embedding: { ...baseline.embedding, apiKey: "embedding-secret" },
  };
  assert.equal(await saveAISettings(edited, JSON.parse(JSON.stringify(baseline))), "saved");
  const saved = await getAISettings();
  const reordered: AISettings = { embedding: saved.embedding, chat: saved.chat };
  assert.equal(await saveAISettings({ ...edited, chat: { ...edited.chat, model: "latest-chat" } }, reordered), "saved");
  const latest = await getAISettings();
  assert.equal(latest.chat.apiKey, "chat-secret");
  assert.equal(latest.embedding.apiKey, "embedding-secret");
  assert.equal(latest.embedding.model, "legacy-embedding");
});

test("Settings refuses an omitted expected baseline before writing", async (t) => {
  const database = await createTestDatabase();
  useDatabase(database.db);
  t.after(() => database.close());
  const baseline = await getAISettings();
  await assert.rejects(Reflect.apply(saveAISettings, undefined, [baseline]), /loaded settings are required/);
  const { settings } = await import("../src/db/schema.ts");
  assert.deepEqual(await database.db.select().from(settings), []);
});
