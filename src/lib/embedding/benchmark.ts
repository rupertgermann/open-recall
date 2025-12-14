/**
 * Embedding Performance Benchmarking - Phase 9
 * Tools for validating embedding performance improvements
 */

import { db } from "@/db";
import { documents, chunks, embeddingCache, entities } from "@/db/schema";
import { count, sql, eq } from "drizzle-orm";

export interface BenchmarkStats {
  totalDocuments: number;
  totalChunks: number;
  totalEmbeddings: number;
  cachedEmbeddings: number;
  pendingEmbeddings: number;
  embeddedChunks: number;
  uniqueContentHashes: number;
  duplicateChunksAvoided: number;
  cacheHitRate: number;
  avgChunksPerDocument: number;
  avgTokensPerChunk: number;
}

export interface IngestionBenchmark {
  documentId: string;
  documentTitle: string;
  contentLength: number;
  chunksCreated: number;
  chunksEmbedded: number;
  cacheHits: number;
  totalTimeMs: number;
  embeddingTimeMs: number;
  timestamp: Date;
}

/**
 * Get current embedding statistics
 */
export async function getEmbeddingStats(): Promise<BenchmarkStats> {
  // Total documents
  const [docCount] = await db.select({ count: count() }).from(documents);
  
  // Total chunks
  const [chunkCount] = await db.select({ count: count() }).from(chunks);
  
  // Cached embeddings
  const [cacheCount] = await db.select({ count: count() }).from(embeddingCache);
  
  // Chunks with embeddings vs pending
  const [embeddedCount] = await db
    .select({ count: count() })
    .from(chunks)
    .where(eq(chunks.embeddingStatus, "embedded"));
  
  const [pendingCount] = await db
    .select({ count: count() })
    .from(chunks)
    .where(eq(chunks.embeddingStatus, "pending"));
  
  // Unique content hashes in chunks
  const uniqueHashes = await db
    .selectDistinct({ hash: chunks.contentHash })
    .from(chunks)
    .where(sql`${chunks.contentHash} IS NOT NULL`);
  
  // Calculate stats
  const totalChunks = Number(chunkCount?.count) || 0;
  const totalEmbeddings = Number(cacheCount?.count) || 0;
  const embeddedChunks = Number(embeddedCount?.count) || 0;
  const pendingEmbeddings = Number(pendingCount?.count) || 0;
  const uniqueContentHashes = uniqueHashes.length;
  const duplicateChunksAvoided = totalChunks - uniqueContentHashes;
  
  // Cache hit rate (if we have cache entries)
  const cacheHitRate = totalEmbeddings > 0 
    ? (totalEmbeddings - embeddedChunks) / totalEmbeddings 
    : 0;
  
  // Average chunks per document
  const totalDocs = Number(docCount?.count) || 1;
  const avgChunksPerDocument = totalChunks / totalDocs;
  
  // Average tokens per chunk
  const [avgTokens] = await db
    .select({ avg: sql<number>`AVG(${chunks.tokenCount})` })
    .from(chunks);
  
  return {
    totalDocuments: totalDocs,
    totalChunks,
    totalEmbeddings,
    cachedEmbeddings: totalEmbeddings,
    pendingEmbeddings,
    embeddedChunks,
    uniqueContentHashes,
    duplicateChunksAvoided,
    cacheHitRate,
    avgChunksPerDocument,
    avgTokensPerChunk: Number(avgTokens?.avg) || 0,
  };
}

/**
 * Get entity embedding statistics
 */
export async function getEntityEmbeddingStats() {
  const [totalEntities] = await db.select({ count: count() }).from(entities);
  
  const [entitiesWithEmbeddings] = await db
    .select({ count: count() })
    .from(entities)
    .where(sql`${entities.embedding} IS NOT NULL`);
  
  return {
    totalEntities: Number(totalEntities?.count) || 0,
    entitiesWithEmbeddings: Number(entitiesWithEmbeddings?.count) || 0,
    entitiesWithoutEmbeddings: (Number(totalEntities?.count) || 0) - (Number(entitiesWithEmbeddings?.count) || 0),
  };
}

/**
 * Format benchmark stats for display
 */
export function formatBenchmarkStats(stats: BenchmarkStats): string {
  return `
=== Embedding Performance Stats ===
Documents: ${stats.totalDocuments}
Total Chunks: ${stats.totalChunks}
Unique Content Hashes: ${stats.uniqueContentHashes}
Duplicate Chunks Avoided: ${stats.duplicateChunksAvoided}
Cached Embeddings: ${stats.cachedEmbeddings}
Embedded Chunks: ${stats.embeddedChunks}
Pending Embeddings: ${stats.pendingEmbeddings}
Cache Hit Rate: ${(stats.cacheHitRate * 100).toFixed(1)}%
Avg Chunks/Document: ${stats.avgChunksPerDocument.toFixed(1)}
Avg Tokens/Chunk: ${stats.avgTokensPerChunk.toFixed(0)}
===================================
`.trim();
}

/**
 * Compare before/after stats
 */
export function compareBenchmarks(
  before: BenchmarkStats,
  after: BenchmarkStats
): {
  embeddingReduction: number;
  timeImprovement: number;
  cacheEfficiency: number;
} {
  const embeddingReduction = before.totalEmbeddings > 0
    ? ((before.totalEmbeddings - after.totalEmbeddings) / before.totalEmbeddings) * 100
    : 0;
  
  const cacheEfficiency = after.cacheHitRate * 100;
  
  return {
    embeddingReduction,
    timeImprovement: 0, // Would need timing data
    cacheEfficiency,
  };
}
