import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import test from "node:test";

import {
  DRIVE_FOLDER_MIME_TYPE,
  GOGCLI_AUTH_COMMAND,
  GOGCLI_INSTALL_INSTRUCTIONS,
  buildDriveFolderImportPlan,
  canonicalizeDriveFileUrl,
  getDriveFileSupport,
  parseDriveUrl,
  resolveDriveFileSource,
  type GogRunner,
} from "../src/lib/drive/index.ts";
import { extractPdfText } from "../src/lib/content/extractor.ts";
import { chunkStructured } from "../src/lib/embedding/chunker.ts";

test("Drive file links canonicalize common URL forms by Drive file ID", () => {
  const canonical = "https://drive.google.com/file/d/drive-file-123/view";
  const urls = [
    "https://docs.google.com/document/d/drive-file-123/edit?usp=sharing",
    "https://drive.google.com/file/d/drive-file-123/view?usp=drive_link",
    "https://drive.google.com/open?id=drive-file-123",
  ];

  assert.deepEqual(
    urls.map((url) => parseDriveUrl(url)),
    urls.map(() => ({ kind: "file", fileId: "drive-file-123", canonicalUrl: canonical }))
  );
  assert.equal(canonicalizeDriveFileUrl("drive-file-123"), canonical);
});

test("Drive folder links canonicalize common URL forms by Drive folder ID", () => {
  const canonical = "https://drive.google.com/drive/folders/folder-root";
  const urls = [
    "https://drive.google.com/drive/folders/folder-root",
    "https://drive.google.com/drive/u/0/folders/folder-root",
  ];

  assert.deepEqual(
    urls.map((url) => parseDriveUrl(url)),
    urls.map(() => ({ kind: "folder", folderId: "folder-root", canonicalUrl: canonical }))
  );
});

test("resolveDriveFileSource exports a Google Doc as markdown-backed gdoc SourceContent", async () => {
  const runner = fakeGoogleDocRunner({
    markdown: "# Strategy\n\nGoogle Docs headings should survive export.",
  });

  const source = await resolveDriveFileSource(
    "https://docs.google.com/document/d/doc-123/edit?usp=sharing",
    { runner }
  );

  assert.equal(source.title, "Drive Strategy");
  assert.equal(source.type, "gdoc");
  assert.equal(source.url, "https://drive.google.com/file/d/doc-123/view");
  assert.equal(source.content, "# Strategy\n\nGoogle Docs headings should survive export.");
  assert.deepEqual(source.metadata, {
    driveFileId: "doc-123",
    driveMimeType: "application/vnd.google-apps.document",
    driveModifiedTime: "2026-07-04T10:00:00.000Z",
  });

  const chunks = chunkStructured(source.content, {
    minChunkTokens: 1,
    maxChunkTokens: 20,
    targetChunkTokens: 10,
  });
  assert.match(chunks[0]?.content ?? "", /^## Strategy/);
});

test("resolveDriveFileSource falls back to plain text when markdown export fails", async () => {
  const calls: string[][] = [];
  const runner = fakeGoogleDocRunner({
    markdownError: new Error("markdown export unavailable"),
    text: "Strategy\n\nPlain text fallback.",
    calls,
  });

  const source = await resolveDriveFileSource("https://drive.google.com/open?id=doc-123", { runner });

  assert.equal(source.content, "Strategy\n\nPlain text fallback.");
  assert.equal(
    calls.some((args) => args.includes("--format") && args.includes("md")),
    true
  );
  assert.equal(
    calls.some((args) => args.includes("--format") && args.includes("txt")),
    true
  );
});

test("Drive file support classifies PDFs, text, markdown, and unsupported files before download", () => {
  assert.deepEqual(
    getDriveFileSupport({ name: "Paper.pdf", mimeType: "application/pdf" }),
    { supported: true, type: "pdf" }
  );
  assert.deepEqual(
    getDriveFileSupport({ name: "Notes.md", mimeType: "application/octet-stream" }),
    { supported: true, type: "note", format: "md" }
  );
  assert.deepEqual(
    getDriveFileSupport({ name: "Notes.txt", mimeType: "text/plain" }),
    { supported: true, type: "note", format: "txt" }
  );
  assert.deepEqual(
    getDriveFileSupport({ name: "Budget", mimeType: "application/vnd.google-apps.spreadsheet" }),
    { supported: false, reason: "application/vnd.google-apps.spreadsheet" }
  );
});

test("extractPdfText returns text from a PDF buffer", async () => {
  const text = await extractPdfText(buildSimplePdf("Drive PDF text"));

  assert.match(text, /Drive PDF text/);
});

test("extractPdfText returns a placeholder for image-only PDFs", async () => {
  const text = await extractPdfText(buildEmptyPdf());

  assert.equal(
    text,
    "This PDF did not contain extractable text. It may be a scanned or image-only document."
  );
});

test("resolveDriveFileSource downloads markdown and text Drive Files as note Documents", async () => {
  const markdown = await resolveDriveFileSource("https://drive.google.com/file/d/md-123/view", {
    runner: fakeDriveRunner({
      metadata: {
        id: "md-123",
        name: "Notes.md",
        mimeType: "text/markdown",
        modifiedTime: "2026-07-04T11:00:00.000Z",
      },
      content: "# Notes\n\nDrive markdown.",
    }),
  });
  assert.equal(markdown.type, "note");
  assert.equal(markdown.content, "# Notes\n\nDrive markdown.");

  const text = await resolveDriveFileSource("https://drive.google.com/open?id=txt-123", {
    runner: fakeDriveRunner({
      metadata: {
        id: "txt-123",
        name: "Notes.txt",
        mimeType: "text/plain",
        modifiedTime: "2026-07-04T11:00:00.000Z",
      },
      content: "Drive plain text.",
    }),
  });
  assert.equal(text.type, "note");
  assert.equal(text.content, "Drive plain text.");
});

test("resolveDriveFileSource rejects unsupported Drive types before download", async () => {
  const calls: string[][] = [];

  await assert.rejects(
    resolveDriveFileSource("https://docs.google.com/spreadsheets/d/sheet-123/edit", {
      runner: fakeDriveRunner({
        metadata: {
          id: "sheet-123",
          name: "Budget",
          mimeType: "application/vnd.google-apps.spreadsheet",
        },
        calls,
      }),
    }),
    /Unsupported Drive file type: application\/vnd\.google-apps\.spreadsheet/
  );

  assert.equal(calls.some((args) => args[0] === "drive" && args[1] === "download"), false);
});

test("buildDriveFolderImportPlan lists folders recursively and splits supported from skipped", async () => {
  const calls: string[][] = [];
  const runner: GogRunner = async (args) => {
    calls.push(args);

    if (args[0] === "drive" && args[1] === "ls") {
      const parent = args[args.indexOf("--parent") + 1];
      if (parent === "folder-root") {
        return {
          files: [
            {
              id: "folder-child",
              name: "Nested",
              mimeType: DRIVE_FOLDER_MIME_TYPE,
            },
            {
              id: "doc-1",
              name: "Strategy",
              mimeType: "application/vnd.google-apps.document",
              modifiedTime: "2026-07-04T12:00:00.000Z",
            },
            {
              id: "sheet-1",
              name: "Budget",
              mimeType: "application/vnd.google-apps.spreadsheet",
            },
          ],
        };
      }

      if (parent === "folder-child") {
        return {
          files: [
            {
              id: "txt-1",
              name: "Notes.txt",
              mimeType: "text/plain",
              modifiedTime: "2026-07-04T12:30:00.000Z",
            },
          ],
        };
      }
    }

    throw new Error(`Unexpected gog args: ${args.join(" ")}`);
  };

  const plan = await buildDriveFolderImportPlan(
    "https://drive.google.com/drive/u/0/folders/folder-root",
    { runner }
  );

  assert.equal(plan.folderId, "folder-root");
  assert.deepEqual(plan.supported.map((file) => [file.id, file.documentType]), [
    ["txt-1", "note"],
    ["doc-1", "gdoc"],
  ]);
  assert.deepEqual(plan.skipped.map((file) => [file.id, file.reason]), [
    ["sheet-1", "application/vnd.google-apps.spreadsheet"],
  ]);
  assert.deepEqual(
    calls
      .filter((args) => args[0] === "drive" && args[1] === "ls")
      .map((args) => args[args.indexOf("--parent") + 1]),
    ["folder-root", "folder-child"]
  );
});

test("resolveDriveFileSource maps gogcli setup failures to actionable messages", async () => {
  await assert.rejects(
    resolveDriveFileSource("https://drive.google.com/open?id=doc-123", {
      runner: async () => {
        const error = new Error("spawn gog ENOENT") as Error & { code?: string };
        error.code = "ENOENT";
        throw error;
      },
    }),
    new RegExp(GOGCLI_INSTALL_INSTRUCTIONS.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
  );

  await assert.rejects(
    resolveDriveFileSource("https://drive.google.com/open?id=doc-123", {
      runner: async () => {
        throw new Error("no authenticated account found");
      },
    }),
    new RegExp(GOGCLI_AUTH_COMMAND.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
  );
});

async function writeExportFile(args: string[], content: string) {
  const outIndex = args.indexOf("--out");
  assert.notEqual(outIndex, -1);
  const outPath = args[outIndex + 1];
  assert.equal(typeof outPath, "string");
  await writeFile(outPath, content, "utf8");
  return { path: outPath };
}

function fakeGoogleDocRunner(options: {
  markdown?: string;
  markdownError?: Error;
  text?: string;
  calls?: string[][];
} = {}): GogRunner {
  return async (args) => {
    options.calls?.push(args);

    if (args[0] === "drive" && args[1] === "get") {
      return {
        id: "doc-123",
        name: "Drive Strategy",
        mimeType: "application/vnd.google-apps.document",
        modifiedTime: "2026-07-04T10:00:00.000Z",
      };
    }

    if (args[0] === "drive" && args[1] === "download") {
      const format = args[args.indexOf("--format") + 1];
      if (format === "md") {
        if (options.markdownError) throw options.markdownError;
        return writeExportFile(args, options.markdown ?? "# Drive Strategy\n\nMarkdown export.");
      }
      if (format === "txt") {
        return writeExportFile(args, options.text ?? "Drive Strategy\n\nText export.");
      }
    }

    throw new Error(`Unexpected gog args: ${args.join(" ")}`);
  };
}

function fakeDriveRunner(options: {
  metadata: { id: string; name: string; mimeType: string; modifiedTime?: string };
  content?: string;
  calls?: string[][];
}): GogRunner {
  return async (args) => {
    options.calls?.push(args);

    if (args[0] === "drive" && args[1] === "get") {
      return options.metadata;
    }

    if (args[0] === "drive" && args[1] === "download") {
      return writeExportFile(args, options.content ?? "");
    }

    throw new Error(`Unexpected gog args: ${args.join(" ")}`);
  };
}

function buildSimplePdf(text: string): Buffer {
  const escapedText = text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  const stream = `BT /F1 24 Tf 100 700 Td (${escapedText}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  const offsets: number[] = [];
  let pdf = "%PDF-1.4\n";

  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });

  const xrefOffset = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(pdf);
}

function buildEmptyPdf(): Buffer {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << >> >>",
  ];
  const offsets: number[] = [];
  let pdf = "%PDF-1.4\n";

  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });

  const xrefOffset = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(pdf);
}
