import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import sharp from "sharp";
import { downloadDocumentImage } from "../src/lib/content/extractor.ts";
import "./helpers/server.ts";

const { GET } = await import("../src/app/api/document-images/[filename]/route.ts");

test("download rejects HTML disguised as an image instead of publishing it", async (t) => {
  const storageDir = await mkdtemp(join(tmpdir(), "recall-images-"));
  t.after(() => rm(storageDir, { recursive: true, force: true }));
  t.mock.method(globalThis, "fetch", async () => new Response("<script>alert(1)</script>", {
    headers: { "Content-Type": "image/png" },
  }));
  assert.equal(await downloadDocumentImage("https://example.invalid/cover.html", randomUUID(), { storageDir }), null);
});

test("downloads are decoded PNGs in writable storage, regardless of URL extension", async (t) => {
  const storageDir = await mkdtemp(join(tmpdir(), "recall-images-"));
  t.after(() => rm(storageDir, { recursive: true, force: true }));
  const jpeg = await sharp({ create: { width: 2, height: 2, channels: 3, background: "red" } }).jpeg().toBuffer();
  t.mock.method(globalThis, "fetch", async () => new Response(new Uint8Array(jpeg), { headers: { "Content-Type": "image/jpeg" } }));
  const id = randomUUID();
  const result = await downloadDocumentImage("https://example.invalid/cover.html", id, { storageDir });
  assert.equal(result?.publicPath, `/document-images/${id}.png`);
  assert.equal(result?.contentType, "image/png");
  assert.equal((await sharp(await readFile(join(storageDir, `${id}.png`))).metadata()).format, "png");
});

test("the image route serves files added after startup and rejects traversal and active content", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "recall-images-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  t.mock.method(process, "cwd", () => root);
  const storageDir = join(root, "data", "document-images");
  await mkdir(storageDir, { recursive: true });
  const filename = `${randomUUID()}.png`;
  const request = new Request(`http://localhost/document-images/${filename}`);
  const context = { params: Promise.resolve({ filename }) };
  assert.equal((await GET(request, context)).status, 404);
  const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: "red" } }).png().toBuffer();
  await writeFile(join(storageDir, filename), png);
  const response = await GET(request, context);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Type"), "image/png");
  assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal((await sharp(Buffer.from(await response.arrayBuffer())).metadata()).format, "png");
  await writeFile(join(storageDir, filename), "<script>alert(1)</script>");
  assert.equal((await GET(request, context)).status, 404);
  assert.equal((await GET(request, { params: Promise.resolve({ filename: "../package.json" }) })).status, 404);
});

test("legacy public image URLs also pass through PNG decoding", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "recall-legacy-images-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  t.mock.method(process, "cwd", () => root);
  const legacyDirectory = join(root, "public", "document-images");
  await mkdir(legacyDirectory, { recursive: true });
  const filename = `${randomUUID()}.html`;
  const image = await sharp({ create: { width: 1, height: 1, channels: 3, background: "blue" } }).jpeg().toBuffer();
  await writeFile(join(legacyDirectory, filename), image);
  const request = new Request(`http://localhost/document-images/${filename}`);
  const context = { params: Promise.resolve({ filename }) };
  assert.equal((await GET(request, context)).status, 200);
  await writeFile(join(legacyDirectory, filename), "<script>alert(1)</script>");
  assert.equal((await GET(request, context)).status, 404);
});
