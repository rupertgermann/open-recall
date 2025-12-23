"use server";

import { db } from "@/db";
import { entities, relationships, entityMentions, documents, tags, documentTags } from "@/db/schema";
import { eq, sql, desc, count } from "drizzle-orm";

export type GraphNode = {
  id: string;
  name: string;
  type: string;
  description: string | null;
  mentionCount: number;
};

export type GraphLink = {
  id: string;
  source: string;
  target: string;
  relationType: string;
  description: string | null;
};

export type GraphData = {
  nodes: GraphNode[];
  links: GraphLink[];
};

/**
 * Get the full knowledge graph
 */
export async function getGraphData(options?: { tags?: string[] }): Promise<GraphData> {
  const requestedTags = Array.from(
    new Set((options?.tags || []).map((t) => t.trim().toLowerCase()).filter(Boolean))
  );

  const entityFilterSql = requestedTags.length === 0
    ? undefined
    : sql`${entities.id} IN (
        SELECT DISTINCT ${entityMentions.entityId}
        FROM ${entityMentions}
        WHERE ${entityMentions.documentId} IN (
          SELECT ${documentTags.documentId}
          FROM ${documentTags}
          INNER JOIN ${tags} ON ${tags.id} = ${documentTags.tagId}
          WHERE ${tags.name} IN ${requestedTags}
          GROUP BY ${documentTags.documentId}
          HAVING COUNT(DISTINCT ${tags.name}) = ${requestedTags.length}
        )
      )`;

  // Get all entities with mention counts
  const entitiesWithCounts = await db
    .select({
      id: entities.id,
      name: entities.name,
      type: entities.type,
      description: entities.description,
      mentionCount: sql<number>`(
        SELECT COUNT(*) FROM ${entityMentions}
        WHERE ${entityMentions.entityId} = ${entities.id}
      )`.as("mention_count"),
    })
    .from(entities)
    .where(entityFilterSql);

  // Get all relationships
  const allRelationships = await db
    .select({
      id: relationships.id,
      source: relationships.sourceEntityId,
      target: relationships.targetEntityId,
      relationType: relationships.relationType,
      description: relationships.description,
    })
    .from(relationships);

  if (requestedTags.length === 0) {
    return {
      nodes: entitiesWithCounts.map((e) => ({
        ...e,
        mentionCount: Number(e.mentionCount) || 0,
      })),
      links: allRelationships,
    };
  }

  const allowedEntityIds = new Set(entitiesWithCounts.map((e) => e.id));
  const filteredLinks = allRelationships.filter(
    (l) => allowedEntityIds.has(l.source) && allowedEntityIds.has(l.target)
  );

  return {
    nodes: entitiesWithCounts.map((e) => ({
      ...e,
      mentionCount: Number(e.mentionCount) || 0,
    })),
    links: filteredLinks,
  };
}

/**
 * Get graph data for a specific document
 */
export async function getDocumentGraph(documentId: string): Promise<GraphData> {
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
    .where(eq(entityMentions.documentId, documentId));

  const entityIds = docEntities.map((e) => e.id);

  if (entityIds.length === 0) {
    return { nodes: [], links: [] };
  }

  // Get relationships between these entities
  const docRelationships = await db
    .select({
      id: relationships.id,
      source: relationships.sourceEntityId,
      target: relationships.targetEntityId,
      relationType: relationships.relationType,
      description: relationships.description,
    })
    .from(relationships)
    .where(
      sql`${relationships.sourceEntityId} IN ${entityIds} AND ${relationships.targetEntityId} IN ${entityIds}`
    );

  return {
    nodes: docEntities.map((e) => ({
      ...e,
      mentionCount: 1,
    })),
    links: docRelationships,
  };
}

/**
 * Get entity details with related documents
 */
export async function getEntityDetails(entityId: string) {
  const [entity] = await db
    .select()
    .from(entities)
    .where(eq(entities.id, entityId))
    .limit(1);

  if (!entity) return null;

  // Get documents mentioning this entity
  const mentionedDocs = await db
    .selectDistinct({
      id: documents.id,
      title: documents.title,
      type: documents.type,
      createdAt: documents.createdAt,
    })
    .from(documents)
    .innerJoin(entityMentions, eq(entityMentions.documentId, documents.id))
    .where(eq(entityMentions.entityId, entityId))
    .orderBy(desc(documents.createdAt));

  // Get connected entities
  const outgoing = await db
    .select({
      id: entities.id,
      name: entities.name,
      type: entities.type,
      relationType: relationships.relationType,
    })
    .from(relationships)
    .innerJoin(entities, eq(entities.id, relationships.targetEntityId))
    .where(eq(relationships.sourceEntityId, entityId));

  const incoming = await db
    .select({
      id: entities.id,
      name: entities.name,
      type: entities.type,
      relationType: relationships.relationType,
    })
    .from(relationships)
    .innerJoin(entities, eq(entities.id, relationships.sourceEntityId))
    .where(eq(relationships.targetEntityId, entityId));

  return {
    ...entity,
    documents: mentionedDocs,
    connectedEntities: [...outgoing, ...incoming],
  };
}

/**
 * Get graph statistics
 */
export async function getGraphStats() {
  const [entityCount] = await db.select({ count: count() }).from(entities);
  const [relationshipCount] = await db.select({ count: count() }).from(relationships);

  // Get entity type distribution
  const typeDistribution = await db
    .select({
      type: entities.type,
      count: count(),
    })
    .from(entities)
    .groupBy(entities.type);

  return {
    entityCount: Number(entityCount?.count) || 0,
    relationshipCount: Number(relationshipCount?.count) || 0,
    typeDistribution: Object.fromEntries(
      typeDistribution.map((t) => [t.type, Number(t.count)])
    ),
  };
}
