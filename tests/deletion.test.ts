import assert from "node:assert/strict";
import test from "node:test";
import { chatThreads, chunks, documents, entities, entityMentions, projects, relationships } from "../src/db/schema.ts";
import { createTestDatabase } from "./helpers/db.ts";
import { useDatabase } from "./helpers/server.ts";

const { deleteDocument } = await import("../src/actions/documents.ts");
const { deleteProject } = await import("../src/actions/projects.ts");

for (const rejected of [true, false]) {
  test(`${rejected ? "rejected" : "successful"} Document deletion preserves or removes derived data atomically`, async (t) => {
    const { db, pglite, close } = await createTestDatabase();
    t.after(close);
    useDatabase(db);
    const [doc, kept] = await db.insert(documents).values([
      { title: "Delete", type: "note" }, { title: "Keep", type: "note" },
    ]).returning();
    const [chunk, keptChunk] = await db.insert(chunks).values([
      { documentId: doc.id, content: "Delete content", chunkIndex: 0 },
      { documentId: kept.id, content: "Keep content", chunkIndex: 0 },
    ]).returning();
    const [orphan, shared] = await db.insert(entities).values([
      { name: "Orphan", type: "concept" }, { name: "Shared", type: "concept" },
    ]).returning();
    const mentions = await db.insert(entityMentions).values([
      { entityId: orphan.id, documentId: doc.id, chunkId: chunk.id },
      { entityId: shared.id, documentId: doc.id, chunkId: chunk.id },
      { entityId: shared.id, documentId: kept.id, chunkId: keptChunk.id },
    ]).returning();
    const links = await db.insert(relationships).values({
      sourceEntityId: orphan.id, targetEntityId: shared.id,
      relationType: "uses", sourceDocumentId: doc.id,
    }).returning();

    if (rejected) {
      await pglite.exec(`CREATE FUNCTION reject_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Delete failed'; END; $$;
        CREATE TRIGGER reject_delete BEFORE DELETE ON documents FOR EACH ROW EXECUTE FUNCTION reject_delete();`);
      await assert.rejects(deleteDocument(doc.id));
      assert.deepEqual(await db.select().from(documents), [doc, kept]);
      assert.deepEqual(await db.select().from(chunks), [chunk, keptChunk]);
      assert.deepEqual(await db.select().from(entityMentions), mentions);
      assert.deepEqual(await db.select().from(relationships), links);
      assert.deepEqual(await db.select().from(entities), [orphan, shared]);
    } else {
      assert.deepEqual(await deleteDocument(doc.id), { success: true });
      assert.deepEqual(await db.select().from(documents), [kept]);
      assert.deepEqual(await db.select().from(chunks), [keptChunk]);
      assert.deepEqual(await db.select().from(entityMentions), [mentions[2]]);
      assert.deepEqual(await db.select().from(relationships), []);
      assert.deepEqual(await db.select().from(entities), [shared]);
    }
  });

  test(`${rejected ? "rejected" : "successful"} Project deletion preserves or unlinks chats atomically`, async (t) => {
    const { db, pglite, close } = await createTestDatabase();
    t.after(close);
    useDatabase(db);
    const [project] = await db.insert(projects).values({ name: "Project" }).returning();
    const [thread] = await db.insert(chatThreads).values({
      title: "Project chat", projectId: project.id, category: "project",
    }).returning();
    if (rejected) {
      await pglite.exec(`CREATE FUNCTION reject_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Delete failed'; END; $$;
        CREATE TRIGGER reject_delete BEFORE DELETE ON projects FOR EACH ROW EXECUTE FUNCTION reject_delete();`);
      await assert.rejects(deleteProject(project.id));
      assert.deepEqual(await db.select().from(projects), [project]);
      assert.deepEqual(await db.select().from(chatThreads), [thread]);
    } else {
      assert.deepEqual(await deleteProject(project.id), { success: true });
      assert.deepEqual(await db.select().from(projects), []);
      assert.deepEqual(await db.select().from(chatThreads), [{ ...thread, projectId: null, category: "general" }]);
    }
  });
}

test("failed orphan cleanup rolls back Document deletion and its cascades", async (t) => {
  const { db, pglite, close } = await createTestDatabase();
  t.after(close);
  useDatabase(db);
  const [doc] = await db.insert(documents).values({ title: "Retain", type: "note" }).returning();
  const [chunk] = await db.insert(chunks).values({ documentId: doc.id, content: "Retain content", chunkIndex: 0 }).returning();
  const [entity] = await db.insert(entities).values({ name: "Retain", type: "concept" }).returning();
  await pglite.exec(`CREATE FUNCTION reject_cleanup() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Cleanup failed'; END; $$;
    CREATE TRIGGER reject_cleanup BEFORE DELETE ON entities FOR EACH ROW EXECUTE FUNCTION reject_cleanup();`);
  await assert.rejects(deleteDocument(doc.id));
  assert.deepEqual(await db.select().from(documents), [doc]);
  assert.deepEqual(await db.select().from(chunks), [chunk]);
  assert.deepEqual(await db.select().from(entities), [entity]);
});
