import assert from "node:assert/strict";
import test from "node:test";

import {
  buildUndirectedAdjacency,
  countHiddenConnectionPairs,
  getArticulationPoints,
  getConnectedComponents,
  type DiscoverEdge,
} from "../src/lib/discover/graph.ts";
import { getInsightKey, normalizeEntityIds } from "../src/lib/discover/utils.ts";

test("normalizeEntityIds trims, deduplicates, and sorts ids", () => {
  assert.deepEqual(normalizeEntityIds([" b ", "a", "", "a", "c"]), ["a", "b", "c"]);
  assert.equal(getInsightKey(["z", "a", "z"]), "a,z");
});

test("getConnectedComponents counts only connected groups with at least two nodes", () => {
  const edges: DiscoverEdge[] = [
    { sourceId: "a", targetId: "b" },
    { sourceId: "b", targetId: "c" },
    { sourceId: "x", targetId: "y" },
  ];

  assert.equal(getConnectedComponents(buildUndirectedAdjacency(edges)).length, 2);
});

test("getArticulationPoints identifies bridge nodes inside a component", () => {
  const adjacency = buildUndirectedAdjacency([
    { sourceId: "a", targetId: "b" },
    { sourceId: "b", targetId: "c" },
    { sourceId: "c", targetId: "d" },
  ]);

  const articulationPoints = getArticulationPoints(adjacency, ["a", "b", "c", "d"]);

  assert.deepEqual([...articulationPoints].sort(), ["b", "c"]);
});

test("countHiddenConnectionPairs counts indirect pairs without direct edges", () => {
  const edges: DiscoverEdge[] = [
    { sourceId: "a", targetId: "b" },
    { sourceId: "b", targetId: "c" },
    { sourceId: "c", targetId: "d" },
  ];

  assert.equal(countHiddenConnectionPairs(buildUndirectedAdjacency(edges)), 2);
});
