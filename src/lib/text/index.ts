import { createHash } from "crypto";

export function normalizeText(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

export function normalizeTextForHash(text: string): string {
  return normalizeText(text).toLowerCase();
}

export function generateContentHash(text: string): string {
  return createHash("sha256").update(normalizeTextForHash(text)).digest("hex");
}

export function estimateTokens(text: string): number {
  const normalized = normalizeText(text);
  if (normalized.length === 0) return 0;

  return Math.ceil(normalized.length / 4);
}
