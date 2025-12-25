import { db } from "@/db";
import { documents, chunks, entities, entityMentions, relationships } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { extractFromUrl } from "@/lib/content/extractor";
import { detectContentType } from "@/lib/content/extractor";
import {
  generateSummaryWithDBConfig,
  extractEntitiesWithDBConfig,
  generateTagsWithDBConfig,
} from "@/lib/ai";
import { updateDocumentTags } from "@/actions/documents";
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

type UpdateRequest = {
  documentId: string;
};

function createSSEMessage(step: string, message: string, progress?: number, error?: boolean) {
  return `data: ${JSON.stringify({ step, message, progress, error })}\n\n`;
}

export async function POST(req: Request) {
  const body: UpdateRequest = await req.json();

  if (!body.documentId) {
    return new Response("Missing documentId", { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        // Step 1: Validate document
        controller.enqueue(encoder.encode(createSSEMessage("fetching", "Validating document...", 5)));

        const [doc] = await db
          .select({ id: documents.id, url: documents.url })
          .from(documents)
          .where(eq(documents.id, body.documentId))
          .limit(1);

        if (!doc) {
          controller.enqueue(encoder.encode(createSSEMessage("error", "Document not found", 0, true)));
          return;
        }

        if (!doc.url) {
          controller.enqueue(encoder.encode(createSSEMessage("error", "Document has no source URL", 0, true)));
          return;
        }

        // Step 2: Fetch content
        controller.enqueue(encoder.encode(createSSEMessage("fetching", "Fetching content from source...", 15)));

        const extracted = await extractFromUrl(doc.url);
        if (!extracted) {
          controller.enqueue(encoder.encode(createSSEMessage("error", "Failed to extract content from URL", 0, true)));
          return;
        }

        // Step 3: Update document
        controller.enqueue(encoder.encode(createSSEMessage("updating", "Updating document content...", 25)));

        const contentType = detectContentType(doc.url);
        await db
          .update(documents)
          .set({
            title: extracted.title,
            type: contentType === "youtube" ? "youtube" : "article",
            content: extracted.content,
            processingStatus: "processing",
            updatedAt: new Date(),
          })
          .where(eq(documents.id, body.documentId));

        // Step 4: Chunking
        controller.enqueue(encoder.encode(createSSEMessage("chunking", "Chunking text...", 35)));

        const structuredChunks = await chunkStructured(extracted.content);
        const contentHashes = structuredChunks.map(chunk => generateContentHash(chunk.content));

        // Delete existing chunks and related data
        await db.delete(chunks).where(eq(chunks.documentId, body.documentId));
        await db.delete(entityMentions).where(eq(entityMentions.documentId, body.documentId));
        await db.delete(relationships).where(eq(relationships.sourceDocumentId, body.documentId));

        // Insert new chunks
        const chunkInserts = structuredChunks.map((chunk, index) => ({
          documentId: body.documentId,
          content: chunk.content,
          contentHash: contentHashes[index],
          chunkIndex: index,
          tokenCount: chunk.tokenCount,
          embeddingStatus: "pending" as const,
          embeddingPurpose: "retrieval" as const,
        }));

        await db.insert(chunks).values(chunkInserts);

        // Step 5: Summarizing
        controller.enqueue(encoder.encode(createSSEMessage("summarizing", "Generating summary...", 45)));

        const summary = await generateSummaryWithDBConfig(extracted.content);
        await db
          .update(documents)
          .set({ summary })
          .where(eq(documents.id, body.documentId));

        // Step 6: Entity extraction
        controller.enqueue(encoder.encode(createSSEMessage("extracting", "Extracting entities and relationships...", 55)));

        const extractedData = await extractEntitiesWithDBConfig(extracted.content);
        const uniqueExtractedEntities = Array.from(
          new Map(extractedData.entities.map(e => [`${e.name}||${e.type}`, e])).values()
        );

        // Process entities with graph embeddings
        const entityIdMap = new Map<string, string>();

        const resolveEntityIdByName = (name: string): string | undefined => {
          let foundId: string | undefined;
          for (const [key, id] of entityIdMap.entries()) {
            const [keyName] = key.split("||");
            if (keyName !== name) continue;
            if (foundId && foundId !== id) return undefined;
            foundId = id;
          }
          return foundId;
        };

        // Check which entities already exist
        const newEntities: typeof extractedData.entities = [];
        for (const entity of uniqueExtractedEntities) {
          const existing = await db
            .select()
            .from(entities)
            .where(and(eq(entities.name, entity.name), eq(entities.type, entity.type)))
            .limit(1);

          if (existing.length > 0) {
            entityIdMap.set(`${entity.name}||${entity.type}`, existing[0].id);
          } else {
            newEntities.push(entity);
          }
        }

        // Generate graph embeddings for new entities
        if (newEntities.length > 0) {
          const entityTexts = newEntities.map(e => e.name + (e.description ? `: ${e.description}` : ""));
          let entityEmbeddingResult = { embeddings: [] as number[][], cacheHits: 0, cacheMisses: 0, timeMs: 0 };
          
          try {
            entityEmbeddingResult = await generateGraphEmbeddings(entityTexts);
          } catch (error) {
            console.error("Failed to generate entity embeddings:", error);
          }

          // Insert new entities
          for (let i = 0; i < newEntities.length; i++) {
            const entity = newEntities[i];
            const inserted = await db
              .insert(entities)
              .values({
                name: entity.name,
                type: entity.type,
                description: entity.description,
                embedding: entityEmbeddingResult.embeddings[i] ?? null,
              })
              .onConflictDoNothing({ target: [entities.name, entities.type] })
              .returning();

            if (inserted.length > 0) {
              entityIdMap.set(`${entity.name}||${entity.type}`, inserted[0].id);
            } else {
              const existing = await db
                .select({ id: entities.id })
                .from(entities)
                .where(and(eq(entities.name, entity.name), eq(entities.type, entity.type)))
                .limit(1);

              if (existing.length > 0) {
                entityIdMap.set(`${entity.name}||${entity.type}`, existing[0].id);
              }
            }
          }
        }

        // Create entity mentions
        const firstChunk = await db
          .select()
          .from(chunks)
          .where(eq(chunks.documentId, body.documentId))
          .limit(1);

        if (firstChunk.length > 0) {
          const mentionInserts = extractedData.entities.map((entity) => ({
            documentId: body.documentId,
            chunkId: firstChunk[0].id,
            entityId: entityIdMap.get(`${entity.name}||${entity.type}`)!,
          }));

          await db.insert(entityMentions).values(mentionInserts);
        }

        // Save relationships
        for (const rel of extractedData.relationships) {
          const sourceId = resolveEntityIdByName(rel.source);
          const targetId = resolveEntityIdByName(rel.target);

          if (sourceId && targetId) {
            await db.insert(relationships).values({
              sourceEntityId: sourceId,
              targetEntityId: targetId,
              relationType: rel.type,
              description: rel.description,
              sourceDocumentId: body.documentId,
            });
          }
        }

        // Step 7: Embeddings
        controller.enqueue(encoder.encode(createSSEMessage("embedding", "Generating embeddings...", 75)));

        const chunkTexts = structuredChunks.map(c => c.content);
        const embeddingResult = await generateRetrievalEmbeddings(chunkTexts);

        // Update chunks with embeddings
        for (let i = 0; i < structuredChunks.length; i++) {
          await db
            .update(chunks)
            .set({
              embedding: embeddingResult.embeddings[i] ?? null,
              embeddingStatus: "embedded",
            })
            .where(and(
              eq(chunks.documentId, body.documentId),
              eq(chunks.chunkIndex, i)
            ));
        }

        // Step 8: Generate tags
        controller.enqueue(encoder.encode(createSSEMessage("tagging", "Generating tags...", 85)));

        const aiTags = await generateTagsWithDBConfig({
          title: extracted.title,
          content: extracted.content,
          summary,
        });

        await updateDocumentTags(body.documentId, aiTags);

        // Step 9: Complete
        controller.enqueue(encoder.encode(createSSEMessage("saving", "Saving changes...", 95)));

        await db
          .update(documents)
          .set({ processingStatus: "completed", updatedAt: new Date() })
          .where(eq(documents.id, body.documentId));

        // Revalidate paths
        const { revalidatePath } = await import("next/cache");
        revalidatePath("/library");
        revalidatePath(`/library/${body.documentId}`);
        revalidatePath("/graph");

        controller.enqueue(encoder.encode(createSSEMessage("complete", "Document updated successfully!", 100)));
        controller.enqueue(encoder.encode(createSSEMessage("done", "", 100)));

      } catch (error) {
        console.error("Update error:", error);
        controller.enqueue(
          encoder.encode(
            createSSEMessage(
              "error",
              error instanceof Error ? error.message : "Unknown error occurred",
              0,
              true
            )
          )
        );
      } finally {
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
