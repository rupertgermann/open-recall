import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";

export async function encodeDocumentImage(bytes: Buffer): Promise<Buffer> {
  const image = sharp(bytes, { limitInputPixels: 16_000_000 });
  const { format } = await image.metadata();
  if (!format || !["jpeg", "png", "webp", "gif", "avif", "heif", "tiff"].includes(format)) {
    throw new Error("Unsupported document image format");
  }
  return image.rotate().png().toBuffer();
}

export async function readDocumentImage(filename: string): Promise<Buffer | null> {
  if (!/^[0-9a-f-]{36}\.[a-z0-9]{1,10}$/i.test(filename)) return null;
  let bytes: Buffer;
  try {
    bytes = await readFile(join(process.cwd(), "data", "document-images", filename));
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
    // Existing Document URLs still refer to images saved in public before writable storage.
    try {
      bytes = await readFile(join(process.cwd(), "public", "document-images", filename));
    } catch (legacyError) {
      if (legacyError instanceof Error && "code" in legacyError && legacyError.code === "ENOENT") return null;
      throw legacyError;
    }
  }
  try {
    return await encodeDocumentImage(bytes);
  } catch {
    return null;
  }
}

export async function saveDocumentImage(bytes: Buffer, documentId: string, storageDir = join(process.cwd(), "data", "document-images")) {
  if (!/^[0-9a-f-]{36}$/i.test(documentId)) throw new Error("Invalid Document ID");
  const png = await encodeDocumentImage(bytes);
  await mkdir(storageDir, { recursive: true });
  const filename = `${documentId}.png`;
  await writeFile(join(storageDir, filename), png);
  return `/document-images/${filename}`;
}
