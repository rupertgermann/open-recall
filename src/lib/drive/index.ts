import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const GOOGLE_DOC_MIME_TYPE = "application/vnd.google-apps.document";
export const GOGCLI_INSTALL_INSTRUCTIONS = "Install gogcli with: brew install openclaw/tap/gogcli";
export const GOGCLI_AUTH_COMMAND = "gog auth add <email> --services drive";

const DRIVE_FILE_FIELDS = "id,name,mimeType,modifiedTime";

export type GogRunner = (args: string[]) => Promise<unknown>;

export type DriveFileLink = {
  kind: "file";
  fileId: string;
  canonicalUrl: string;
};

export type DriveFolderLink = {
  kind: "folder";
  folderId: string;
  canonicalUrl: string;
};

export type DriveLink = DriveFileLink | DriveFolderLink;

export type DriveSourceContent = {
  title: string;
  content: string;
  type: "gdoc";
  url: string;
  metadata: {
    driveFileId: string;
    driveMimeType: string;
    driveModifiedTime?: string;
  };
};

type DriveFileMetadata = {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
};

export function canonicalizeDriveFileUrl(fileId: string): string {
  return `https://drive.google.com/file/d/${fileId}/view`;
}

export function canonicalizeDriveFolderUrl(folderId: string): string {
  return `https://drive.google.com/drive/folders/${folderId}`;
}

export function parseDriveUrl(input: string): DriveLink | null {
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    return null;
  }

  const hostname = parsed.hostname.replace(/^www\./, "");
  if (hostname === "docs.google.com") {
    const fileId = matchPathId(parsed.pathname, /^\/(?:document|spreadsheets|presentation)\/d\/([^/]+)/);
    return fileId ? fileLink(fileId) : null;
  }

  if (hostname !== "drive.google.com") return null;

  const folderId = matchPathId(parsed.pathname, /^\/drive\/folders\/([^/]+)/);
  if (folderId) {
    return {
      kind: "folder",
      folderId,
      canonicalUrl: canonicalizeDriveFolderUrl(folderId),
    };
  }

  const fileId = matchPathId(parsed.pathname, /^\/file\/d\/([^/]+)/) ?? parsed.searchParams.get("id");
  return fileId ? fileLink(fileId) : null;
}

export function createGogRunner(command = process.env.GOG_PATH || "gog"): GogRunner {
  return async (args) => {
    try {
      const { stdout } = await execFileAsync(command, args, { maxBuffer: 20 * 1024 * 1024 });
      const output = stdout.trim();
      if (!output) return {};
      return JSON.parse(output);
    } catch (error) {
      throw normalizeProcessError(error);
    }
  };
}

export async function resolveDriveFileSource(
  inputUrl: string,
  options: { runner?: GogRunner } = {}
): Promise<DriveSourceContent> {
  const parsed = parseDriveUrl(inputUrl);
  if (!parsed) throw new Error("URL is not a Google Drive link");
  if (parsed.kind !== "file") {
    throw new Error("Folder Import is not implemented yet");
  }

  const runner = options.runner ?? createGogRunner();
  const metadata = await getDriveFileMetadata(parsed.fileId, runner);
  if (metadata.mimeType !== GOOGLE_DOC_MIME_TYPE) {
    throw new Error(`Unsupported Drive file type: ${metadata.mimeType}`);
  }

  const content = await exportGoogleDocWithFallback(metadata.id, runner);

  return {
    title: metadata.name || "Untitled Google Doc",
    content,
    type: "gdoc",
    url: canonicalizeDriveFileUrl(metadata.id),
    metadata: {
      driveFileId: metadata.id,
      driveMimeType: metadata.mimeType,
      ...(metadata.modifiedTime ? { driveModifiedTime: metadata.modifiedTime } : {}),
    },
  };
}

async function getDriveFileMetadata(fileId: string, runner: GogRunner): Promise<DriveFileMetadata> {
  try {
    const response = await runner([
      "drive",
      "get",
      fileId,
      "--fields",
      DRIVE_FILE_FIELDS,
      "--json",
      "--results-only",
      "--no-input",
      "--readonly",
    ]);
    return parseDriveFileMetadata(response, fileId);
  } catch (error) {
    throw mapGogSetupError(error);
  }
}

async function exportGoogleDocWithFallback(fileId: string, runner: GogRunner): Promise<string> {
  try {
    return await exportDriveFile(fileId, "md", runner);
  } catch (error) {
    if (isGogSetupError(error)) throw mapGogSetupError(error);
  }

  try {
    return await exportDriveFile(fileId, "txt", runner);
  } catch (error) {
    throw mapGogSetupError(error);
  }
}

async function exportDriveFile(
  fileId: string,
  format: "md" | "txt",
  runner: GogRunner
): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "open-recall-drive-"));
  const outPath = join(dir, `${fileId}.${format}`);

  try {
    await runner([
      "drive",
      "download",
      fileId,
      "--format",
      format,
      "--out",
      outPath,
      "--overwrite",
      "--json",
      "--results-only",
      "--no-input",
      "--readonly",
    ]);
    return await readFile(outPath, "utf8");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function parseDriveFileMetadata(response: unknown, fallbackId: string): DriveFileMetadata {
  const record = unwrapGogRecord(response);
  const id = stringField(record, "id") ?? fallbackId;
  const name = stringField(record, "name") ?? "Untitled Google Doc";
  const mimeType = stringField(record, "mimeType");
  if (!mimeType) throw new Error("gogcli did not return a Drive MIME type");

  return {
    id,
    name,
    mimeType,
    modifiedTime: stringField(record, "modifiedTime"),
  };
}

function unwrapGogRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new Error("gogcli returned malformed JSON");

  const nested = value.result ?? value.data ?? value.file;
  if (isRecord(nested)) return nested;

  return value;
}

function stringField(record: Record<string, unknown>, field: string): string | undefined {
  const value = record[field];
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function matchPathId(pathname: string, pattern: RegExp): string | null {
  const match = pathname.match(pattern);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

function fileLink(fileId: string): DriveFileLink {
  return {
    kind: "file",
    fileId,
    canonicalUrl: canonicalizeDriveFileUrl(fileId),
  };
}

function normalizeProcessError(error: unknown): Error {
  if (!(error instanceof Error)) return new Error(String(error));

  const processError = error as Error & { code?: unknown; stderr?: unknown };
  const stderr = typeof processError.stderr === "string" ? processError.stderr.trim() : "";
  const message = stderr ? `${error.message}\n${stderr}` : error.message;
  const normalized = new Error(message) as Error & { code?: unknown };
  normalized.code = processError.code;
  return normalized;
}

function mapGogSetupError(error: unknown): Error {
  if (isMissingGogError(error)) {
    return new Error(`gogcli was not found. ${GOGCLI_INSTALL_INSTRUCTIONS}`);
  }

  if (isUnauthenticatedGogError(error)) {
    return new Error(`gogcli is not authenticated for Drive. Run: ${GOGCLI_AUTH_COMMAND}`);
  }

  return error instanceof Error ? error : new Error(String(error));
}

function isGogSetupError(error: unknown): boolean {
  return isMissingGogError(error) || isUnauthenticatedGogError(error);
}

function isMissingGogError(error: unknown): boolean {
  return isRecord(error) && error.code === "ENOENT";
}

function isUnauthenticatedGogError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /auth|credential|account|login/i.test(message) && /not|no|missing|unauth/i.test(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
