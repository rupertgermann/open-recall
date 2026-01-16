"use server";

import { db } from "@/db";
import { documents, chunks, entities, entityMentions, relationships, tags, documentTags } from "@/db/schema";
import { eq, desc, like, or, sql, count, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { generateTagsWithDBConfig } from "@/lib/ai";
import { extractFromUrl, detectContentType } from "@/lib/content/extractor";
import { reprocessDocument } from "@/actions/ingest";

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

  const docTags = await db
    .select({ name: tags.name })
    .from(tags)
    .innerJoin(documentTags, eq(documentTags.tagId, tags.id))
    .where(eq(documentTags.documentId, id))
    .orderBy(tags.name);

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
    tags: docTags.map((t) => t.name),
    entities: allEntities,
    relationships: docRelationships,
  };
}

export async function getAllTags() {
  const rows = await db
    .select({ name: tags.name })
    .from(tags)
    .orderBy(desc(tags.createdAt));
  return rows.map((r) => r.name);
}

export async function updateDocumentTags(documentId: string, nextTags: string[]) {
  const normalized = Array.from(
    new Set(
      nextTags
        .map((t) => t.trim().toLowerCase())
        .filter((t) => t.length > 0)
    )
  );

  if (normalized.length > 0) {
    await db
      .insert(tags)
      .values(normalized.map((name) => ({ name })))
      .onConflictDoNothing();
  }

  const tagRows = normalized.length > 0
    ? await db
        .select({ id: tags.id, name: tags.name })
        .from(tags)
        .where(inArray(tags.name, normalized))
    : [];

  await db.delete(documentTags).where(eq(documentTags.documentId, documentId));

  if (tagRows.length > 0) {
    await db.insert(documentTags).values(
      tagRows.map((t) => ({ documentId, tagId: t.id }))
    );
  }

  revalidatePath(`/library/${documentId}`);
  revalidatePath("/graph");
  return { success: true, tags: normalized };
}

export async function generateDocumentTags(documentId: string) {
  const [doc] = await db
    .select({
      title: documents.title,
      summary: documents.summary,
      content: documents.content,
    })
    .from(documents)
    .where(eq(documents.id, documentId))
    .limit(1);

  if (!doc) return { success: false, tags: [] as string[] };

  const existing = await db
    .select({ name: tags.name })
    .from(tags)
    .innerJoin(documentTags, eq(documentTags.tagId, tags.id))
    .where(eq(documentTags.documentId, documentId));

  const aiTags = await generateTagsWithDBConfig({
    title: doc.title,
    summary: doc.summary,
    content: doc.content,
  });

  if (aiTags.length === 0) {
    return { success: false, tags: existing.map((t) => t.name) };
  }

  const merged = Array.from(new Set([...existing.map((t) => t.name), ...aiTags]));
  return updateDocumentTags(documentId, merged);
}

export async function updateDocumentFromSource(documentId: string) {
  const [doc] = await db
    .select({ id: documents.id, url: documents.url })
    .from(documents)
    .where(eq(documents.id, documentId))
    .limit(1);

  if (!doc) {
    return { success: false, error: "Document not found" };
  }

  if (!doc.url) {
    return { success: false, error: "Document has no source URL" };
  }

  const contentType = detectContentType(doc.url);
  const extracted = await extractFromUrl(doc.url);
  if (!extracted) {
    return { success: false, error: "Failed to extract content from URL" };
  }

  await db
    .update(documents)
    .set({
      title: extracted.title,
      type: contentType === "youtube" ? "youtube" : "article",
      content: extracted.content,
      processingStatus: "processing",
      updatedAt: new Date(),
    })
    .where(eq(documents.id, documentId));

  // Reprocess document content and regenerate derived data
  await reprocessDocument(documentId, extracted.content);

  await db
    .update(documents)
    .set({ processingStatus: "completed", updatedAt: new Date() })
    .where(eq(documents.id, documentId));

  revalidatePath("/library");
  revalidatePath(`/library/${documentId}`);
  revalidatePath("/graph");

  return { success: true };
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
