/**
 * Structure-aware chunking - Phase 1
 * Replaces fixed-size chunking with semantic-aware splitting
 */

import { createHash } from "crypto";

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
 * Estimate token count (rough approximation: ~4 chars per token)
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Generate SHA-256 hash of normalized text
 */
function generateHash(text: string): string {
  const normalized = text.trim().replace(/\s+/g, " ").toLowerCase();
  return createHash("sha256").update(normalized).digest("hex");
}

/**
 * Normalize text: trim and collapse whitespace
 */
function normalizeText(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

/**
 * Split text by markdown headings
 */
function splitByHeadings(text: string): { heading: string | null; content: string }[] {
  const sections: { heading: string | null; content: string }[] = [];
  const headingRegex = /^(#{1,6})\s+(.+)$/gm;
  
  let lastIndex = 0;
  let match;
  let currentHeading: string | null = null;
  
  while ((match = headingRegex.exec(text)) !== null) {
    // Content before this heading
    if (match.index > lastIndex) {
      const content = text.slice(lastIndex, match.index).trim();
      if (content) {
        sections.push({ heading: currentHeading, content });
      }
    }
    currentHeading = match[2].trim();
    lastIndex = match.index + match[0].length;
  }
  
  // Remaining content after last heading
  if (lastIndex < text.length) {
    const content = text.slice(lastIndex).trim();
    if (content) {
      sections.push({ heading: currentHeading, content });
    }
  }
  
  // If no headings found, return entire text as single section
  if (sections.length === 0 && text.trim()) {
    sections.push({ heading: null, content: text.trim() });
  }
  
  return sections;
}

/**
 * Split text by paragraphs (double newlines)
 */
function splitByParagraphs(text: string): string[] {
  return text
    .split(/\n\n+/)
    .map(p => p.trim())
    .filter(p => p.length > 0);
}

/**
 * Split text by sentences
 */
function splitBySentences(text: string): string[] {
  // Split on sentence-ending punctuation followed by space or end
  const sentences = text.split(/(?<=[.!?])\s+/);
  return sentences.map(s => s.trim()).filter(s => s.length > 0);
}

/**
 * Merge small chunks together until they reach minimum size
 */
function mergeSmallChunks(
  chunks: string[],
  minTokens: number,
  maxTokens: number
): string[] {
  const merged: string[] = [];
  let current = "";
  
  for (const chunk of chunks) {
    const chunkTokens = estimateTokens(chunk);
    const currentTokens = estimateTokens(current);
    
    if (current === "") {
      current = chunk;
    } else if (currentTokens + chunkTokens <= maxTokens) {
      current = current + "\n\n" + chunk;
    } else {
      if (currentTokens >= minTokens) {
        merged.push(current);
      } else {
        // Force merge even if it exceeds max
        current = current + "\n\n" + chunk;
        continue;
      }
      current = chunk;
    }
  }
  
  if (current) {
    merged.push(current);
  }
  
  return merged;
}

/**
 * Split a large chunk into smaller pieces by sentences
 */
function splitLargeChunk(text: string, maxTokens: number): string[] {
  const sentences = splitBySentences(text);
  const chunks: string[] = [];
  let current = "";
  
  for (const sentence of sentences) {
    const sentenceTokens = estimateTokens(sentence);
    const currentTokens = estimateTokens(current);
    
    if (current === "") {
      current = sentence;
    } else if (currentTokens + sentenceTokens <= maxTokens) {
      current = current + " " + sentence;
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
  
  for (const section of sections) {
    // Include heading with content if present
    const sectionText = section.heading 
      ? `## ${section.heading}\n\n${section.content}`
      : section.content;
    
    const sectionTokens = estimateTokens(sectionText);
    
    if (sectionTokens <= opts.maxChunkTokens) {
      // Section fits in one chunk
      rawChunks.push(sectionText);
    } else {
      // Split section by paragraphs
      const paragraphs = splitByParagraphs(section.content);
      
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
  const mergedChunks = mergeSmallChunks(rawChunks, opts.minChunkTokens, opts.maxChunkTokens);
  
  // Step 4: Create final chunk objects with hashes
  let index = 0;
  for (const content of mergedChunks) {
    const normalized = normalizeText(content);
    if (normalized.length === 0) continue;
    
    chunks.push({
      content: normalized,
      index,
      tokenCount: estimateTokens(normalized),
      contentHash: generateHash(normalized),
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
