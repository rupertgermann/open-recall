"use server";

import { db } from "@/db";
import { documents, chunks, entities, entityMentions, relationships } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { extractFromUrl, detectContentType } from "@/lib/content/extractor";
import {
  generateSummaryWithDBConfig,
  extractEntitiesWithDBConfig,
  generateTagsWithDBConfig,
  type ExtractedEntity,
  type ExtractedRelationship,
} from "@/lib/ai";
import { updateDocumentTags } from "@/actions/documents";
import {
  chunkStructured,
  generateRetrievalEmbeddings,
  generateGraphEmbeddings,
  generateContentHash,
  metricsCollector,
  getCurrentEmbeddingModel,
  hasContentChanged,
} from "@/lib/embedding";

export type IngestProgress = {
  step: "fetching" | "chunking" | "summarizing" | "extracting" | "embedding" | "saving" | "complete" | "error";
  message: string;
  progress?: number;
};

export type IngestResult = {
  success: boolean;
  documentId?: string;
  error?: string;
};

/**
 * Ingest content from a URL
 */
export async function ingestUrl(url: string): Promise<IngestResult> {
  try {
    // Detect content type
    const contentType = detectContentType(url);

    // For YouTube, we'd need transcript API - for now, treat as article
    if (contentType === "youtube") {
      // TODO: Implement YouTube transcript fetching
      // For MVP, we'll just extract the page content
    }

    // Fetch and extract content
    const extracted = await extractFromUrl(url);
    if (!extracted) {
      return { success: false, error: "Failed to extract content from URL" };
    }

    // Create document
    const [doc] = await db
      .insert(documents)
      .values({
        url,
        title: extracted.title,
        type: contentType === "youtube" ? "youtube" : "article",
        content: extracted.content,
        processingStatus: "processing",
      })
      .returning();

    // Process in background (for MVP, we do it synchronously)
    await processDocument(doc.id, extracted.content);

    revalidatePath("/library");
    return { success: true, documentId: doc.id };
  } catch (error) {
    console.error("Ingest URL error:", error);
    return { success: false, error: String(error) };
  }
}

/**
 * Ingest raw text content
 */
export async function ingestText(title: string, content: string): Promise<IngestResult> {
  try {
    // Create document
    const [doc] = await db
      .insert(documents)
      .values({
        title,
        type: "note",
        content,
        processingStatus: "processing",
      })
      .returning();

    // Process document
    await processDocument(doc.id, content);

    revalidatePath("/library");
    return { success: true, documentId: doc.id };
  } catch (error) {
    console.error("Ingest text error:", error);
    return { success: false, error: String(error) };
  }
}

/**
 * Process a document: chunk, summarize, extract entities, embed
 * Implements all phases of the embedding performance plan
 */
async function processDocument(documentId: string, content: string): Promise<void> {
  // Start metrics collection
  metricsCollector.startIngestion(documentId);
  
  try {
    // Get current embedding model for tracking
    const embeddingModel = await getCurrentEmbeddingModel();
    const contentHash = generateContentHash(content);
    
    // Phase 8: Check if document content has changed
    const [existingDoc] = await db
      .select({ contentHash: documents.contentHash, embeddingModel: documents.embeddingModel })
      .from(documents)
      .where(eq(documents.id, documentId))
      .limit(1);
    
    const needsReprocessing = !existingDoc?.contentHash || 
      hasContentChanged(content, existingDoc.contentHash) ||
      existingDoc.embeddingModel !== embeddingModel;
    
    if (!needsReprocessing) {
      metricsCollector.log(`[INGEST] Document ${documentId} unchanged, skipping reprocessing`);
      await db
        .update(documents)
        .set({ processingStatus: "completed", updatedAt: new Date() })
        .where(eq(documents.id, documentId));
      metricsCollector.finishIngestion();
      return;
    }

    // Phase 1: Structure-aware chunking
    metricsCollector.startTimer("chunking");
    const textChunks = chunkStructured(content, {
      minChunkTokens: 100,
      maxChunkTokens: 800,
      targetChunkTokens: 500,
    });
    metricsCollector.recordChunking(textChunks.length);

    // Phase 2: Filter out duplicate chunks by hash
    const uniqueChunks: typeof textChunks = [];
    const seenHashes = new Set<string>();
    
    for (const chunk of textChunks) {
      if (!seenHashes.has(chunk.contentHash)) {
        seenHashes.add(chunk.contentHash);
        uniqueChunks.push(chunk);
      }
    }
    metricsCollector.log(`[INGEST] Deduplicated ${textChunks.length} -> ${uniqueChunks.length} chunks`);

    // Phase 5: Generate summary (for graph construction)
    metricsCollector.startTimer("summarization");
    let summary: string | null = null;
    try {
      summary = await generateSummaryWithDBConfig(content.slice(0, 8000));
    } catch (error) {
      console.error("Summary generation failed:", error);
    }
    metricsCollector.recordSummarization();

    // Update document with summary and hash
    await db
      .update(documents)
      .set({ 
        summary,
        contentHash,
        embeddingModel,
        embeddingVersion: "1.0",
      })
      .where(eq(documents.id, documentId));

    try {
      const tagText = (summary || content).slice(0, 8000);
      const aiTags = await generateTagsWithDBConfig({ title: document.title, summary, content: tagText });
      if (aiTags.length > 0) {
        await updateDocumentTags(documentId, aiTags);
      }
    } catch (error) {
      console.error("Tag generation failed:", error);
    }

    // Phase 5: Extract entities from summary (not raw text) for efficiency
    metricsCollector.startTimer("entityExtraction");
    let extractedData: { entities: ExtractedEntity[]; relationships: ExtractedRelationship[] } = {
      entities: [],
      relationships: [],
    };
    try {
      // Use summary for entity extraction if available, otherwise use truncated content
      const textForExtraction = summary || content.slice(0, 8000);
      extractedData = await extractEntitiesWithDBConfig(textForExtraction);
    } catch (error) {
      console.error("Entity extraction failed:", error);
    }
    metricsCollector.recordEntityExtraction();

    // Phase 3 & 6: Generate embeddings with caching and batching
    // Phase 4: Use retrieval embeddings for chunks
    const chunkContents = uniqueChunks.map((chunk: { content: string }) => chunk.content);
    let chunkEmbeddingResult = { embeddings: [] as number[][], cacheHits: 0, cacheMisses: 0, timeMs: 0 };
    
    try {
      chunkEmbeddingResult = await generateRetrievalEmbeddings(chunkContents);
    } catch (error) {
      console.error("Chunk embedding generation failed:", error);
    }

    // Phase 7: Save chunks with embedding status
    const chunkValues = uniqueChunks.map((chunk: { content: string; contentHash: string; index: number; tokenCount: number }, i: number) => ({
      documentId,
      content: chunk.content,
      contentHash: chunk.contentHash,
      chunkIndex: chunk.index,
      tokenCount: chunk.tokenCount,
      embedding: chunkEmbeddingResult.embeddings[i] ?? null,
      embeddingStatus: chunkEmbeddingResult.embeddings[i] ? "embedded" : "pending",
      embeddingPurpose: "retrieval" as const,
    }));

    if (chunkValues.length > 0) {
      await db.insert(chunks).values(chunkValues);
    }

    // Process entities with graph embeddings (Phase 4)
    const entityIdMap = new Map<string, string>();
    
    const newEntities: ExtractedEntity[] = [];
    for (const entity of extractedData.entities) {
      const existing = await db
        .select()
        .from(entities)
        .where(and(eq(entities.name, entity.name), eq(entities.type, entity.type)))
        .limit(1);

      if (existing.length > 0) {
        entityIdMap.set(entity.name, existing[0].id);
      } else {
        newEntities.push(entity);
      }
    }

    // Phase 4: Generate graph embeddings for new entities
    if (newEntities.length > 0) {
      const entityTexts = newEntities.map(e => e.name + (e.description ? `: ${e.description}` : ""));
      let entityEmbeddingResult = { embeddings: [] as number[][], cacheHits: 0, cacheMisses: 0, timeMs: 0 };
      
      try {
        entityEmbeddingResult = await generateGraphEmbeddings(entityTexts);
      } catch (error) {
        console.error("Entity embedding failed:", error);
      }

      for (let i = 0; i < newEntities.length; i++) {
        const entity = newEntities[i];
        const [newEntity] = await db
          .insert(entities)
          .values({
            name: entity.name,
            type: entity.type,
            description: entity.description,
            embedding: entityEmbeddingResult.embeddings[i] ?? null,
          })
          .returning();
        entityIdMap.set(entity.name, newEntity.id);
      }
    }

    // Create entity mentions
    const firstChunk = await db
      .select()
      .from(chunks)
      .where(eq(chunks.documentId, documentId))
      .limit(1);

    if (firstChunk.length > 0) {
      const mentionValues = Array.from(entityIdMap.values()).map(entityId => ({
        entityId,
        chunkId: firstChunk[0].id,
        documentId,
      }));
      
      if (mentionValues.length > 0) {
        await db.insert(entityMentions).values(mentionValues);
      }
    }

    // Save relationships
    for (const rel of extractedData.relationships) {
      const sourceId = entityIdMap.get(rel.source);
      const targetId = entityIdMap.get(rel.target);

      if (sourceId && targetId) {
        await db.insert(relationships).values({
          sourceEntityId: sourceId,
          targetEntityId: targetId,
          relationType: rel.type,
          description: rel.description,
          sourceDocumentId: documentId,
        });
      }
    }

    // Mark document as completed
    await db
      .update(documents)
      .set({ processingStatus: "completed", updatedAt: new Date() })
      .where(eq(documents.id, documentId));

    // Finish metrics collection
    metricsCollector.finishIngestion();

  } catch (error) {
    console.error("Document processing failed:", error);
    await db
      .update(documents)
      .set({ processingStatus: "failed", updatedAt: new Date() })
      .where(eq(documents.id, documentId));
    metricsCollector.finishIngestion();
    throw error;
  }
}
