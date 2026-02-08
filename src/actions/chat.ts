"use server";

import { db } from "@/db";
import { chunks, documents, entities, relationships } from "@/db/schema";
import { eq, sql, cosineDistance, isNotNull } from "drizzle-orm";
import { generateEmbeddingWithDBConfig } from "@/lib/ai";

export type RetrievedContext = {
  chunks: {
    id: string;
    content: string;
    documentId: string;
    documentTitle: string;
    score: number;
  }[];
  entities: {
    id: string;
    name: string;
    type: string;
    description: string | null;
  }[];
  graphContext: string;
};

/**
 * Hybrid retrieval: Vector search + Graph traversal
 */
export async function retrieveContext(query: string, limit: number = 5): Promise<RetrievedContext> {
  // 1. Generate query embedding
  let queryEmbedding: number[];
  try {
    queryEmbedding = await generateEmbeddingWithDBConfig(query);
  } catch (error) {
    console.error("Failed to generate query embedding:", error);
    return { chunks: [], entities: [], graphContext: "" };
  }

  // 2. Vector search - find similar chunks
  const similarChunks = await db
    .select({
      id: chunks.id,
      content: chunks.content,
      documentId: chunks.documentId,
      documentTitle: documents.title,
      distance: cosineDistance(chunks.embedding, queryEmbedding),
    })
    .from(chunks)
    .innerJoin(documents, eq(documents.id, chunks.documentId))
    .where(isNotNull(chunks.embedding)) // Only chunks with embeddings
    .orderBy(cosineDistance(chunks.embedding, queryEmbedding))
    .limit(limit);

  // 3. Extract entities from query (simple keyword matching for MVP)
  // In production, you'd use NER or the LLM
  const allEntities = await db.select().from(entities);
  const queryLower = query.toLowerCase();
  const matchedEntities = allEntities.filter(
    (e) => queryLower.includes(e.name.toLowerCase())
  );

  // 4. Graph traversal - find related entities
  const relatedEntities: typeof allEntities = [];
  const seenIds = new Set(matchedEntities.map((e) => e.id));

  for (const entity of matchedEntities) {
    // Get entities connected to matched entities
    const connected = await db
      .select({
        id: entities.id,
        name: entities.name,
        type: entities.type,
        description: entities.description,
        createdAt: entities.createdAt,
        updatedAt: entities.updatedAt,
        embedding: entities.embedding,
      })
      .from(relationships)
      .innerJoin(entities, eq(entities.id, relationships.targetEntityId))
      .where(eq(relationships.sourceEntityId, entity.id))
      .limit(3);

    const connectedReverse = await db
      .select({
        id: entities.id,
        name: entities.name,
        type: entities.type,
        description: entities.description,
        createdAt: entities.createdAt,
        updatedAt: entities.updatedAt,
        embedding: entities.embedding,
      })
      .from(relationships)
      .innerJoin(entities, eq(entities.id, relationships.sourceEntityId))
      .where(eq(relationships.targetEntityId, entity.id))
      .limit(3);

    for (const e of [...connected, ...connectedReverse]) {
      if (!seenIds.has(e.id)) {
        seenIds.add(e.id);
        relatedEntities.push(e);
      }
    }
  }

  // 5. Build graph context string
  let graphContext = "";
  if (matchedEntities.length > 0 || relatedEntities.length > 0) {
    const relevantEntities = [...matchedEntities, ...relatedEntities];
    
    // Get relationships between relevant entities
    const entityIds = relevantEntities.map((e) => e.id);
    const relevantRelationships = entityIds.length > 0
      ? await db
          .select({
            sourceId: relationships.sourceEntityId,
            targetId: relationships.targetEntityId,
            type: relationships.relationType,
          })
          .from(relationships)
          .where(
            sql`${relationships.sourceEntityId} IN ${entityIds} AND ${relationships.targetEntityId} IN ${entityIds}`
          )
      : [];

    // Build context string
    const entityMap = new Map(relevantEntities.map((e) => [e.id, e.name]));
    const relationshipStrings = relevantRelationships.map(
      (r) => `${entityMap.get(r.sourceId)} --[${r.type}]--> ${entityMap.get(r.targetId)}`
    );

    if (relationshipStrings.length > 0) {
      graphContext = `Knowledge Graph Context:\n${relationshipStrings.join("\n")}`;
    }
  }

  return {
    chunks: similarChunks.map((c) => ({
      id: c.id,
      content: c.content,
      documentId: c.documentId,
      documentTitle: c.documentTitle,
      score: 1 - (c.distance as number || 0), // Convert distance to similarity
    })),
    entities: [...matchedEntities, ...relatedEntities].map((e) => ({
      id: e.id,
      name: e.name,
      type: e.type,
      description: e.description,
    })),
    graphContext,
  };
}

/**
 * Build the full context for the LLM
 * Note: This is a pure function, not a server action
 */
export async function buildPromptContext(retrieved: RetrievedContext): Promise<string> {
  const parts: string[] = [];

  // Add chunk content
  if (retrieved.chunks.length > 0) {
    parts.push("## Relevant Content from Knowledge Base:\n");
    for (const chunk of retrieved.chunks) {
      parts.push(`### From "${chunk.documentTitle}":\n${chunk.content}\n`);
    }
  }

  // Add graph context
  if (retrieved.graphContext) {
    parts.push(`\n## ${retrieved.graphContext}\n`);
  }

  // Add entity context
  if (retrieved.entities.length > 0) {
    parts.push("\n## Relevant Entities:\n");
    for (const entity of retrieved.entities) {
      parts.push(`- **${entity.name}** (${entity.type})${entity.description ? `: ${entity.description}` : ""}`);
    }
  }

  return parts.join("\n");
}
