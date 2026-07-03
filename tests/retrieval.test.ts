import assert from "node:assert/strict";
import test from "node:test";

import {
  buildEntityNameSearchTerms,
  distanceToSimilarity,
  filterByMinimumScore,
  mergeEntityMatches,
  mergeScoredResults,
  scoreEntityNameMatch,
  sortChunksByDocumentPriority,
} from "../src/lib/retrieval/index.ts";

test("distanceToSimilarity converts cosine distance into relevance score", () => {
  assert.equal(distanceToSimilarity(0), 1);
  assert.equal(distanceToSimilarity(0.25), 0.75);
  assert.equal(distanceToSimilarity(1.25), -0.25);
  assert.equal(distanceToSimilarity(null), 0);
});

test("mergeScoredResults deduplicates by id, keeps the best score, and caps results", () => {
  const results = mergeScoredResults(
    [
      [
        { id: "alpha", score: 0.82, label: "vector alpha" },
        { id: "beta", score: 0.71, label: "vector beta" },
      ],
      [
        { id: "beta", score: 0.96, label: "name beta" },
        { id: "gamma", score: 0.67, label: "name gamma" },
      ],
    ],
    { limit: 2 }
  );

  assert.deepEqual(results, [
    { id: "beta", score: 0.96, label: "name beta" },
    { id: "alpha", score: 0.82, label: "vector alpha" },
  ]);
});

test("filterByMinimumScore removes results below the relevance threshold", () => {
  const results = filterByMinimumScore(
    [
      { id: "low", score: 0.19 },
      { id: "threshold", score: 0.2 },
      { id: "high", score: 0.91 },
    ],
    0.2
  );

  assert.deepEqual(results, [
    { id: "threshold", score: 0.2 },
    { id: "high", score: 0.91 },
  ]);
});

test("sortChunksByDocumentPriority puts scoped document chunks first, then score", () => {
  const results = sortChunksByDocumentPriority(
    [
      { id: "global-best", documentId: "other", score: 0.99 },
      { id: "scoped-low", documentId: "doc-1", score: 0.62 },
      { id: "scoped-high", documentId: "doc-1", score: 0.8 },
      { id: "global-low", documentId: "other", score: 0.7 },
    ],
    "doc-1"
  );

  assert.deepEqual(results.map((result) => result.id), [
    "scoped-high",
    "scoped-low",
    "global-best",
    "global-low",
  ]);
});

test("mergeEntityMatches combines vector and name matches by best score with a cap", () => {
  const results = mergeEntityMatches(
    [
      { id: "semantic", name: "Semantic Match", type: "concept", description: null, score: 0.88 },
      { id: "overlap", name: "Vector Version", type: "concept", description: null, score: 0.73 },
    ],
    [
      { id: "overlap", name: "Name Version", type: "concept", description: "exact", score: 1 },
      { id: "literal", name: "Literal Match", type: "concept", description: null, score: 0.95 },
    ],
    2
  );

  assert.deepEqual(results, [
    { id: "overlap", name: "Name Version", type: "concept", description: "exact", score: 1 },
    { id: "literal", name: "Literal Match", type: "concept", description: null, score: 0.95 },
  ]);
});

test("scoreEntityNameMatch ranks exact names above contained names", () => {
  assert.equal(scoreEntityNameMatch("React", "react"), 1);
  assert.equal(scoreEntityNameMatch("How does React work?", "react"), 0.95);
  assert.equal(scoreEntityNameMatch("react", "React Hooks"), 0.9);
  assert.equal(scoreEntityNameMatch("Vue", "React"), null);
});

test("buildEntityNameSearchTerms creates bounded normalized phrases from the query", () => {
  const terms = buildEntityNameSearchTerms("Tell me about React Hooks in Next.js", {
    maxWordsPerTerm: 2,
    maxTerms: 8,
  });

  assert.deepEqual(terms, [
    "tell",
    "tell me",
    "me",
    "me about",
    "about",
    "about react",
    "react",
    "react hooks",
  ]);
});
