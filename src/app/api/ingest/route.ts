import { db } from "@/db";
import { documents, chunks, entities, entityMentions, relationships } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { extractFromUrl } from "@/lib/content/extractor";
import { chunkByParagraphs } from "@/lib/content/chunker";
import {
  generateSummaryWithDBConfig,
  generateEmbeddingsWithDBConfig,
  extractEntitiesWithDBConfig,
} from "@/lib/ai";

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

        // Step 3: Chunking
        controller.enqueue(encoder.encode(createSSEMessage("chunking", "Splitting content into chunks...", 25)));
        
        const textChunks = chunkByParagraphs(content, { maxChunkSize: 1000 });
        controller.enqueue(encoder.encode(createSSEMessage("chunking", `Created ${textChunks.length} chunks`, 30)));

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

        // Step 6: Generate Embeddings (batched to avoid stack overflow on large documents)
        const EMBEDDING_BATCH_SIZE = 10; // Process 10 chunks at a time
        const chunkContents = textChunks.map(chunk => chunk.content);
        const totalChunks = chunkContents.length;
        let chunkEmbeddings: number[][] = [];
        
        controller.enqueue(encoder.encode(createSSEMessage(
          "embedding", 
          `Generating embeddings for ${totalChunks} chunks...`, 
          65
        )));
        
        try {
          // Process embeddings in batches to avoid stack overflow
          for (let i = 0; i < totalChunks; i += EMBEDDING_BATCH_SIZE) {
            const batch = chunkContents.slice(i, i + EMBEDDING_BATCH_SIZE);
            const batchEmbeddings = await generateEmbeddingsWithDBConfig(batch);
            chunkEmbeddings.push(...batchEmbeddings);
            
            // Calculate progress (65% to 75% range for embedding step)
            const batchProgress = Math.min(i + EMBEDDING_BATCH_SIZE, totalChunks);
            const progressPercent = 65 + Math.round((batchProgress / totalChunks) * 10);
            
            controller.enqueue(encoder.encode(createSSEMessage(
              "embedding",
              `Embedded ${batchProgress}/${totalChunks} chunks...`,
              progressPercent
            )));
          }
          
          controller.enqueue(encoder.encode(createSSEMessage(
            "embedding", 
            `Generated ${chunkEmbeddings.length} embeddings`, 
            75
          )));
        } catch (error) {
          console.error("Embedding generation failed:", error);
          // Continue without embeddings
          controller.enqueue(encoder.encode(createSSEMessage(
            "embedding", 
            `Embedding generation failed after ${chunkEmbeddings.length}/${totalChunks} chunks`, 
            75
          )));
        }

        // Batch insert all chunks at once
        const chunkValues = textChunks.map((chunk, i) => ({
          documentId: doc.id,
          content: chunk.content,
          chunkIndex: chunk.index,
          tokenCount: chunk.tokenCount,
          embedding: chunkEmbeddings[i] ?? null,
        }));

        await db.insert(chunks).values(chunkValues);

        controller.enqueue(encoder.encode(createSSEMessage("embedding", `Saved ${textChunks.length} chunks with ${chunkEmbeddings.length} embeddings`, 80)));

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

        // Generate embeddings for new entities in batch
        if (newEntities.length > 0) {
          const entityTexts = newEntities.map(e => e.name + (e.description ? `: ${e.description}` : ""));
          let entityEmbeddings: number[][] = [];
          
          try {
            entityEmbeddings = await generateEmbeddingsWithDBConfig(entityTexts);
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
                embedding: entityEmbeddings[i] ?? null,
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
