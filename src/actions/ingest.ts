"use server";

import { db } from "@/db";
import { documents, chunks, entities, entityMentions, relationships } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { extractFromUrl, extractFromHtml, detectContentType, extractYouTubeId } from "@/lib/content/extractor";
import { chunkByParagraphs } from "@/lib/content/chunker";
import {
  generateSummary,
  generateEmbedding,
  extractEntitiesAndRelationships,
  type ExtractedEntity,
  type ExtractedRelationship,
} from "@/lib/ai";

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
 */
async function processDocument(documentId: string, content: string): Promise<void> {
  try {
    // 1. Chunk the content
    const textChunks = chunkByParagraphs(content, { maxChunkSize: 1000 });

    // 2. Generate summary
    let summary: string | null = null;
    try {
      summary = await generateSummary(content.slice(0, 8000)); // Limit for context window
    } catch (error) {
      console.error("Summary generation failed:", error);
    }

    // Update document with summary
    if (summary) {
      await db
        .update(documents)
        .set({ summary })
        .where(eq(documents.id, documentId));
    }

    // 3. Extract entities and relationships
    let extractedData: { entities: ExtractedEntity[]; relationships: ExtractedRelationship[] } = {
      entities: [],
      relationships: [],
    };
    try {
      extractedData = await extractEntitiesAndRelationships(content.slice(0, 8000));
    } catch (error) {
      console.error("Entity extraction failed:", error);
    }

    // 4. Save chunks with embeddings
    for (const chunk of textChunks) {
      let embedding: number[] | null = null;
      try {
        embedding = await generateEmbedding(chunk.content);
      } catch (error) {
        console.error("Embedding generation failed for chunk:", error);
      }

      await db.insert(chunks).values({
        documentId,
        content: chunk.content,
        chunkIndex: chunk.index,
        tokenCount: chunk.tokenCount,
        embedding,
      });
    }

    // 5. Save entities (upsert to avoid duplicates)
    const entityIdMap = new Map<string, string>(); // name -> id

    for (const entity of extractedData.entities) {
      // Check if entity already exists
      const existing = await db
        .select()
        .from(entities)
        .where(and(eq(entities.name, entity.name), eq(entities.type, entity.type)))
        .limit(1);

      let entityId: string;
      if (existing.length > 0) {
        entityId = existing[0].id;
      } else {
        // Create new entity
        let entityEmbedding: number[] | null = null;
        try {
          entityEmbedding = await generateEmbedding(entity.name + (entity.description ? `: ${entity.description}` : ""));
        } catch (error) {
          console.error("Entity embedding failed:", error);
        }

        const [newEntity] = await db
          .insert(entities)
          .values({
            name: entity.name,
            type: entity.type,
            description: entity.description,
            embedding: entityEmbedding,
          })
          .returning();
        entityId = newEntity.id;
      }

      entityIdMap.set(entity.name, entityId);

      // Create entity mention for this document
      // Link to first chunk for simplicity
      const firstChunk = await db
        .select()
        .from(chunks)
        .where(eq(chunks.documentId, documentId))
        .limit(1);

      if (firstChunk.length > 0) {
        await db.insert(entityMentions).values({
          entityId,
          chunkId: firstChunk[0].id,
          documentId,
        });
      }
    }

    // 6. Save relationships
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

    // 7. Mark document as completed
    await db
      .update(documents)
      .set({ processingStatus: "completed", updatedAt: new Date() })
      .where(eq(documents.id, documentId));

  } catch (error) {
    console.error("Document processing failed:", error);
    await db
      .update(documents)
      .set({ processingStatus: "failed", updatedAt: new Date() })
      .where(eq(documents.id, documentId));
    throw error;
  }
}
