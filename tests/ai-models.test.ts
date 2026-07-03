import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_OPENAI_CHAT_MODEL,
  OPENAI_CHAT_MODELS,
  getOpenAIChatModelOptions,
  mergeModelOptions,
  normalizeOpenAIChatModel,
} from "../src/lib/ai/models.ts";

test("OpenAI chat settings expose the current documented frontier models", () => {
  assert.deepEqual([...OPENAI_CHAT_MODELS], [
    "gpt-5.5",
    "gpt-5.4",
    "gpt-5.4-mini",
    "gpt-5.4-nano",
  ]);
  assert.equal(DEFAULT_OPENAI_CHAT_MODEL, "gpt-5.5");
});

test("model option merging keeps configured and discovered models without duplicates", () => {
  assert.deepEqual(
    mergeModelOptions(OPENAI_CHAT_MODELS, ["gpt-5.4", "gpt-5.2"], "custom-model"),
    ["custom-model", "gpt-5.5", "gpt-5.4", "gpt-5.4-mini", "gpt-5.4-nano", "gpt-5.2"]
  );
});

test("OpenAI chat settings remove GPT-5.2 from configured and discovered options", () => {
  assert.equal(normalizeOpenAIChatModel("gpt-5.2"), "gpt-5.5");
  assert.deepEqual(
    getOpenAIChatModelOptions(["gpt-5.4", "gpt-5.2"], "gpt-5.2"),
    ["gpt-5.5", "gpt-5.4", "gpt-5.4-mini", "gpt-5.4-nano"]
  );
});
