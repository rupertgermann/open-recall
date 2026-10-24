/**
 * Structure-aware chunking - Phase 1
 * Replaces fixed-size chunking with semantic-aware splitting
 */

import { estimateTokens, generateExactContentHash } from "../text/index.ts";

export const CHUNKING_VERSION = "2.0";

export interface StructuredChunk {
  content: string;
  index: number;
  tokenCount: number;
  contentHash: string;
  type: "heading" | "paragraph" | "sentence" | "merged";
}

export interface StructuredChunkerOptions {
  minChunkTokens?: number;  // Minimum tokens per chunk (merge smaller)
  maxChunkTokens?: number;  // Maximum tokens per chunk (split larger)
  targetChunkTokens?: number; // Target chunk size
}

const DEFAULT_OPTIONS: Required<StructuredChunkerOptions> = {
  minChunkTokens: 100,   // Merge chunks smaller than 100 tokens
  maxChunkTokens: 800,   // Split chunks larger than 800 tokens
  targetChunkTokens: 500, // Target 300-800 token range
};

/**
 * Split text by markdown headings
 */
function splitByHeadings(text: string): string[] {
  return text.split(/(?=^#{1,6}[ \t]+\S)/m);
}

/**
 * Split text by paragraphs (double newlines)
 */
function splitByParagraphs(text: string): string[] {
  return text.split(/(?<=\n\n)(?=[^\n])/);
}

/**
 * Split text by sentences
 */
function splitBySentences(text: string): string[] {
  // Keep separators in the slices so code indentation survives splitting.
  return text.split(/(?<=[.!?])(?=\s)/);
}

/**
 * Merge adjacent slices without exceeding the maximum size.
 */
function mergeSmallChunks(
  chunks: string[],
  maxTokens: number
): string[] {
  const merged: string[] = [];
  let current = "";
  
  for (const chunk of chunks) {
    if (current === "") {
      current = chunk;
    } else if (estimateTokens(current + chunk) <= maxTokens) {
      current += chunk;
    } else {
      merged.push(current);
      current = chunk;
    }
  }
  
  if (current) {
    merged.push(current);
  }
  
  return merged;
}

/**
 * Split text that exceeds maxTokens on word boundaries,
 * falling back to fixed-size character windows for unbroken runs.
 */
function splitByTokenBudget(text: string, maxTokens: number): string[] {
  const maxChars = maxTokens * 4; // inverse of estimateTokens
  const words = text.match(/\s*\S+|\s+$/g) ?? [];
  const pieces: string[] = [];
  let current = "";

  for (const word of words) {
    const parts =
      word.length > maxChars
        ? (word.match(new RegExp(`[\\s\\S]{1,${maxChars}}`, "g")) ?? [])
        : [word];

    for (const part of parts) {
      if (current === "") {
        current = part;
      } else if (current.length + part.length <= maxChars) {
        current += part;
      } else {
        pieces.push(current);
        current = part;
      }
    }
  }

  if (current) {
    pieces.push(current);
  }

  return pieces;
}

/**
 * Split a large chunk into smaller pieces by sentences.
 * Sentences that still exceed maxTokens (e.g. logs or CSV rows without
 * sentence punctuation) are split on word boundaries.
 */
function splitLargeChunk(text: string, maxTokens: number): string[] {
  const sentences = splitBySentences(text).flatMap((sentence) =>
    estimateTokens(sentence) > maxTokens
      ? splitByTokenBudget(sentence, maxTokens)
      : [sentence]
  );
  const chunks: string[] = [];
  let current = "";

  for (const sentence of sentences) {
    if (current === "") {
      current = sentence;
    } else if (estimateTokens(current + sentence) <= maxTokens) {
      current += sentence;
    } else {
      chunks.push(current);
      current = sentence;
    }
  }

  if (current) {
    chunks.push(current);
  }

  return chunks;
}

/**
 * Structure-aware chunking
 * 1. Split by markdown headings
 * 2. Split by paragraphs
 * 3. Split by sentences (fallback for large paragraphs)
 * 4. Merge small chunks
 */
export function chunkStructured(
  text: string,
  options: StructuredChunkerOptions = {}
): StructuredChunk[] {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const chunks: StructuredChunk[] = [];
  
  if (!text || text.trim().length === 0) {
    return chunks;
  }
  
  // Step 1: Split by headings
  const sections = splitByHeadings(text);
  
  // Step 2: Process each section
  const rawChunks: string[] = [];
  
  for (const sectionText of sections) {
    const sectionTokens = estimateTokens(sectionText);
    
    if (sectionTokens <= opts.maxChunkTokens) {
      // Section fits in one chunk
      rawChunks.push(sectionText);
    } else {
      // Split section by paragraphs
      const paragraphs = splitByParagraphs(sectionText);
      
      for (const para of paragraphs) {
        const paraTokens = estimateTokens(para);
        
        if (paraTokens <= opts.maxChunkTokens) {
          rawChunks.push(para);
        } else {
          // Split large paragraph by sentences
          const sentenceChunks = splitLargeChunk(para, opts.maxChunkTokens);
          rawChunks.push(...sentenceChunks);
        }
      }
    }
  }
  
  // Step 3: Merge small chunks
  const mergedChunks = mergeSmallChunks(rawChunks, opts.maxChunkTokens);
  
  // Step 4: Create final chunk objects with hashes
  let index = 0;
  for (const content of mergedChunks) {
    if (content.trim().length === 0) continue;
    
    chunks.push({
      content,
      index,
      tokenCount: estimateTokens(content),
      contentHash: generateExactContentHash(content),
      type: "merged",
    });
    index++;
  }
  
  return chunks;
}

/**
 * Check if a chunk with the given hash already exists
 * Returns the existing chunk ID if found, null otherwise
 */
export async function findExistingChunkByHash(
  contentHash: string
): Promise<string | null> {
  const { db } = await import("@/db");
  const { chunks } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  
  const [existing] = await db
    .select({ id: chunks.id })
    .from(chunks)
    .where(eq(chunks.contentHash, contentHash))
    .limit(1);
  
  return existing?.id ?? null;
}
