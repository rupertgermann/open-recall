import assert from "node:assert/strict";
import test from "node:test";

import { getAIErrorMessage } from "../src/lib/ai/errors.ts";

test("normalizes OpenAI authentication failures", () => {
  assert.equal(
    getAIErrorMessage({ statusCode: 401, message: "Unauthorized" }),
    "OpenAI rejected the API key. Validate or update it in Settings, then try again."
  );

  assert.equal(
    getAIErrorMessage(new Error("Incorrect API key provided: sk-test")),
    "OpenAI rejected the API key. Validate or update it in Settings, then try again."
  );
});

test("normalizes missing API key failures", () => {
  assert.equal(
    getAIErrorMessage(new Error("No auth credentials found")),
    "OpenAI API key is missing. Add one in Settings, then try again."
  );

  assert.equal(
    getAIErrorMessage({ statusCode: 401, message: "You didn't provide an API key." }),
    "OpenAI API key is missing. Add one in Settings, then try again."
  );
});

test("normalizes provider and model failures", () => {
  assert.equal(
    getAIErrorMessage({ statusCode: 404, message: "model_not_found" }),
    "The selected AI model is unavailable. Choose a different model in Settings, then try again."
  );

  assert.equal(
    getAIErrorMessage(new Error("fetch failed: ECONNREFUSED")),
    "The AI provider could not be reached. Check the provider URL and network connection in Settings."
  );
});

test("keeps useful non-provider messages", () => {
  assert.equal(getAIErrorMessage(new Error("Document not found")), "Document not found");
});
