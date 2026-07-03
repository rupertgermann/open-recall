import assert from "node:assert/strict";
import test from "node:test";

import {
  estimateTokens,
  generateContentHash,
  normalizeText,
  normalizeTextForHash,
} from "../src/lib/text/index.ts";
import { chunkStructured } from "../src/lib/embedding/chunker.ts";

test("normalizeText trims, collapses whitespace, and is idempotent", () => {
  const input = " \n Alpha\t\tBeta   Gamma \r\n ";
  const normalized = normalizeText(input);

  assert.equal(normalized, "Alpha Beta Gamma");
  assert.equal(normalizeText(normalized), normalized);
});

test("normalizeTextForHash uses the shared whitespace normalizer before lowercasing", () => {
  assert.equal(normalizeTextForHash("  Alpha\tBeta  "), "alpha beta");
});

test("estimateTokens uses normalized text length and preserves basic invariants", () => {
  assert.equal(estimateTokens(""), 0);
  assert.equal(estimateTokens(" \n\t "), 0);
  assert.equal(estimateTokens("abcd"), 1);
  assert.equal(estimateTokens("abcde"), 2);
  assert.equal(estimateTokens("Alpha     Beta"), estimateTokens("Alpha Beta"));
  assert.ok(estimateTokens("Alpha Beta Gamma") >= estimateTokens("Alpha Beta"));
});

test("chunkStructured produces stable hashes for normalized-equivalent input", () => {
  const first = chunkStructured("  Alpha\tBeta\n\nGamma  ");
  const second = chunkStructured("Alpha Beta Gamma");

  assert.deepEqual(
    first.map((chunk) => ({ content: chunk.content, contentHash: chunk.contentHash })),
    second.map((chunk) => ({ content: chunk.content, contentHash: chunk.contentHash }))
  );
  assert.equal(first[0].contentHash, generateContentHash("Alpha Beta Gamma"));
});
