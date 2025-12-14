/**
 * Embedding metrics and debug logging utilities
 * Toggle with EMBEDDING_DEBUG=true environment variable
 */

export interface EmbeddingMetrics {
  chunksCreated: number;
  chunksEmbedded: number;
  embeddingTimeMs: number;
  embeddingCacheHits: number;
  embeddingCacheMisses: number;
  totalTextsProcessed: number;
  batchCount: number;
}

export interface IngestionMetrics extends EmbeddingMetrics {
  documentId: string;
  fetchTimeMs: number;
  chunkingTimeMs: number;
  summarizationTimeMs: number;
  entityExtractionTimeMs: number;
  totalTimeMs: number;
  startedAt: Date;
  completedAt?: Date;
}

const isDebugEnabled = () => process.env.EMBEDDING_DEBUG === "true";

class MetricsCollector {
  private currentMetrics: Partial<IngestionMetrics> | null = null;
  private timers: Map<string, number> = new Map();

  startIngestion(documentId: string): void {
    this.currentMetrics = {
      documentId,
      chunksCreated: 0,
      chunksEmbedded: 0,
      embeddingTimeMs: 0,
      embeddingCacheHits: 0,
      embeddingCacheMisses: 0,
      totalTextsProcessed: 0,
      batchCount: 0,
      fetchTimeMs: 0,
      chunkingTimeMs: 0,
      summarizationTimeMs: 0,
      entityExtractionTimeMs: 0,
      totalTimeMs: 0,
      startedAt: new Date(),
    };
    this.startTimer("total");
    this.log(`[INGEST] Starting ingestion for document: ${documentId}`);
  }

  startTimer(name: string): void {
    this.timers.set(name, performance.now());
  }

  endTimer(name: string): number {
    const start = this.timers.get(name);
    if (!start) return 0;
    const elapsed = performance.now() - start;
    this.timers.delete(name);
    return Math.round(elapsed);
  }

  recordFetchTime(): void {
    if (this.currentMetrics) {
      this.currentMetrics.fetchTimeMs = this.endTimer("fetch");
      this.log(`[INGEST] Fetch completed in ${this.currentMetrics.fetchTimeMs}ms`);
    }
  }

  recordChunking(chunkCount: number): void {
    if (this.currentMetrics) {
      this.currentMetrics.chunkingTimeMs = this.endTimer("chunking");
      this.currentMetrics.chunksCreated = chunkCount;
      this.log(`[INGEST] Created ${chunkCount} chunks in ${this.currentMetrics.chunkingTimeMs}ms`);
    }
  }

  recordSummarization(): void {
    if (this.currentMetrics) {
      this.currentMetrics.summarizationTimeMs = this.endTimer("summarization");
      this.log(`[INGEST] Summarization completed in ${this.currentMetrics.summarizationTimeMs}ms`);
    }
  }

  recordEntityExtraction(): void {
    if (this.currentMetrics) {
      this.currentMetrics.entityExtractionTimeMs = this.endTimer("entityExtraction");
      this.log(`[INGEST] Entity extraction completed in ${this.currentMetrics.entityExtractionTimeMs}ms`);
    }
  }

  recordEmbeddingBatch(textsCount: number, timeMs: number, cacheHits: number = 0): void {
    if (this.currentMetrics) {
      this.currentMetrics.batchCount = (this.currentMetrics.batchCount || 0) + 1;
      this.currentMetrics.totalTextsProcessed = (this.currentMetrics.totalTextsProcessed || 0) + textsCount;
      this.currentMetrics.embeddingTimeMs = (this.currentMetrics.embeddingTimeMs || 0) + timeMs;
      this.currentMetrics.embeddingCacheHits = (this.currentMetrics.embeddingCacheHits || 0) + cacheHits;
      this.currentMetrics.embeddingCacheMisses = (this.currentMetrics.embeddingCacheMisses || 0) + (textsCount - cacheHits);
      this.currentMetrics.chunksEmbedded = (this.currentMetrics.chunksEmbedded || 0) + (textsCount - cacheHits);
      this.log(`[EMBED] Batch ${this.currentMetrics.batchCount}: ${textsCount} texts, ${cacheHits} cache hits, ${timeMs}ms`);
    }
  }

  finishIngestion(): IngestionMetrics | null {
    if (!this.currentMetrics) return null;

    this.currentMetrics.totalTimeMs = this.endTimer("total");
    this.currentMetrics.completedAt = new Date();

    const metrics = this.currentMetrics as IngestionMetrics;
    
    this.log(`[INGEST] Completed ingestion for ${metrics.documentId}`);
    this.log(`[INGEST] Summary:`);
    this.log(`  - Chunks created: ${metrics.chunksCreated}`);
    this.log(`  - Chunks embedded: ${metrics.chunksEmbedded}`);
    this.log(`  - Cache hits: ${metrics.embeddingCacheHits}`);
    this.log(`  - Total embedding time: ${metrics.embeddingTimeMs}ms`);
    this.log(`  - Total time: ${metrics.totalTimeMs}ms`);

    this.currentMetrics = null;
    return metrics;
  }

  getMetrics(): Partial<IngestionMetrics> | null {
    return this.currentMetrics;
  }

  log(message: string): void {
    if (isDebugEnabled()) {
      console.log(`[${new Date().toISOString()}] ${message}`);
    }
  }
}

// Singleton instance
export const metricsCollector = new MetricsCollector();

// Utility function for timing async operations
export async function withTiming<T>(
  name: string,
  fn: () => Promise<T>
): Promise<{ result: T; timeMs: number }> {
  const start = performance.now();
  const result = await fn();
  const timeMs = Math.round(performance.now() - start);
  
  if (isDebugEnabled()) {
    console.log(`[${new Date().toISOString()}] [TIMING] ${name}: ${timeMs}ms`);
  }
  
  return { result, timeMs };
}
