import assert from "node:assert/strict";
import test from "node:test";
import { collections, documentCollections, documents } from "../src/db/schema.ts";
import { createTestDatabase } from "./helpers/db.ts";
import { useDatabase } from "./helpers/server.ts";

const { getDocuments } = await import("../src/actions/documents.ts");

test("library search matches title and summary case-insensitively with filters and pagination", async (t) => {
  const { db, close } = await createTestDatabase();
  t.after(close);
  useDatabase(db);
  const [titleMatch, summaryMatch, otherType, otherCollection] = await db.insert(documents).values([
    { title: "GraphRAG Explained", type: "note", createdAt: new Date("2026-01-04") },
    { title: "Knowledge", summary: "Learn GraphRAG here", type: "note", createdAt: new Date("2026-01-03") },
    { title: "GraphRAG article", type: "article", createdAt: new Date("2026-01-02") },
    { title: "GraphRAG elsewhere", type: "note", createdAt: new Date("2026-01-01") },
    { title: "Unrelated", type: "note" },
  ]).returning();
  const [collection] = await db.insert(collections).values({ name: "Selected" }).returning();
  await db.insert(documentCollections).values([titleMatch, summaryMatch, otherType].map(doc => ({
    documentId: doc.id, collectionId: collection.id,
  })));
  for (const search of ["graphrag", "GRAPHRAG", "GrApHrAg"]) {
    assert.deepEqual((await getDocuments({ search })).map(doc => doc.id),
      [titleMatch.id, summaryMatch.id, otherType.id, otherCollection.id]);
    const filtered = { search, type: "note", collectionId: collection.id };
    assert.deepEqual((await getDocuments(filtered)).map(doc => doc.id), [titleMatch.id, summaryMatch.id]);
    assert.deepEqual((await getDocuments({ ...filtered, limit: 1, offset: 1 })).map(doc => doc.id), [summaryMatch.id]);
  }
  assert.deepEqual(await getDocuments({ search: "no match" }), []);
});
