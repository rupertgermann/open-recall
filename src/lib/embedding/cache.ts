/**
 * Central embedding cache - Phase 3
 * Provides getOrCreateEmbedding functionality with content-hash based deduplication
 */

import { db } from "@/db";
import { embeddingCache } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { createHash } from "crypto";
import { metricsCollector } from "./metrics";

export interface CachedEmbedding {
  id: string;
  contentHash: string;
  model: string;
  embedding: number[];
  purpose: "graph" | "retrieval";
  createdAt: Date;
}

/**
 * Generate SHA-256 hash of normalized text content
 */
export function generateContentHash(text: string): string {
  const normalized = normalizeText(text);
  return createHash("sha256").update(normalized).digest("hex");
}

/**
 * Normalize text for consistent hashing
 * - Trim whitespace
 * - Collapse multiple whitespace to single space
 * - Lowercase for case-insensitive matching
 */
export function normalizeText(text: string): string {
  return text
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

/**
 * Get embedding from cache or return null if not found
 */
export async function getCachedEmbedding(
  contentHash: string,
  model: string,
  purpose: "graph" | "retrieval" = "retrieval"
): Promise<number[] | null> {
  try {
    const [cached] = await db
      .select()
      .from(embeddingCache)
      .where(
        and(
          eq(embeddingCache.contentHash, contentHash),
          eq(embeddingCache.model, model),
          eq(embeddingCache.purpose, purpose)
        )
      )
      .limit(1);

    return cached?.embedding ?? null;
  } catch (error) {
    metricsCollector.log(`[CACHE] Error fetching cached embedding: ${error}`);
    return null;
  }
}

/**
 * Store embedding in cache
 */
export async function cacheEmbedding(
  contentHash: string,
  model: string,
  embedding: number[],
  purpose: "graph" | "retrieval" = "retrieval"
): Promise<string> {
  try {
    const [inserted] = await db
      .insert(embeddingCache)
      .values({
        contentHash,
        model,
        embedding,
        purpose,
      })
      .onConflictDoNothing()
      .returning({ id: embeddingCache.id });

    return inserted?.id ?? "";
  } catch (error) {
    metricsCollector.log(`[CACHE] Error caching embedding: ${error}`);
    throw error;
  }
}

/**
 * Get or create embedding - main cache interface
 * Returns cached embedding if exists, otherwise generates and caches new one
 */
export async function getOrCreateEmbedding(
  text: string,
  model: string,
  generateFn: (text: string) => Promise<number[]>,
  purpose: "graph" | "retrieval" = "retrieval"
): Promise<{ embedding: number[]; cached: boolean }> {
  const contentHash = generateContentHash(text);
  
  // Try cache first
  const cached = await getCachedEmbedding(contentHash, model, purpose);
  if (cached) {
    return { embedding: cached, cached: true };
  }

  // Generate new embedding
  const embedding = await generateFn(text);
  
  // Cache it
  await cacheEmbedding(contentHash, model, embedding, purpose);
  
  return { embedding, cached: false };
}

/**
 * Batch get or create embeddings
 * Optimized for bulk operations - checks cache for all texts first,
 * then generates only missing embeddings in batch
 */
export async function batchGetOrCreateEmbeddings(
  texts: string[],
  model: string,
  generateFn: (texts: string[]) => Promise<number[][]>,
  purpose: "graph" | "retrieval" = "retrieval"
): Promise<{ embeddings: number[][]; cacheHits: number; cacheMisses: number }> {
  if (texts.length === 0) {
    return { embeddings: [], cacheHits: 0, cacheMisses: 0 };
  }

  // Generate hashes for all texts
  const hashMap = new Map<string, { index: number; text: string }>();
  const hashes: string[] = [];
  
  texts.forEach((text, index) => {
    const hash = generateContentHash(text);
    hashes.push(hash);
    hashMap.set(hash, { index, text });
  });

  // Check cache for all hashes
  const results: (number[] | null)[] = new Array(texts.length).fill(null);
  let cacheHits = 0;

  // Batch query cache
  try {
    const cachedEntries = await db
      .select()
      .from(embeddingCache)
      .where(
        and(
          eq(embeddingCache.model, model),
          eq(embeddingCache.purpose, purpose)
        )
      );

    // Build lookup map
    const cacheMap = new Map<string, number[]>();
    for (const entry of cachedEntries) {
      cacheMap.set(entry.contentHash, entry.embedding);
    }

    // Check each hash against cache
    for (let i = 0; i < hashes.length; i++) {
      const cached = cacheMap.get(hashes[i]);
      if (cached) {
        results[i] = cached;
        cacheHits++;
      }
    }
  } catch (error) {
    metricsCollector.log(`[CACHE] Error batch fetching cached embeddings: ${error}`);
  }

  // Collect texts that need embedding
  const textsToEmbed: { index: number; text: string; hash: string }[] = [];
  for (let i = 0; i < texts.length; i++) {
    if (results[i] === null) {
      textsToEmbed.push({ index: i, text: texts[i], hash: hashes[i] });
    }
  }

  // Generate missing embeddings
  if (textsToEmbed.length > 0) {
    const newEmbeddings = await generateFn(textsToEmbed.map(t => t.text));
    
    // Store in results and cache
    for (let i = 0; i < textsToEmbed.length; i++) {
      const { index, hash } = textsToEmbed[i];
      results[index] = newEmbeddings[i];
      
      // Cache the new embedding (fire and forget for performance)
      cacheEmbedding(hash, model, newEmbeddings[i], purpose).catch(err => {
        metricsCollector.log(`[CACHE] Error caching embedding: ${err}`);
      });
    }
  }

  return {
    embeddings: results as number[][],
    cacheHits,
    cacheMisses: textsToEmbed.length,
  };
}
