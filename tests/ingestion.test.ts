import assert from "node:assert/strict";
import test from "node:test";

import { dedupeDocumentChunks, type IngestionChunkCandidate } from "../src/lib/ingestion/chunks.ts";
import { planDocumentReingestCleanup } from "../src/lib/ingestion/cleanup.ts";
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

test("planDocumentReingestCleanup targets document-owned ingestion rows", () => {
  const plan = planDocumentReingestCleanup("doc-1");

  assert.deepEqual(plan, {
    documentId: "doc-1",
    deleteOrder: ["entityMentions", "relationships", "chunks"],
    targets: {
      chunks: { documentId: "doc-1" },
      entityMentions: { documentId: "doc-1" },
      relationships: { sourceDocumentId: "doc-1" },
    },
  });
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
      ["React||technology", "entity-react"],
      ["Postgres||database", "entity-postgres"],
      ["Apple||organization", "entity-apple-org"],
      ["Apple||product", "entity-apple-product"],
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
