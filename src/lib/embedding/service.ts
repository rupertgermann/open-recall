/**
 * Embedding Service - Central embedding orchestration
 * Combines caching, batching, and metrics
 */

import { getEmbeddingConfigFromDB, type EmbeddingConfig } from "@/lib/ai/config";
import { generateEmbeddings } from "@/lib/ai/client";
import { metricsCollector, withTiming } from "./metrics";
import { batchGetOrCreateEmbeddings, generateContentHash } from "./cache";

export interface EmbeddingRequest {
  text: string;
  purpose: "graph" | "retrieval";
}

export interface EmbeddingResult {
  embedding: number[];
  cached: boolean;
  contentHash: string;
}

export interface BatchEmbeddingResult {
  embeddings: number[][];
  cacheHits: number;
  cacheMisses: number;
  timeMs: number;
}

// Batching configuration
const BATCH_SIZE = 16; // Texts per batch
const MAX_CONCURRENT_BATCHES = 2; // Limit concurrent Ollama requests

/**
 * Generate embeddings with caching and metrics
 * This is the main entry point for all embedding operations
 */
export async function generateEmbeddingsWithCache(
  texts: string[],
  purpose: "graph" | "retrieval" = "retrieval"
): Promise<BatchEmbeddingResult> {
  if (texts.length === 0) {
    return { embeddings: [], cacheHits: 0, cacheMisses: 0, timeMs: 0 };
  }

  const config = await getEmbeddingConfigFromDB();
  const model = config.model;

  const { result, timeMs } = await withTiming("embeddings", async () => {
    return batchGetOrCreateEmbeddings(
      texts,
      model,
      async (textsToEmbed) => {
        // Process in batches to avoid overloading Ollama
        return processBatches(textsToEmbed, config);
      },
      purpose
    );
  });

  // Record metrics
  metricsCollector.recordEmbeddingBatch(texts.length, timeMs, result.cacheHits);

  return {
    embeddings: result.embeddings,
    cacheHits: result.cacheHits,
    cacheMisses: result.cacheMisses,
    timeMs,
  };
}

/**
 * Process texts in batches with limited concurrency
 */
async function processBatches(
  texts: string[],
  config: EmbeddingConfig
): Promise<number[][]> {
  const batches: string[][] = [];
  
  // Split into batches
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    batches.push(texts.slice(i, i + BATCH_SIZE));
  }

  const allEmbeddings: number[][] = [];
  
  // Process batches with limited concurrency
  for (let i = 0; i < batches.length; i += MAX_CONCURRENT_BATCHES) {
    const concurrentBatches = batches.slice(i, i + MAX_CONCURRENT_BATCHES);
    
    const batchResults = await Promise.all(
      concurrentBatches.map(batch => generateEmbeddings(batch, config))
    );
    
    for (const result of batchResults) {
      allEmbeddings.push(...result);
    }
  }

  return allEmbeddings;
}

/**
 * Generate a single embedding with caching
 */
export async function generateEmbeddingWithCache(
  text: string,
  purpose: "graph" | "retrieval" = "retrieval"
): Promise<EmbeddingResult> {
  const result = await generateEmbeddingsWithCache([text], purpose);
  
  return {
    embedding: result.embeddings[0],
    cached: result.cacheHits > 0,
    contentHash: generateContentHash(text),
  };
}

/**
 * Generate embeddings for graph purposes (entities, summaries)
 */
export async function generateGraphEmbeddings(
  texts: string[]
): Promise<BatchEmbeddingResult> {
  return generateEmbeddingsWithCache(texts, "graph");
}

/**
 * Generate embeddings for retrieval purposes (chunks)
 */
export async function generateRetrievalEmbeddings(
  texts: string[]
): Promise<BatchEmbeddingResult> {
  return generateEmbeddingsWithCache(texts, "retrieval");
}

/**
 * Check if document content has changed by comparing hashes
 */
export function hasContentChanged(
  newContent: string,
  existingHash: string | null
): boolean {
  if (!existingHash) return true;
  const newHash = generateContentHash(newContent);
  return newHash !== existingHash;
}

/**
 * Get the current embedding model from config
 */
export async function getCurrentEmbeddingModel(): Promise<string> {
  const config = await getEmbeddingConfigFromDB();
  return config.model;
}
