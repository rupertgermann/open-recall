import assert from "node:assert/strict";
import { test } from "node:test";
import { createTestDatabase } from "./helpers/db.ts";
import { useDatabase } from "./helpers/server.ts";
import { act, createElement, loadUi, renderUi, uiOverrides } from "./helpers/ui.ts";
import type { AISettings } from "../src/actions/settings.ts";

const actions = await import("../src/actions/settings.ts");
export const settingsActions = {
  get: actions.getAISettings,
  save: actions.saveAISettings,
  test: actions.testAIConnection,
};
loadUi({
  ...uiOverrides,
  "@/actions/settings": `
    import {settingsActions} from ${JSON.stringify(import.meta.url)};
    export const getAISettings = () => settingsActions.get();
    export const saveAISettings = (value) => settingsActions.save(value);
    export const getDatabaseStats = async () => ({documents: 0, entities: 0, relationships: 0});
    export const testAIConnection = (...args) => settingsActions.test(...args);
    export const validateOpenAIApiKey = async () => ({success: true});
  `,
});
const config: AISettings = {
  openaiApiKey: "shared-openai-key",
  chat: { provider: "openai", baseUrl: "https://api.openai.com/v1", model: "gpt-6" },
  embedding: { provider: "local", baseUrl: "http://embedding.invalid/v1", model: "embedding", apiKey: "embedding-key" },
};

test("Settings loading stays read-only and rapid edits save only the latest configuration", async (t) => {
  const { default: SettingsPage } = await import("../src/app/settings/page.tsx");
  const db = await createTestDatabase();
  useDatabase(db.db);
  t.after(() => db.close());
  await actions.saveAISettings(config);
  t.mock.method(globalThis, "fetch", async () => Response.json({ state: "not_installed", installInstructions: "Install gogcli" }));
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const tick = async (ms: number) => act(async () => t.mock.timers.tick(ms));
  const loaded = Promise.withResolvers<AISettings>();
  settingsActions.get = () => loaded.promise;
  const saves: AISettings[] = [];
  settingsActions.save = async (value) => { saves.push(value); await actions.saveAISettings(value); };
  const ui = await renderUi(createElement(SettingsPage));
  t.after(() => ui.close());
  await tick(1200);
  assert.equal(saves.length, 0, "pending load must not save defaults");
  await act(async () => loaded.resolve(await actions.getAISettings()));
  await tick(1200);
  assert.equal(saves.length, 0, "opening Settings must not save");
  assert.equal(ui.document.querySelector<HTMLInputElement>("#openai-secret-token")?.value, config.openaiApiKey);
  await ui.change('input[placeholder="http://localhost:11434/v1"]', "http://first.invalid/v1");
  await tick(500);
  await ui.change('input[placeholder="http://localhost:11434/v1"]', "http://latest.invalid/v1");
  await tick(600);
  assert.equal(saves.length, 0);
  await tick(400);
  assert.equal(saves.length, 1);
  assert.deepEqual(await actions.getAISettings(), { ...config, chat: { ...config.chat, reasoningEffort: "medium", verbosity: "medium", webSearchEnabled: false }, embedding: { ...config.embedding, baseUrl: "http://latest.invalid/v1" } });
  await ui.change('input[placeholder="http://localhost:11434/v1"]', "http://unmounted.invalid/v1");
  await ui.close();
  await tick(1200);
  assert.equal(saves.length, 1, "unmount cancels pending saves");
});

test("Settings preserves independent local credentials and unrelated provider fields", async (t) => {
  const { default: SettingsPage } = await import("../src/app/settings/page.tsx");
  const db = await createTestDatabase();
  useDatabase(db.db);
  t.after(() => db.close());
  const local: AISettings = {
    embedding: config.embedding,
    chat: { provider: "local", baseUrl: "http://chat.invalid/v1", model: "chat", apiKey: "chat-key", reasoningEffort: "high" },
  };
  await actions.saveAISettings(local);
  settingsActions.get = actions.getAISettings;
  settingsActions.save = actions.saveAISettings;
  t.mock.method(globalThis, "fetch", async () => Response.json({ state: "not_installed", installInstructions: "Install gogcli" }));
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const ui = await renderUi(createElement(SettingsPage));
  t.after(() => ui.close());
  await ui.change('input[placeholder="http://localhost:11434/v1"]', "http://changed.invalid/v1");
  await act(async () => t.mock.timers.tick(1000));
  assert.deepEqual(await actions.getAISettings(), { ...local, chat: { ...local.chat, baseUrl: "http://changed.invalid/v1" } });
  const connections: [string, string | undefined][] = [];
  settingsActions.test = async (url, key) => { connections.push([url, key]); return { success: true }; };
  for (let index = 0; index < 2; index++) {
    const buttons = Array.from(ui.document.querySelectorAll("button")).filter((button) => button.textContent === "");
    await act(async () => buttons[index].click());
  }
  assert.deepEqual(connections, [["http://changed.invalid/v1", "chat-key"], [local.embedding.baseUrl, "embedding-key"]]);

  const pendingSave = Promise.withResolvers<void>();
  const saves: AISettings[] = [];
  settingsActions.save = async (value) => {
    saves.push(value);
    await pendingSave.promise;
    await actions.saveAISettings(value);
  };
  await ui.change('input[placeholder="http://localhost:11434/v1"]', "http://saving.invalid/v1");
  await act(async () => t.mock.timers.tick(1000));
  assert.equal(saves.length, 1);
  await ui.change('input[placeholder="http://localhost:11434/v1"]', "http://queued.invalid/v1");
  await act(async () => t.mock.timers.tick(1000));
  assert.equal(saves.length, 1, "do not overlap configuration writes");
  await act(async () => pendingSave.resolve());
  await act(async () => t.mock.timers.tick(1000));
  assert.equal(saves.length, 2);
  assert.equal((await actions.getAISettings()).chat.baseUrl, "http://queued.invalid/v1");

  await ui.click("OpenAI");
  assert.equal(ui.document.querySelector<HTMLInputElement>("#openai-secret-token")?.value, "", "local credentials must not seed the shared OpenAI key");
});

test("Settings load failure never saves defaults", async (t) => {
  const { default: SettingsPage } = await import("../src/app/settings/page.tsx");
  const writes: AISettings[] = [];
  settingsActions.get = async () => { throw new Error("Load unavailable"); };
  settingsActions.save = async (value) => { writes.push(value); };
  t.mock.method(console, "error", () => {});
  t.mock.method(globalThis, "fetch", async () => Response.json({ state: "not_installed", installInstructions: "Install gogcli" }));
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const ui = await renderUi(createElement(SettingsPage));
  t.after(() => ui.close());
  await act(async () => t.mock.timers.tick(5000));
  assert.equal(writes.length, 0);
  assert.match(ui.document.body.textContent ?? "", /Failed to load settings/);
});
