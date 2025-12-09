import { db } from "@/db";
import { documents, chunks, entities, entityMentions, relationships } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { extractFromUrl } from "@/lib/content/extractor";
import { chunkByParagraphs } from "@/lib/content/chunker";
import {
  generateSummary,
  generateEmbedding,
  extractEntitiesAndRelationships,
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
          summary = await generateSummary(content.slice(0, 8000));
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
          entities: { name: string; type: string; description?: string }[];
          relationships: { source: string; target: string; type: string; description?: string }[];
        };
        
        try {
          extractedData = await extractEntitiesAndRelationships(content.slice(0, 8000));
          controller.enqueue(encoder.encode(createSSEMessage(
            "extracting",
            `Found ${extractedData.entities.length} entities, ${extractedData.relationships.length} relationships`,
            60
          )));
        } catch (error) {
          controller.enqueue(encoder.encode(createSSEMessage("extracting", "Entity extraction skipped (AI unavailable)", 60)));
        }

        // Step 6: Generate Embeddings
        controller.enqueue(encoder.encode(createSSEMessage("embedding", "Generating embeddings for chunks...", 65)));
        
        let embeddedCount = 0;
        for (let i = 0; i < textChunks.length; i++) {
          const chunk = textChunks[i];
          let embedding: number[] | null = null;
          
          try {
            embedding = await generateEmbedding(chunk.content);
            embeddedCount++;
          } catch (error) {
            // Continue without embedding
          }

          await db.insert(chunks).values({
            documentId: doc.id,
            content: chunk.content,
            chunkIndex: chunk.index,
            tokenCount: chunk.tokenCount,
            embedding,
          });

          const progress = 65 + Math.round((i / textChunks.length) * 15);
          controller.enqueue(encoder.encode(createSSEMessage(
            "embedding",
            `Embedded chunk ${i + 1}/${textChunks.length}`,
            progress
          )));
        }

        controller.enqueue(encoder.encode(createSSEMessage("embedding", `Embedded ${embeddedCount}/${textChunks.length} chunks`, 80)));

        // Step 7: Save Entities
        controller.enqueue(encoder.encode(createSSEMessage("saving", "Saving entities to knowledge graph...", 82)));
        
        const entityIdMap = new Map<string, string>();

        for (const entity of extractedData.entities) {
          const existing = await db
            .select()
            .from(entities)
            .where(and(eq(entities.name, entity.name), eq(entities.type, entity.type)))
            .limit(1);

          let entityId: string;
          if (existing.length > 0) {
            entityId = existing[0].id;
          } else {
            let entityEmbedding: number[] | null = null;
            try {
              entityEmbedding = await generateEmbedding(entity.name + (entity.description ? `: ${entity.description}` : ""));
            } catch (error) {
              // Continue without embedding
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

          // Create entity mention
          const firstChunk = await db
            .select()
            .from(chunks)
            .where(eq(chunks.documentId, doc.id))
            .limit(1);

          if (firstChunk.length > 0) {
            await db.insert(entityMentions).values({
              entityId,
              chunkId: firstChunk[0].id,
              documentId: doc.id,
            });
          }
        }

        controller.enqueue(encoder.encode(createSSEMessage("saving", `Saved ${extractedData.entities.length} entities`, 88)));

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
