import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import sharp from "sharp";
import test from "node:test";
import { eq } from "drizzle-orm";
import { chunks, documents } from "../src/db/schema.ts";
import { createDocumentIngestionService, type DerivedDocumentData, type SourceContent } from "../src/lib/ingestion/service.ts";
import { generateContentHash } from "../src/lib/text/index.ts";
import { createTestDatabase } from "./helpers/db.ts";
import { useDatabase } from "./helpers/server.ts";

function derived(source: SourceContent): DerivedDocumentData {
  return {
    contentHash: generateContentHash(source.content), embeddingModel: "test",
    chunks: [{ content: source.content, contentHash: generateContentHash(source.content), index: 0, tokenCount: 4, type: "merged" }],
    chunkEmbeddings: [[1, 0, 0]], summary: source.content, tags: [], entities: [], relationships: [], entityEmbeddingsByKey: new Map(),
  };
}
const url = "https://drive.google.com/file/d/test/view";
const runner = (content: string) => async (args: string[]) => {
  if (args[1] === "get") return { id: "test", name: "Test", mimeType: "application/vnd.google-apps.document" };
  await writeFile(args[args.indexOf("--out") + 1], content);
  return {};
};

for (const failing of [false, true]) {
  test(`older refresh ${failing ? "failure" : "success"} cannot replace a newer completion`, async (t) => {
    const { db, close } = await createTestDatabase();
    t.after(close);
    const entered = Promise.withResolvers<void>();
    const gate = Promise.withResolvers<void>();
    t.after(() => gate.resolve());
    const service = createDocumentIngestionService({
      database: db, getCurrentEmbeddingModel: async () => "test", revalidatePath: () => {},
      buildDerivedData: async (_id, source) => {
        if (source.content === "Old source") {
          entered.resolve();
          await gate.promise;
          if (failing) throw new Error("Older generation failed");
        }
        return derived(source);
      },
    });
    const initial = await service.ingestUrlDocument(url, { driveRunner: runner("Initial source") });
    const older = service.refreshDocument(initial.documentId, { driveRunner: runner("Old source") });
    const rejected = assert.rejects(older, failing ? /Older generation failed/ : /superseded|changed during ingestion/i);
    await entered.promise;
    await service.refreshDocument(initial.documentId, { driveRunner: runner("New source") });
    const before = await db.select().from(documents);
    gate.resolve();
    await rejected;
    assert.deepEqual(await db.select().from(documents), before);
    assert.equal(before[0].processingStatus, "completed");
    assert.deepEqual(await db.select({ content: chunks.content }).from(chunks), [{ content: "New source" }]);
    assert.equal((await service.refreshDocument(initial.documentId, { driveRunner: runner("New source") })).skipped, true);
  });
}

test("an older unchanged refresh cannot revert a newer completed refresh", async (t) => {
  const { db, close } = await createTestDatabase();
  t.after(close);
  const service = createDocumentIngestionService({ database: db, buildDerivedData: async (_id, source) => derived(source), getCurrentEmbeddingModel: async () => "test", revalidatePath: () => {} });
  const initial = await service.ingestUrlDocument(url, { driveRunner: runner("Initial source") });
  const entered = Promise.withResolvers<void>();
  const gate = Promise.withResolvers<void>();
  t.after(() => gate.resolve());
  const older = service.refreshDocument(initial.documentId, { driveRunner: async (args) => {
    if (args[1] === "get") { entered.resolve(); await gate.promise; }
    return runner("Initial source")(args);
  } });
  const rejected = assert.rejects(older, /superseded|changed during ingestion/i);
  await entered.promise;
  await service.refreshDocument(initial.documentId, { driveRunner: runner("New source") });
  gate.resolve();
  await rejected;
  assert.equal((await db.select().from(documents))[0].content, "New source");
  assert.deepEqual(await db.select({ content: chunks.content }).from(chunks), [{ content: "New source" }]);
});

test("refresh can supersede initial ingestion and recover abandoned processing state", async (t) => {
  const { db, close } = await createTestDatabase();
  t.after(close);
  const entered = Promise.withResolvers<void>();
  const gate = Promise.withResolvers<void>();
  t.after(() => gate.resolve());
  const service = createDocumentIngestionService({ database: db, getCurrentEmbeddingModel: async () => "test", revalidatePath: () => {}, buildDerivedData: async (_id, source) => {
    if (source.content === "Old source") { entered.resolve(); await gate.promise; }
    return derived(source);
  } });
  const initial = service.ingestUrlDocument(url, { driveRunner: runner("Old source") });
  const rejected = assert.rejects(initial, /superseded|changed during ingestion/i);
  await entered.promise;
  const [doc] = await db.select().from(documents);
  await service.refreshDocument(doc.id, { driveRunner: runner("New source") });
  gate.resolve();
  await rejected;
  assert.deepEqual(await db.select({ content: chunks.content }).from(chunks), [{ content: "New source" }]);
  await db.update(documents).set({ processingStatus: "processing" }).where(eq(documents.id, doc.id));
  assert.equal((await service.refreshDocument(doc.id, { driveRunner: runner("Recovered source") })).action, "refreshed");
  assert.equal((await db.select().from(documents))[0].processingStatus, "completed");
});

test("refresh publishes only its winning image and keeps the previous image on failure", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "recall-refresh-images-"));
  const previousDirectory = process.cwd();
  process.chdir(directory);
  t.after(async () => { process.chdir(previousDirectory); await rm(directory, { recursive: true, force: true }); });
  const { db, close } = await createTestDatabase();
  t.after(close);
  const entered = Promise.withResolvers<void>();
  const gate = Promise.withResolvers<void>();
  t.after(() => gate.resolve());
  const colors = await Promise.all(["red", "green", "blue"].map(background =>
    sharp({ create: { width: 1, height: 1, channels: 3, background } }).png().toBuffer()
  ));
  let content = "Initial source";
  let color = 0;
  t.mock.method(globalThis, "fetch", async (input: Parameters<typeof fetch>[0]) => {
    if (String(input).startsWith("https://images.invalid/")) {
      const image = colors[Number(new URL(String(input)).pathname.slice(1))];
      return new Response(new Uint8Array(image), { headers: { "Content-Type": "image/png" } });
    }
    return new Response('<html><head><title>Image source</title><meta property="og:image" content="https://images.invalid/' + color + '"></head><body><article><p>' + content + '</p></article></body></html>');
  });
  const service = createDocumentIngestionService({
    database: db, getCurrentEmbeddingModel: async () => "test", revalidatePath: () => {},
    buildDerivedData: async (_id, source) => {
      if (source.content.includes("Old source")) { entered.resolve(); await gate.promise; }
      if (source.content.includes("Broken source")) throw new Error("Generation failed");
      return derived(source);
    },
  });
  const initial = await service.ingestUrlDocument("https://source.invalid/article");
  content = "Old source"; color = 1;
  const older = service.refreshDocument(initial.documentId);
  const rejected = assert.rejects(older, /superseded|changed during ingestion/i);
  await entered.promise;
  content = "New source"; color = 2;
  await service.refreshDocument(initial.documentId);
  const before = await db.select().from(documents);
  useDatabase(db);
  const { getDocument } = await import("../src/actions/documents.ts");
  const saved = await getDocument(initial.documentId);
  assert.ok(saved?.imagePath);
  const imageFile = join(directory, "data", saved.imagePath);
  const bytes = await readFile(imageFile);
  gate.resolve();
  await rejected;
  assert.deepEqual(await db.select().from(documents), before);
  assert.deepEqual(await readFile(imageFile), bytes);
  assert.deepEqual(bytes, colors[2]);
  assert.equal((await readdir(join(directory, "data", "document-images"))).length, 1);
  content = "Broken source"; color = 0;
  await assert.rejects(service.refreshDocument(initial.documentId), /Generation failed/);
  assert.deepEqual(await readFile(imageFile), bytes);
  assert.equal((await getDocument(initial.documentId))?.imagePath, saved.imagePath);
  assert.equal((await readdir(join(directory, "data", "document-images"))).length, 1);
});

test("Source Refresh rebuilds a legacy chunking version once before skipping unchanged text", async (t) => {
  const { db, close } = await createTestDatabase();
  t.after(close);
  let builds = 0;
  const service = createDocumentIngestionService({
    database: db, getCurrentEmbeddingModel: async () => "test", revalidatePath: () => {},
    buildDerivedData: async (_id, source) => { builds++; return derived(source); },
  });
  const options = { driveRunner: runner("Unchanged source") };
  const initial = await service.ingestUrlDocument(url, options);
  await db.update(documents).set({ embeddingVersion: "1.0" }).where(eq(documents.id, initial.documentId));
  assert.equal((await service.refreshDocument(initial.documentId, options)).skipped, false);
  assert.equal((await service.refreshDocument(initial.documentId, options)).skipped, true);
  assert.equal(builds, 2);
});

test("a failed replacement fetch releases abandoned processing work for a normal Drive retry", async (t) => {
  const { db, close } = await createTestDatabase();
  t.after(close);
  const entered = Promise.withResolvers<void>();
  const gate = Promise.withResolvers<void>();
  t.after(() => gate.resolve());
  const service = createDocumentIngestionService({
    database: db, getCurrentEmbeddingModel: async () => "test", revalidatePath: () => {},
    buildDerivedData: async (_id, source) => {
      if (source.content === "Old source") { entered.resolve(); await gate.promise; }
      return derived(source);
    },
  });
  const initial = await service.ingestUrlDocument(url, { driveRunner: runner("Initial source") });
  const older = service.refreshDocument(initial.documentId, { driveRunner: runner("Old source") });
  const rejected = assert.rejects(older, /superseded|changed during ingestion/i);
  await entered.promise;
  await assert.rejects(service.refreshDocument(initial.documentId, {
    driveRunner: async () => { throw new Error("Permission lost"); },
  }), /Permission lost/);
  assert.equal((await db.select().from(documents))[0].processingStatus, "failed");
  gate.resolve();
  await rejected;
  assert.equal((await service.ingestUrlDocument(url, { driveRunner: runner("Retry source") })).action, "refreshed");
});

test("an invalid note refresh cannot supersede note ingestion", async (t) => {
  const { db, close } = await createTestDatabase();
  t.after(close);
  const entered = Promise.withResolvers<void>();
  const gate = Promise.withResolvers<void>();
  t.after(() => gate.resolve());
  const service = createDocumentIngestionService({
    database: db, revalidatePath: () => {},
    buildDerivedData: async (_id, source) => { entered.resolve(); await gate.promise; return derived(source); },
  });
  const ingesting = service.ingestTextDocument({ title: "Note", content: "Original note" });
  await entered.promise;
  const [doc] = await db.select().from(documents);
  await assert.rejects(service.refreshDocument(doc.id), /no source URL/);
  assert.deepEqual((await db.select().from(documents))[0], doc);
  gate.resolve();
  await ingesting;
  assert.equal((await db.select().from(documents))[0].processingStatus, "completed");
});
