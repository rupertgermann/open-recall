import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import test from "node:test";

import { eq } from "drizzle-orm";

import { chunks, documents } from "../src/db/schema.ts";
import { type GogRunner } from "../src/lib/drive/index.ts";
import {
  createDocumentIngestionService,
  type DerivedDocumentData,
  type SourceContent,
} from "../src/lib/ingestion/service.ts";
import { generateContentHash } from "../src/lib/text/index.ts";
import { createTestDatabase } from "./helpers/db.ts";

test("Drive File ingest refreshes an existing canonical Drive Document instead of duplicating", async (t) => {
  const { db, close } = await createTestDatabase();
  t.after(close);

  const service = createDocumentIngestionService({
    database: db,
    buildDerivedData: async (_documentId, source) => derivedFromSource(source),
    getCurrentEmbeddingModel: async () => "test-embedding-model",
    revalidatePath: () => {},
  });
  const runner = fakeGoogleDocRunner({ content: "# Strategy\n\nSame content." });

  const first = await service.ingestUrlDocument("https://docs.google.com/document/d/doc-123/edit", {
    driveRunner: runner,
  });
  const second = await service.ingestUrlDocument("https://drive.google.com/open?id=doc-123", {
    driveRunner: runner,
  });

  assert.equal(second.documentId, first.documentId);
  assert.equal(second.skipped, true);

  const documentRows = await db.select({ id: documents.id, url: documents.url }).from(documents);
  assert.deepEqual(documentRows, [
    {
      id: first.documentId,
      url: "https://drive.google.com/file/d/doc-123/view",
    },
  ]);
});

test("Drive Source Refresh rebuilds Derived Document Data when content changes", async (t) => {
  const { db, close } = await createTestDatabase();
  t.after(close);

  let buildCount = 0;
  const service = createDocumentIngestionService({
    database: db,
    buildDerivedData: async (_documentId, source) => {
      buildCount += 1;
      return derivedFromSource(source);
    },
    getCurrentEmbeddingModel: async () => "test-embedding-model",
    revalidatePath: () => {},
  });
  const state = { content: "First Drive content." };
  const runner = fakeGoogleDocRunner(state);

  const first = await service.ingestUrlDocument("https://docs.google.com/document/d/doc-123/edit", {
    driveRunner: runner,
  });
  state.content = "Changed Drive content.";
  const refreshed = await service.refreshDocument(first.documentId, { driveRunner: runner });

  assert.equal(refreshed.skipped, false);
  assert.equal(buildCount, 2);

  const [documentRow] = await db
    .select({ content: documents.content, contentHash: documents.contentHash })
    .from(documents)
    .where(eq(documents.id, first.documentId));
  assert.equal(documentRow.content, "Changed Drive content.");
  assert.equal(documentRow.contentHash, generateContentHash("Changed Drive content."));
});

test("Drive Source Refresh failure keeps existing Document and Derived Document Data", async (t) => {
  const { db, close } = await createTestDatabase();
  t.after(close);

  const service = createDocumentIngestionService({
    database: db,
    buildDerivedData: async (_documentId, source) => derivedFromSource(source),
    getCurrentEmbeddingModel: async () => "test-embedding-model",
    revalidatePath: () => {},
  });
  const runner = fakeGoogleDocRunner({ content: "Stable Drive content." });

  const first = await service.ingestUrlDocument("https://docs.google.com/document/d/doc-123/edit", {
    driveRunner: runner,
  });

  await assert.rejects(
    service.refreshDocument(first.documentId, {
      driveRunner: async () => {
        throw new Error("Drive File permission lost");
      },
    }),
    /Drive File permission lost/
  );

  const [documentRow] = await db
    .select({
      content: documents.content,
      processingStatus: documents.processingStatus,
    })
    .from(documents)
    .where(eq(documents.id, first.documentId));
  assert.deepEqual(documentRow, {
    content: "Stable Drive content.",
    processingStatus: "completed",
  });

  const chunkRows = await db
    .select({ content: chunks.content })
    .from(chunks)
    .where(eq(chunks.documentId, first.documentId));
  assert.deepEqual(chunkRows, [{ content: "Stable Drive content." }]);
});

test("Drive Folder Import summarizes unsupported, failed, ingested, and unchanged files", async (t) => {
  const { db, close } = await createTestDatabase();
  t.after(close);

  const service = createDocumentIngestionService({
    database: db,
    buildDerivedData: async (_documentId, source) => derivedFromSource(source),
    getCurrentEmbeddingModel: async () => "test-embedding-model",
    revalidatePath: () => {},
  });
  const state = {
    failFileIds: new Set(["bad-doc"]),
    contentById: new Map([
      ["good-doc", "Good Drive content."],
      ["notes", "Drive notes."],
      ["bad-doc", "Broken Drive content."],
    ]),
  };
  const runner = fakeFolderRunner(state);

  const first = await service.ingestDriveFolder("https://drive.google.com/drive/folders/folder-root", {
    driveRunner: runner,
  });

  assert.deepEqual(first.summary, {
    ingested: 2,
    refreshed: 0,
    skippedUnchanged: 0,
    skippedUnsupported: 1,
    failed: 1,
    failures: [
      {
        fileId: "bad-doc",
        name: "Broken Doc",
        error: "Download failed for bad-doc",
      },
    ],
  });

  state.failFileIds.clear();
  const second = await service.ingestDriveFolder("https://drive.google.com/drive/folders/folder-root", {
    driveRunner: runner,
  });

  assert.equal(second.summary.ingested, 1);
  assert.equal(second.summary.skippedUnchanged, 2);
  assert.equal(second.summary.skippedUnsupported, 1);
  assert.equal(second.summary.failed, 0);

  const documentRows = await db
    .select({ url: documents.url })
    .from(documents)
    .orderBy(documents.url);
  assert.deepEqual(documentRows, [
    { url: "https://drive.google.com/file/d/bad-doc/view" },
    { url: "https://drive.google.com/file/d/good-doc/view" },
    { url: "https://drive.google.com/file/d/notes/view" },
  ]);
});

function derivedFromSource(source: SourceContent): DerivedDocumentData {
  return {
    contentHash: generateContentHash(source.content),
    embeddingModel: "test-embedding-model",
    chunks: [
      {
        content: source.content,
        contentHash: generateContentHash(`chunk:${source.content}`),
        index: 0,
        tokenCount: 4,
        type: "merged",
      },
    ],
    chunkEmbeddings: [[0.1, 0.2, 0.3]],
    summary: `Summary for ${source.title}`,
    tags: [],
    entities: [],
    relationships: [],
    entityEmbeddingsByKey: new Map(),
  };
}

function fakeGoogleDocRunner(state: { content: string }): GogRunner {
  return async (args) => {
    if (args[0] === "drive" && args[1] === "get") {
      return {
        id: "doc-123",
        name: "Drive Strategy",
        mimeType: "application/vnd.google-apps.document",
        modifiedTime: "2026-07-04T12:00:00.000Z",
      };
    }

    if (args[0] === "drive" && args[1] === "download") {
      const outIndex = args.indexOf("--out");
      assert.notEqual(outIndex, -1);
      const outPath = args[outIndex + 1];
      assert.equal(typeof outPath, "string");
      await writeFile(outPath, state.content, "utf8");
      return { path: outPath };
    }

    throw new Error(`Unexpected gog args: ${args.join(" ")}`);
  };
}

function fakeFolderRunner(state: {
  failFileIds: Set<string>;
  contentById: Map<string, string>;
}): GogRunner {
  return async (args) => {
    if (args[0] === "drive" && args[1] === "ls") {
      return {
        files: [
          {
            id: "good-doc",
            name: "Good Doc",
            mimeType: "application/vnd.google-apps.document",
            modifiedTime: "2026-07-04T12:00:00.000Z",
          },
          {
            id: "notes",
            name: "Notes.txt",
            mimeType: "text/plain",
            modifiedTime: "2026-07-04T12:05:00.000Z",
          },
          {
            id: "bad-doc",
            name: "Broken Doc",
            mimeType: "application/vnd.google-apps.document",
            modifiedTime: "2026-07-04T12:10:00.000Z",
          },
          {
            id: "sheet",
            name: "Budget",
            mimeType: "application/vnd.google-apps.spreadsheet",
          },
        ],
      };
    }

    if (args[0] === "drive" && args[1] === "get") {
      const fileId = args[2];
      if (fileId === "notes") {
        return {
          id: fileId,
          name: "Notes.txt",
          mimeType: "text/plain",
          modifiedTime: "2026-07-04T12:05:00.000Z",
        };
      }

      return {
        id: fileId,
        name: fileId === "bad-doc" ? "Broken Doc" : "Good Doc",
        mimeType: "application/vnd.google-apps.document",
        modifiedTime: "2026-07-04T12:00:00.000Z",
      };
    }

    if (args[0] === "drive" && args[1] === "download") {
      const fileId = args[2];
      if (state.failFileIds.has(fileId)) {
        throw new Error(`Download failed for ${fileId}`);
      }

      const outIndex = args.indexOf("--out");
      assert.notEqual(outIndex, -1);
      const outPath = args[outIndex + 1];
      assert.equal(typeof outPath, "string");
      await writeFile(outPath, state.contentById.get(fileId) ?? "", "utf8");
      return { path: outPath };
    }

    throw new Error(`Unexpected gog args: ${args.join(" ")}`);
  };
}
