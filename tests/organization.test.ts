import assert from "node:assert/strict";
import test from "node:test";
import { eq } from "drizzle-orm";
import { collections, documentCollections, documents, documentTags } from "../src/db/schema.ts";
import { createTestDatabase } from "./helpers/db.ts";
import { useDatabase } from "./helpers/server.ts";

const { updateDocumentTags } = await import("../src/actions/documents.ts");
const { setDocumentCollections, suggestAutoOrganize } = await import("../src/actions/collections.ts");

test("a failed tag replacement keeps previous tag links", async (t) => {
  const { db, pglite, close } = await createTestDatabase();
  t.after(close);
  useDatabase(db);
  const [doc] = await db.insert(documents).values({ title: "Note", type: "note" }).returning();
  await updateDocumentTags(doc.id, ["old"]);
  const oldLinks = await db.select().from(documentTags);
  await pglite.exec(`CREATE FUNCTION reject_tag() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Tag insert failed'; END; $$;
    CREATE TRIGGER reject_tag BEFORE INSERT ON document_tags FOR EACH ROW EXECUTE FUNCTION reject_tag();`);
  await assert.rejects(updateDocumentTags(doc.id, ["new"]));
  assert.deepEqual(await db.select().from(documentTags), oldLinks);
});

test("a deleted target collection does not erase previous memberships", async (t) => {
  const { db, close } = await createTestDatabase();
  t.after(close);
  useDatabase(db);
  const [doc] = await db.insert(documents).values({ title: "Note", type: "note" }).returning();
  const [old, removed] = await db.insert(collections).values([{ name: "Old" }, { name: "Removed" }]).returning();
  await setDocumentCollections(doc.id, [old.id]);
  await db.delete(collections).where(eq(collections.id, removed.id));
  await assert.rejects(setDocumentCollections(doc.id, [removed.id]));
  assert.deepEqual((await db.select().from(documentCollections)).map(row => row.collectionId), [old.id]);
});

test("auto-organize matches identical titles by Document ID", async (t) => {
  const { db, close } = await createTestDatabase();
  t.after(close);
  useDatabase(db);
  const [first, second] = await db.insert(documents).values([
    { title: "Meeting notes", type: "note" }, { title: "Meeting notes", type: "note" },
  ]).returning();
  const [{ id: collectionId }] = await db.insert(collections).values({ name: "Engineering" }).returning();
  const { saveAISettings, getAISettings } = await import("../src/actions/settings.ts");
  await saveAISettings({
    chat: { provider: "local", baseUrl: "http://provider.invalid/v1", model: "test" },
    embedding: { provider: "local", baseUrl: "http://provider.invalid/v1", model: "test" },
  }, await getAISettings());
  t.mock.method(globalThis, "fetch", async () => Response.json({
    id: "test", model: "test", created: 0, choices: [{ index: 0, finish_reason: "stop", message: {
      role: "assistant", content: JSON.stringify({ assignments: [{
        documentId: second.id, documentTitle: "Meeting notes",
        existingCollections: [{ collectionName: "Engineering", reason: "Team notes" }], newCollections: [],
      }] }),
    } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  }));
  const suggestions = await suggestAutoOrganize();
  assert.equal(suggestions.length, 1);
  assert.equal(suggestions[0].documentId, second.id);
  assert.notEqual(suggestions[0].documentId, first.id);
  assert.equal(suggestions[0].existingCollections[0].collectionId, collectionId);
});
