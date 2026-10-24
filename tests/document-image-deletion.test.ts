import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import sharp from "sharp";
import { eq } from "drizzle-orm";
import { documents, entities } from "../src/db/schema.ts";
import { saveDocumentImage, discardDocumentImage } from "../src/lib/content/images.ts";
import { createTestDatabase } from "./helpers/db.ts";
import { useDatabase as setTestDatabase } from "./helpers/server.ts";

const { deleteDocument } = await import("../src/actions/documents.ts");
const { GET } = await import("../src/app/api/document-images/[filename]/route.ts");

async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), "recall-delete-image-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  t.mock.method(process, "cwd", () => root);
  const database = await createTestDatabase();
  t.after(database.close);
  setTestDatabase(database.db);
  const filename = `${randomUUID()}.png`;
  const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: "red" } }).png().toBuffer();
  const imagePath = await saveDocumentImage(png, filename.slice(0, -4));
  const [doc] = await database.db.insert(documents).values({ title: "Image", type: "article", metadata: { imagePath } }).returning();
  const get = () => GET(new Request(`http://localhost${imagePath}`), { params: Promise.resolve({ filename }) });
  return { ...database, root, doc, imagePath, filename, get, png };
}

test("Document deletion removes its current managed image after commit", async (t) => {
  const { db, root, doc, imagePath, get, png } = await fixture(t);
  const oldPath = imagePath;
  const currentPath = await saveDocumentImage(png, randomUUID());
  await db.update(documents).set({ metadata: { imagePath: currentPath } }).where(eq(documents.id, doc.id));
  await deleteDocument(doc.id);
  assert.equal((await db.select().from(documents)).length, 0);
  await assert.rejects(readFile(join(root, "data", currentPath)), { code: "ENOENT" });
  assert.equal((await get()).status, 200, "an unrelated old file is not swept");
  await discardDocumentImage(oldPath);
  assert.equal((await get()).status, 404);
  assert.deepEqual(await deleteDocument(doc.id), { success: true });
});

for (const table of ["documents", "entities"]) {
  test(`a rejected ${table} deletion preserves the managed image`, async (t) => {
    const { db, pglite, doc, get } = await fixture(t);
    await db.insert(entities).values({ name: "Orphan", type: "concept" });
    await pglite.exec(`CREATE FUNCTION reject_image_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Delete failed'; END; $$;
      CREATE TRIGGER reject_image_delete BEFORE DELETE ON ${table} FOR EACH ROW EXECUTE FUNCTION reject_image_delete();`);
    await assert.rejects(deleteDocument(doc.id));
    assert.equal((await db.select().from(documents)).length, 1);
    assert.equal((await get()).status, 200);
  });
}

test("image cleanup tolerates missing files and leaves legacy and unrelated paths alone", async (t) => {
  const { db, root, doc, filename, imagePath, png } = await fixture(t);
  await discardDocumentImage(imagePath);
  const legacyDir = join(root, "public", "document-images");
  await mkdir(legacyDir, { recursive: true });
  await writeFile(join(legacyDir, filename), png);
  await deleteDocument(doc.id);
  assert.deepEqual(await readFile(join(legacyDir, filename)), png);
  const keep = join(root, "keep.png");
  await writeFile(keep, png);
  await db.insert(documents).values({ title: "Unrelated", type: "article", metadata: { imagePath: "/document-images/../../keep.png" } }).returning().then(async ([row]) => deleteDocument(row.id));
  assert.deepEqual(await readFile(keep), png);
});

test("file cleanup failure is logged after successful Document deletion", async (t) => {
  const { db, root, doc, filename, imagePath } = await fixture(t);
  await discardDocumentImage(imagePath);
  await mkdir(join(root, "data", "document-images", filename));
  const log = t.mock.method(console, "error", () => {});
  assert.deepEqual(await deleteDocument(doc.id), { success: true });
  assert.equal((await db.select().from(documents)).length, 0);
  assert.equal(log.mock.callCount(), 1);
  assert.match(String(log.mock.calls[0].arguments[0]), /Could not remove/);
});
