import assert from "node:assert/strict";
import test from "node:test";

import { dedupeDocumentChunks, type IngestionChunkCandidate } from "../src/lib/ingestion/chunks.ts";
import { entityKeysEqual, makeEntityKey, parseEntityKey } from "../src/lib/ingestion/entity-key.ts";
import { planEntityMentions } from "../src/lib/ingestion/mentions.ts";
import { planRelationshipInserts } from "../src/lib/ingestion/relationships.ts";

test("dedupeDocumentChunks removes duplicate hashes only within one document run", () => {
  const chunks: IngestionChunkCandidate[] = [
    { content: "Alpha", contentHash: "same-hash", chunkIndex: 0 },
    { content: "Beta", contentHash: "different-hash", chunkIndex: 1 },
    { content: "Alpha repeated", contentHash: "same-hash", chunkIndex: 2 },
  ];

  const result = dedupeDocumentChunks(chunks);

  assert.deepEqual(result.uniqueChunks, [
    { content: "Alpha", contentHash: "same-hash", chunkIndex: 0 },
    { content: "Beta", contentHash: "different-hash", chunkIndex: 1 },
  ]);
  assert.deepEqual(result.duplicates, [
    { content: "Alpha repeated", contentHash: "same-hash", chunkIndex: 2 },
  ]);
  assert.equal(result.duplicateCount, 1);
});

test("Entity Keys round-trip and compare by name-type identity", () => {
  const key = makeEntityKey({ name: "Apple||Vision", type: "product" });

  assert.deepEqual(parseEntityKey(key), { name: "Apple||Vision", type: "product" });
  assert.equal(entityKeysEqual(key, makeEntityKey({ name: "Apple||Vision", type: "product" })), true);
  assert.equal(entityKeysEqual(key, makeEntityKey({ name: "Apple||Vision", type: "organization" })), false);
});

test("planEntityMentions maps entities to chunks that mention their names with fallback", () => {
  const result = planEntityMentions({
    documentId: "doc-1",
    entities: [
      { id: "entity-react", name: "React" },
      { id: "entity-postgres", name: "Postgres" },
      { id: "entity-absent", name: "SQLite" },
    ],
    chunks: [
      { id: "chunk-1", content: "React components can query Postgres." },
      { id: "chunk-2", content: "A react server component streams HTML." },
    ],
  });

  assert.deepEqual(result.mentions, [
    { entityId: "entity-react", chunkId: "chunk-1", documentId: "doc-1", confidence: 1 },
    { entityId: "entity-react", chunkId: "chunk-2", documentId: "doc-1", confidence: 1 },
    { entityId: "entity-postgres", chunkId: "chunk-1", documentId: "doc-1", confidence: 1 },
    { entityId: "entity-absent", chunkId: "chunk-1", documentId: "doc-1", confidence: 0 },
  ]);
  assert.deepEqual(result.fallbacks, [
    { entityId: "entity-absent", entityName: "SQLite", chunkId: "chunk-1" },
  ]);
});

test("planEntityMentions does not match entity names inside larger words", () => {
  const result = planEntityMentions({
    documentId: "doc-1",
    entities: [{ id: "entity-ai", name: "AI" }],
    chunks: [
      { id: "chunk-1", content: "The claim was said aloud." },
      { id: "chunk-2", content: "AI systems can summarize documents." },
    ],
  });

  assert.deepEqual(result.mentions, [
    { entityId: "entity-ai", chunkId: "chunk-2", documentId: "doc-1", confidence: 1 },
  ]);
  assert.deepEqual(result.fallbacks, []);
});

test("planRelationshipInserts resolves endpoints, drops invalid relationships, and dedupes triples", () => {
  const result = planRelationshipInserts({
    sourceDocumentId: "doc-1",
    entityIdMap: new Map([
      [makeEntityKey({ name: "React", type: "technology" }), "entity-react"],
      [makeEntityKey({ name: "Postgres", type: "database" }), "entity-postgres"],
      [makeEntityKey({ name: "Apple", type: "organization" }), "entity-apple-org"],
      [makeEntityKey({ name: "Apple", type: "product" }), "entity-apple-product"],
    ]),
    relationships: [
      { source: "react", target: "Postgres", type: "uses", description: "React uses Postgres." },
      { source: "React", target: "postgres", type: "uses", description: "Duplicate wording." },
      { source: "SQLite", target: "Postgres", type: "uses", description: null },
      { source: "React", target: "Apple", type: "mentions", description: null },
    ],
  });

  assert.deepEqual(result.values, [
    {
      sourceEntityId: "entity-react",
      targetEntityId: "entity-postgres",
      relationType: "uses",
      description: "React uses Postgres.",
      sourceDocumentId: "doc-1",
    },
  ]);
  assert.equal(result.duplicateCount, 1);
  assert.deepEqual(result.dropped, [
    {
      index: 2,
      relationship: { source: "SQLite", target: "Postgres", type: "uses", description: null },
      reasons: ["source_unresolved"],
    },
    {
      index: 3,
      relationship: { source: "React", target: "Apple", type: "mentions", description: null },
      reasons: ["target_ambiguous"],
    },
  ]);
});

test("planRelationshipInserts resolves entity names containing delimiter text", () => {
  const result = planRelationshipInserts({
    sourceDocumentId: "doc-1",
    entityIdMap: new Map([
      [makeEntityKey({ name: "ACME||Widget", type: "product" }), "entity-widget"],
      [makeEntityKey({ name: "Postgres", type: "database" }), "entity-postgres"],
    ]),
    relationships: [
      { source: "ACME||Widget", target: "Postgres", type: "uses", description: null },
    ],
  });

  assert.deepEqual(result.values, [
    {
      sourceEntityId: "entity-widget",
      targetEntityId: "entity-postgres",
      relationType: "uses",
      description: null,
      sourceDocumentId: "doc-1",
    },
  ]);
  assert.equal(result.duplicateCount, 0);
  assert.deepEqual(result.dropped, []);
});
