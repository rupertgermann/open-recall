import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import test from "node:test";

import {
  GOGCLI_AUTH_COMMAND,
  GOGCLI_INSTALL_INSTRUCTIONS,
  canonicalizeDriveFileUrl,
  parseDriveUrl,
  resolveDriveFileSource,
  type GogRunner,
} from "../src/lib/drive/index.ts";
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
