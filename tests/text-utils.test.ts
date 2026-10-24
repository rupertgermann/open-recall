import assert from "node:assert/strict";
import test from "node:test";

import {
  estimateTokens,
  generateContentHash,
  generateExactContentHash,
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

test("Chunks use exact text identities while Document hashes keep their normalized contract", () => {
  const inputs = ["  Alpha\tBeta\n\nGamma  ", "Alpha Beta Gamma", "alpha beta gamma"];
  const chunks = inputs.map(input => chunkStructured(input)[0]);

  assert.deepEqual(chunks.map(chunk => chunk.content), inputs);
  assert.equal(new Set(chunks.map(chunk => chunk.contentHash)).size, inputs.length);
  assert.deepEqual(chunks.map(chunk => chunk.contentHash), inputs.map(generateExactContentHash));
  assert.equal(new Set(inputs.map(generateContentHash)).size, 1);
});

test("chunkStructured bounds chunk size even without sentence punctuation", () => {
  // Simulates Drive files like logs or CSV exports: one huge block with no
  // sentence-ending punctuation and no paragraph breaks.
  const word = "alphabeta";
  const text = Array.from({ length: 2000 }, () => word).join(" ");
  const maxChunkTokens = 800;

  const chunks = chunkStructured(text, {
    minChunkTokens: 100,
    maxChunkTokens,
    targetChunkTokens: 500,
  });

  assert.ok(chunks.length > 1);
  for (const chunk of chunks) {
    assert.ok(
      chunk.tokenCount <= maxChunkTokens,
      `chunk ${chunk.index} has ${chunk.tokenCount} tokens, exceeds ${maxChunkTokens}`
    );
  }
  // No content lost
  assert.equal(chunks.map((c) => c.content).join(""), text);
});

test("all split paths retain code whitespace and obey the maximum even after a short slice", () => {
  for (const text of [
    "# Heading\n\n" + "    if ready:\n        run()\n    cleanup()\n".repeat(60),
    "# Heading\n\n" + "    print('done. ')\n        cleanup()\t# next!\n".repeat(60),
    "## Empty section\n\n## Next\n\n    Indented body.\n",
    "## " + "H".repeat(600) + "\n\nShort body.",
    "Tiny.\n\n" + "A".repeat(400),
  ]) {
    const chunks = chunkStructured(text, { maxChunkTokens: 100, minChunkTokens: 50 });
    assert.equal(chunks.map(chunk => chunk.content).join(""), text);
    assert.ok(chunks.every(chunk => chunk.tokenCount <= 100));
  }
  assert.deepEqual(chunkStructured("\n \t"), []);
});

test("chunkStructured bounds chunk size for one unbroken character run", () => {
  // Simulates a base64 blob or minified file: no whitespace at all.
  const text = "a".repeat(40_000);
  const maxChunkTokens = 800;

  const chunks = chunkStructured(text, {
    minChunkTokens: 100,
    maxChunkTokens,
    targetChunkTokens: 500,
  });

  assert.ok(chunks.length > 1);
  for (const chunk of chunks) {
    assert.ok(
      chunk.tokenCount <= maxChunkTokens,
      `chunk ${chunk.index} has ${chunk.tokenCount} tokens, exceeds ${maxChunkTokens}`
    );
  }
  assert.equal(chunks.map((c) => c.content).join(""), text);
});
