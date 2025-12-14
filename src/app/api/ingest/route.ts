import { db } from "@/db";
import { documents, chunks, entities, entityMentions, relationships } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { extractFromUrl } from "@/lib/content/extractor";
import {
  generateSummaryWithDBConfig,
  extractEntitiesWithDBConfig,
} from "@/lib/ai";
import {
  chunkStructured,
  generateRetrievalEmbeddings,
  generateGraphEmbeddings,
  generateContentHash,
  metricsCollector,
  type StructuredChunk,
} from "@/lib/embedding";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type IngestRequest = {
  type: "url" | "text";
  url?: string;
  title?: string;
  content?: string;
};

function createSSEMessage(step: string, message: string, progress?: number, error?: boolean) {
  return `data: ${JSON.stringify({ step, message, progress, error })}\n\n`;
}

export async function POST(req: Request) {
  const body: IngestRequest = await req.json();

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        // Step 1: Fetching/Validating
        controller.enqueue(encoder.encode(createSSEMessage("fetching", "Fetching content...", 5)));

        let title: string;
        let content: string;
        let url: string | null = null;
        let contentType: string;

        if (body.type === "url") {
          url = body.url!;
          controller.enqueue(encoder.encode(createSSEMessage("fetching", `Extracting content from ${url}...`, 10)));
          
          const extracted = await extractFromUrl(url);
          if (!extracted) {
            controller.enqueue(encoder.encode(createSSEMessage("error", "Failed to extract content from URL", 0, true)));
            controller.close();
            return;
          }
          
          title = extracted.title;
          content = extracted.content;
          contentType = url.includes("youtube.com") || url.includes("youtu.be") ? "youtube" : "article";
        } else {
          title = body.title!;
          content = body.content!;
          contentType = "note";
        }

        controller.enqueue(encoder.encode(createSSEMessage("fetching", `Content extracted: "${title.slice(0, 50)}..."`, 15)));

        // Step 2: Create document record
        controller.enqueue(encoder.encode(createSSEMessage("saving", "Creating document record...", 20)));
        
        const [doc] = await db
          .insert(documents)
          .values({
            url,
            title,
            type: contentType,
            content,
            processingStatus: "processing",
          })
          .returning();

        // Step 3: Structure-aware chunking (Phase 1)
        controller.enqueue(encoder.encode(createSSEMessage("chunking", "Splitting content into chunks...", 25)));
        
        const textChunks = chunkStructured(content, {
          minChunkTokens: 100,
          maxChunkTokens: 800,
          targetChunkTokens: 500,
        });
        
        // Phase 2: Deduplicate chunks by hash
        const uniqueChunks: StructuredChunk[] = [];
        const seenHashes = new Set<string>();
        for (const chunk of textChunks) {
          if (!seenHashes.has(chunk.contentHash)) {
            seenHashes.add(chunk.contentHash);
            uniqueChunks.push(chunk);
          }
        }
        
        const dedupeMsg = textChunks.length !== uniqueChunks.length 
          ? ` (${textChunks.length - uniqueChunks.length} duplicates removed)`
          : "";
        controller.enqueue(encoder.encode(createSSEMessage("chunking", `Created ${uniqueChunks.length} chunks${dedupeMsg}`, 30)));

        // Step 4: Summarization
        controller.enqueue(encoder.encode(createSSEMessage("summarizing", "Generating AI summary...", 35)));
        
        let summary: string | null = null;
        try {
          summary = await generateSummaryWithDBConfig(content.slice(0, 8000));
          controller.enqueue(encoder.encode(createSSEMessage("summarizing", "Summary generated successfully", 45)));
          
          await db
            .update(documents)
            .set({ summary })
            .where(eq(documents.id, doc.id));
        } catch (error) {
          controller.enqueue(encoder.encode(createSSEMessage("summarizing", "Summary generation skipped (AI unavailable)", 45)));
        }

        // Step 5: Entity Extraction
        controller.enqueue(encoder.encode(createSSEMessage("extracting", "Extracting entities and relationships...", 50)));
        
        let extractedData = { entities: [], relationships: [] } as {
          entities: { name: string; type: string; description: string | null }[];
          relationships: { source: string; target: string; type: string; description: string | null }[];
        };
        
        try {
          extractedData = await extractEntitiesWithDBConfig(content.slice(0, 8000));
          controller.enqueue(encoder.encode(createSSEMessage(
            "extracting",
            `Found ${extractedData.entities.length} entities, ${extractedData.relationships.length} relationships`,
            60
          )));
        } catch (error) {
          controller.enqueue(encoder.encode(createSSEMessage("extracting", "Entity extraction skipped (AI unavailable)", 60)));
        }

        // Step 6: Generate Embeddings with caching (Phase 3 & 6)
        const chunkContents = uniqueChunks.map(chunk => chunk.content);
        const totalChunks = chunkContents.length;
        
        controller.enqueue(encoder.encode(createSSEMessage(
          "embedding", 
          `Generating embeddings for ${totalChunks} chunks (with caching)...`, 
          65
        )));
        
        let chunkEmbeddingResult = { embeddings: [] as number[][], cacheHits: 0, cacheMisses: 0, timeMs: 0 };
        
        try {
          // Use new batched + cached embedding service
          const startTime = Date.now();
          chunkEmbeddingResult = await generateRetrievalEmbeddings(chunkContents);
          const elapsedMs = Date.now() - startTime;
          
          const cacheMsg = chunkEmbeddingResult.cacheHits > 0 
            ? ` (${chunkEmbeddingResult.cacheHits} from cache)`
            : "";
          
          controller.enqueue(encoder.encode(createSSEMessage(
            "embedding", 
            `Generated ${chunkEmbeddingResult.embeddings.length} embeddings in ${elapsedMs}ms${cacheMsg}`, 
            75
          )));
        } catch (error) {
          console.error("Embedding generation failed:", error);
          controller.enqueue(encoder.encode(createSSEMessage(
            "embedding", 
            `Embedding generation failed`, 
            75
          )));
        }

        // Batch insert all chunks with new schema fields
        const chunkValues = uniqueChunks.map((chunk, i) => ({
          documentId: doc.id,
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

        controller.enqueue(encoder.encode(createSSEMessage("embedding", `Saved ${uniqueChunks.length} chunks`, 80)));

        // Step 7: Save Entities (optimized with batch processing)
        controller.enqueue(encoder.encode(createSSEMessage("saving", "Saving entities to knowledge graph...", 82)));
        
        const entityIdMap = new Map<string, string>();
        
        // First, check which entities already exist
        const newEntities: typeof extractedData.entities = [];
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

        // Generate graph embeddings for new entities (Phase 4)
        if (newEntities.length > 0) {
          const entityTexts = newEntities.map(e => e.name + (e.description ? `: ${e.description}` : ""));
          let entityEmbeddingResult = { embeddings: [] as number[][], cacheHits: 0, cacheMisses: 0, timeMs: 0 };
          
          try {
            entityEmbeddingResult = await generateGraphEmbeddings(entityTexts);
          } catch (error) {
            // Continue without embeddings
          }

          // Insert new entities
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

        // Create entity mentions (batch query for first chunk)
        const firstChunk = await db
          .select()
          .from(chunks)
          .where(eq(chunks.documentId, doc.id))
          .limit(1);

        if (firstChunk.length > 0) {
          const mentionValues = Array.from(entityIdMap.values()).map(entityId => ({
            entityId,
            chunkId: firstChunk[0].id,
            documentId: doc.id,
          }));
          
          if (mentionValues.length > 0) {
            await db.insert(entityMentions).values(mentionValues);
          }
        }

        controller.enqueue(encoder.encode(createSSEMessage("saving", `Saved ${newEntities.length} new entities (${extractedData.entities.length - newEntities.length} existing)`, 88)));

        // Step 8: Save Relationships
        controller.enqueue(encoder.encode(createSSEMessage("saving", "Saving relationships...", 90)));
        
        for (const rel of extractedData.relationships) {
          const sourceId = entityIdMap.get(rel.source);
          const targetId = entityIdMap.get(rel.target);

          if (sourceId && targetId) {
            await db.insert(relationships).values({
              sourceEntityId: sourceId,
              targetEntityId: targetId,
              relationType: rel.type,
              description: rel.description,
              sourceDocumentId: doc.id,
            });
          }
        }

        controller.enqueue(encoder.encode(createSSEMessage("saving", `Saved ${extractedData.relationships.length} relationships`, 95)));

        // Step 9: Mark complete
        await db
          .update(documents)
          .set({ processingStatus: "completed", updatedAt: new Date() })
          .where(eq(documents.id, doc.id));

        controller.enqueue(encoder.encode(createSSEMessage("complete", "Document processed successfully!", 100)));
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ step: "done", documentId: doc.id })}\n\n`));
        controller.close();

      } catch (error) {
        console.error("Ingestion error:", error);
        controller.enqueue(encoder.encode(createSSEMessage(
          "error",
          error instanceof Error ? error.message : "An unexpected error occurred",
          0,
          true
        )));
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
}
