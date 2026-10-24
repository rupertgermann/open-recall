import assert from "node:assert/strict";
import test from "node:test";
import { eq } from "drizzle-orm";
import { collections, documentCollections, documents } from "../src/db/schema.ts";
import { createTestDatabase } from "./helpers/db.ts";
import { useDatabase } from "./helpers/server.ts";

const { applyAutoOrganizeSuggestions } = await import("../src/actions/collections.ts");

for (const failure of ["deleted-collection", "membership-write"]) {
  test(`Apply All rolls back the requested batch after ${failure} and permits retry`, async (t) => {
    const { db, pglite, close } = await createTestDatabase();
    t.after(close);
    useDatabase(db);
    const [a, b] = await db.insert(documents).values([{ title: "A", type: "note" }, { title: "B", type: "note" }]).returning();
    const [valid, removed] = await db.insert(collections).values([{ name: "Valid" }, { name: "Later target" }]).returning();
    const batch = [
      { documentId: a.id, existingCollectionIds: [valid.id], newCollections: [{ name: "New collection", description: "Created by batch" }] },
      { documentId: b.id, existingCollectionIds: [removed.id], newCollections: [] },
    ];
    if (failure === "deleted-collection") {
      await db.delete(collections).where(eq(collections.id, removed.id));
    } else {
      await pglite.exec(`CREATE FUNCTION reject_batch_link() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        IF NEW.document_id = '${b.id}'::uuid THEN RAISE EXCEPTION 'Link unavailable'; END IF; RETURN NEW; END; $$;
        CREATE TRIGGER reject_batch_link BEFORE INSERT ON document_collections FOR EACH ROW EXECUTE FUNCTION reject_batch_link();`);
    }
    const before = await db.select().from(collections);
    await assert.rejects(applyAutoOrganizeSuggestions(batch));
    assert.deepEqual(await db.select().from(documentCollections), []);
    assert.deepEqual(await db.select().from(collections), before);
    if (failure === "deleted-collection") {
      await db.insert(collections).values({ id: removed.id, name: removed.name });
    } else {
      await pglite.exec("DROP TRIGGER reject_batch_link ON document_collections");
    }
    const results = await applyAutoOrganizeSuggestions(batch);
    assert.equal(results.length, 2);
    assert.equal((await db.select().from(documentCollections)).length, 3);
    await applyAutoOrganizeSuggestions(batch);
    assert.equal((await db.select().from(documentCollections)).length, 3);
    assert.equal((await db.select().from(collections)).length, 3);
  });
}
