import assert from "node:assert/strict";
import test from "node:test";
import { createTestDatabase } from "./helpers/db.ts";
import { useDatabase } from "./helpers/server.ts";
import { completion } from "./helpers/provider.ts";
import { documents, documentTags } from "../src/db/schema.ts";

const { generateDocumentTags, updateDocumentTags } = await import("../src/actions/documents.ts");
const { saveAISettings, getAISettings } = await import("../src/actions/settings.ts");

for (const generated of [["generated"], []]) {
  test(`AI tags preserve intervening edits when generation returns ${generated.length} tags`, async (t) => {
    const { db, close } = await createTestDatabase();
    t.after(close);
    useDatabase(db);
    const config = { provider: "local" as const, baseUrl: "http://provider.invalid/v1", model: "test" };
    await saveAISettings({ chat: config, embedding: config }, await getAISettings());
    const [doc] = await db.insert(documents).values({ title: "Tags", content: "Content", type: "note" }).returning();
    await updateDocumentTags(doc.id, ["old"]);
    const started = Promise.withResolvers<void>();
    const response = Promise.withResolvers<Response>();
    t.mock.method(globalThis, "fetch", () => { started.resolve(); return response.promise; });

    const generation = generateDocumentTags(doc.id);
    await started.promise;
    await updateDocumentTags(doc.id, ["manual"]);
    response.resolve(completion(JSON.stringify({ tags: generated })));
    const result = await generation;
    assert.deepEqual(result.tags.sort(), ["manual", ...generated].sort());
    assert.equal(result.success, generated.length > 0);
  });
}

test("rejected generated-tag insertion preserves existing tag links", async (t) => {
  const { db, pglite, close } = await createTestDatabase();
  t.after(close);
  useDatabase(db);
  const config = { provider: "local" as const, baseUrl: "http://provider.invalid/v1", model: "test" };
  await saveAISettings({ chat: config, embedding: config }, await getAISettings());
  const [doc] = await db.insert(documents).values({ title: "Tags", content: "Content", type: "note" }).returning();
  await updateDocumentTags(doc.id, ["manual"]);
  const before = await db.select().from(documentTags);
  t.mock.method(globalThis, "fetch", async () => completion(JSON.stringify({ tags: ["generated"] })));
  await pglite.exec(`CREATE FUNCTION reject_generated_tag() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Tag insert failed'; END; $$;
    CREATE TRIGGER reject_generated_tag BEFORE INSERT ON document_tags FOR EACH ROW EXECUTE FUNCTION reject_generated_tag();`);
  await assert.rejects(generateDocumentTags(doc.id));
  assert.deepEqual(await db.select().from(documentTags), before);
});
