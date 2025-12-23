"use server";

import { db } from "@/db";
import { documents, chunks, entities, entityMentions, relationships } from "@/db/schema";
import { eq, desc, like, or, sql, count } from "drizzle-orm";
import { revalidatePath } from "next/cache";

export type DocumentWithStats = {
  id: string;
  title: string;
  type: string;
  url: string | null;
  summary: string | null;
  createdAt: Date;
  processingStatus: string;
  entityCount: number;
};

/**
 * Get all documents with entity counts
 */
export async function getDocuments(options?: {
  search?: string;
  type?: string;
  limit?: number;
  offset?: number;
}): Promise<DocumentWithStats[]> {
  const { search, type, limit = 50, offset = 0 } = options || {};

  // Build where conditions
  const conditions = [];
  if (type) {
    conditions.push(eq(documents.type, type));
  }
  if (search) {
    conditions.push(
      or(
        like(documents.title, `%${search}%`),
        like(documents.summary, `%${search}%`)
      )
    );
  }

  // Query documents with entity count subquery
  const results = await db
    .select({
      id: documents.id,
      title: documents.title,
      type: documents.type,
      url: documents.url,
      summary: documents.summary,
      createdAt: documents.createdAt,
      processingStatus: documents.processingStatus,
      entityCount: sql<number>`(
        SELECT COUNT(DISTINCT entity_mentions.entity_id) 
        FROM entity_mentions 
        WHERE entity_mentions.document_id = documents.id
      )`.as("entity_count"),
    })
    .from(documents)
    .where(conditions.length > 0 ? sql`${conditions.reduce((a, b) => sql`${a} AND ${b}`)}` : undefined)
    .orderBy(desc(documents.createdAt))
    .limit(limit)
    .offset(offset);

  return results.map((r) => ({
    ...r,
    entityCount: Number(r.entityCount) || 0,
  }));
}

/**
 * Get a single document by ID with full details
 */
export async function getDocument(id: string) {
  const [doc] = await db
    .select()
    .from(documents)
    .where(eq(documents.id, id))
    .limit(1);

  if (!doc) return null;

  // Get chunks
  const docChunks = await db
    .select()
    .from(chunks)
    .where(eq(chunks.documentId, id))
    .orderBy(chunks.chunkIndex);

  // Get entities mentioned in this document
  const docEntities = await db
    .selectDistinct({
      id: entities.id,
      name: entities.name,
      type: entities.type,
      description: entities.description,
    })
    .from(entities)
    .innerJoin(entityMentions, eq(entityMentions.entityId, entities.id))
    .where(eq(entityMentions.documentId, id));

  // Get relationships involving entities mentioned in this document
  const entityIds = docEntities.map((e) => e.id);
  const docRelationships = entityIds.length > 0
    ? await db
        .select({
          id: relationships.id,
          sourceEntityId: relationships.sourceEntityId,
          targetEntityId: relationships.targetEntityId,
          relationType: relationships.relationType,
          description: relationships.description,
        })
        .from(relationships)
        .where(
          or(
            sql`${relationships.sourceEntityId} IN ${entityIds}`,
            sql`${relationships.targetEntityId} IN ${entityIds}`
          )
        )
    : [];

  // Get all entities involved in these relationships (including those from other documents)
  const relationshipEntityIds = new Set(
    docRelationships.flatMap((rel) => [rel.sourceEntityId, rel.targetEntityId])
  );
  const relationshipEntities = relationshipEntityIds.size > 0
    ? await db
        .select({
          id: entities.id,
          name: entities.name,
          type: entities.type,
          description: entities.description,
        })
        .from(entities)
        .where(sql`${entities.id} IN ${Array.from(relationshipEntityIds)}`)
    : [];

  // Combine document entities and relationship entities, removing duplicates
  const allEntities = [...docEntities];
  relationshipEntities.forEach((relEntity) => {
    if (!allEntities.find((e) => e.id === relEntity.id)) {
      allEntities.push(relEntity);
    }
  });

  return {
    ...doc,
    chunks: docChunks,
    entities: allEntities,
    relationships: docRelationships,
  };
}

/**
 * Get document count by type
 */
export async function getDocumentStats() {
  const stats = await db
    .select({
      type: documents.type,
      count: count(),
    })
    .from(documents)
    .groupBy(documents.type);

  const total = stats.reduce((sum, s) => sum + Number(s.count), 0);

  return {
    total,
    byType: Object.fromEntries(stats.map((s) => [s.type, Number(s.count)])),
  };
}

/**
 * Delete a document and all related data
 */
export async function deleteDocument(id: string) {
  // Delete relationships that reference this document directly
  await db.delete(relationships).where(eq(relationships.sourceDocumentId, id));
  
  // Delete the document (cascades to chunks, entityMentions, srsItems)
  await db.delete(documents).where(eq(documents.id, id));
  
  // Delete orphaned entities (entities with no remaining mentions)
  await db
    .delete(entities)
    .where(
      sql`${entities.id} NOT IN (
        SELECT DISTINCT entity_id
        FROM entity_mentions
      )`
    );
  
  revalidatePath("/library");
  return { success: true };
}

/**
 * Update document processing status
 */
export async function updateDocumentStatus(
  id: string,
  status: "pending" | "processing" | "completed" | "failed"
) {
  await db
    .update(documents)
    .set({ processingStatus: status, updatedAt: new Date() })
    .where(eq(documents.id, id));
  
  revalidatePath("/library");
}
