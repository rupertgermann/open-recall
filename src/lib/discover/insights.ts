import "server-only";

import { and, desc, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import {
  discoverInsights,
  documents,
  entities,
  entityMentions,
  relationships,
} from "@/db/schema";
import { getInsightKey as getDiscoverInsightKey, normalizeEntityIds } from "@/lib/discover/utils";

export type DiscoverInsightEntity = {
  id: string;
  name: string;
  type: string;
  description: string | null;
};

export type DiscoverInsightRelationship = {
  sourceId: string;
  targetId: string;
  relationType: string;
  description: string | null;
};

export type DiscoverInsightDocument = {
  id: string;
  title: string;
  summary: string | null;
};

export type DiscoverInsightContext = {
  entityIds: string[];
  entities: DiscoverInsightEntity[];
  relationships: DiscoverInsightRelationship[];
  documents: DiscoverInsightDocument[];
};

export const DISCOVER_INSIGHT_SYSTEM_PROMPT =
  "You are an insight engine for a personal knowledge base. Find surprising, non-obvious connections between the selected entities and explain why they matter. Be concise but insightful. Write 2-4 sentences with a warm, engaging tone.";

export { normalizeEntityIds, getDiscoverInsightKey };

export async function getDiscoverInsightContext(
  entityIds: readonly string[]
): Promise<DiscoverInsightContext> {
  const normalizedIds = normalizeEntityIds(entityIds);

  if (normalizedIds.length === 0) {
    return {
      entityIds: [],
      entities: [],
      relationships: [],
      documents: [],
    };
  }

  const entityList = await db
    .select({
      id: entities.id,
      name: entities.name,
      type: entities.type,
      description: entities.description,
    })
    .from(entities)
    .where(inArray(entities.id, normalizedIds));

  const resolvedIds = normalizeEntityIds(entityList.map((entity) => entity.id));

  if (resolvedIds.length === 0) {
    return {
      entityIds: [],
      entities: [],
      relationships: [],
      documents: [],
    };
  }

  const relationshipList =
    resolvedIds.length >= 2
      ? await db
          .select({
            sourceId: relationships.sourceEntityId,
            targetId: relationships.targetEntityId,
            relationType: relationships.relationType,
            description: relationships.description,
          })
          .from(relationships)
          .where(
            and(
              inArray(relationships.sourceEntityId, resolvedIds),
              inArray(relationships.targetEntityId, resolvedIds)
            )
          )
      : [];

  const documentList = await db
    .selectDistinct({
      id: documents.id,
      title: documents.title,
      summary: documents.summary,
    })
    .from(documents)
    .innerJoin(entityMentions, eq(entityMentions.documentId, documents.id))
    .where(inArray(entityMentions.entityId, resolvedIds))
    .limit(10);

  return {
    entityIds: resolvedIds,
    entities: entityList.sort((left, right) => left.name.localeCompare(right.name)),
    relationships: relationshipList,
    documents: documentList,
  };
}

export function buildDiscoverInsightPrompt(
  context: DiscoverInsightContext,
  options: { includeKnowledgeBase?: boolean } = {}
): string {
  const entityById = new Map(
    context.entities.map((entity) => [entity.id, entity] as const)
  );

  const entityContext = context.entities
    .map(
      (entity) =>
        `- ${entity.name} (${entity.type}): ${entity.description || "No description"}`
    )
    .join("\n");

  const relationshipContext = context.relationships
    .map((relationship) => {
      const source = entityById.get(relationship.sourceId);
      const target = entityById.get(relationship.targetId);

      return `- ${source?.name || relationship.sourceId} --[${relationship.relationType}]--> ${target?.name || relationship.targetId}${relationship.description ? `: ${relationship.description}` : ""}`;
    })
    .join("\n");

  const documentContext = context.documents
    .map(
      (document) =>
        `- "${document.title}": ${document.summary?.slice(0, 200) || "No summary"}`
    )
    .join("\n");

  const intro = options.includeKnowledgeBase
    ? "Analyze these entities and their connections from the user's knowledge base."
    : "Analyze these entities and their connections.";

  return `${intro} What surprising insight or hidden pattern do you see?

Entities:
${entityContext}

Relationships:
${relationshipContext || "No direct relationships between these entities."}

Source Documents:
${documentContext || "No source documents found."}

Generate a brief, insightful observation about the hidden connection between these entities. Focus on what makes the pattern surprising or useful.`;
}

export async function persistDiscoverInsight(
  entityIds: readonly string[],
  insight: string
): Promise<void> {
  const normalizedIds = normalizeEntityIds(entityIds);
  const trimmedInsight = insight.trim();

  if (!normalizedIds.length || !trimmedInsight) {
    return;
  }

  await db.insert(discoverInsights).values({
    entityIds: normalizedIds,
    insight: trimmedInsight,
  });
}

export async function getSavedInsightsMapFromDB(): Promise<Map<string, string>> {
  const rows = await db
    .select({
      entityIds: discoverInsights.entityIds,
      insight: discoverInsights.insight,
    })
    .from(discoverInsights)
    .orderBy(desc(discoverInsights.createdAt));

  const insights = new Map<string, string>();

  for (const row of rows) {
    const key = getDiscoverInsightKey(row.entityIds as string[]);
    if (!insights.has(key)) {
      insights.set(key, row.insight);
    }
  }

  return insights;
}
