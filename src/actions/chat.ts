"use server";

import { db } from "@/db";
import { chunks, documents, entities, relationships } from "@/db/schema";
import { and, cosineDistance, eq, ilike, inArray, isNotNull, or, sql } from "drizzle-orm";
import { generateEmbeddingWithDBConfig } from "@/lib/ai";
import {
  buildEntityNameSearchTerms,
  distanceToSimilarity,
  filterByMinimumScore,
  mergeEntityMatches,
  scoreEntityNameMatch,
  sortChunksByDocumentPriority,
  type EntityMatch,
} from "@/lib/retrieval";

const MIN_CHUNK_RELEVANCE_SCORE = 0.2;
const MIN_ENTITY_RELEVANCE_SCORE = 0.2;
const CANDIDATE_MULTIPLIER = 3;
const ENTITY_NAME_MATCH_LIMIT = 12;
const ENTITY_NAME_MAX_WORDS = 5;
const ENTITY_NAME_MAX_TERMS = 80;
const MAX_GRAPH_RELATIONSHIPS = 40;
const MAX_RELATED_ENTITIES = 8;

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

type RetrieveContextOptions = {
  prioritizedDocumentId?: string | null;
};

type RetrievedEntity = {
  id: string;
  name: string;
  type: string;
  description: string | null;
};

type RelationshipContextRow = {
  sourceId: string;
  targetId: string;
  type: string;
};

/**
 * Hybrid retrieval: Vector search + Graph traversal
 */
export async function retrieveContext(
  query: string,
  limit: number = 5,
  options: RetrieveContextOptions = {}
): Promise<RetrievedContext> {
  const resultLimit = Math.max(0, Math.floor(limit));
  if (resultLimit === 0) {
    return { chunks: [], entities: [], graphContext: "" };
  }

  // 1. Generate query embedding
  let queryEmbedding: number[];
  try {
    queryEmbedding = await generateEmbeddingWithDBConfig(query);
  } catch (error) {
    console.error("Failed to generate query embedding:", error);
    return { chunks: [], entities: [], graphContext: "" };
  }

  const chunkDistance = cosineDistance(chunks.embedding, queryEmbedding);
  const entityDistance = cosineDistance(entities.embedding, queryEmbedding);
  const candidateLimit = resultLimit * CANDIDATE_MULTIPLIER;

  // 2. Bounded vector and name searches
  const [similarChunks, vectorEntityRows, nameEntityRows] = await Promise.all([
    db
      .select({
        id: chunks.id,
        content: chunks.content,
        documentId: chunks.documentId,
        documentTitle: documents.title,
        distance: chunkDistance,
      })
      .from(chunks)
      .innerJoin(documents, eq(documents.id, chunks.documentId))
      .where(isNotNull(chunks.embedding))
      .orderBy(chunkDistance)
      .limit(candidateLimit),
    db
      .select({
        id: entities.id,
        name: entities.name,
        type: entities.type,
        description: entities.description,
        distance: entityDistance,
      })
      .from(entities)
      .where(isNotNull(entities.embedding))
      .orderBy(entityDistance)
      .limit(candidateLimit),
    findEntityNameMatches(query),
  ]);

  const retrievedChunks = sortChunksByDocumentPriority(
    filterByMinimumScore(
      similarChunks.map((chunk) => ({
        id: chunk.id,
        content: chunk.content,
        documentId: chunk.documentId,
        documentTitle: chunk.documentTitle,
        score: distanceToSimilarity(chunk.distance as number | null),
      })),
      MIN_CHUNK_RELEVANCE_SCORE
    ),
    options.prioritizedDocumentId
  ).slice(0, resultLimit);

  const vectorEntityMatches = filterByMinimumScore(
    vectorEntityRows.map((entity) => ({
      id: entity.id,
      name: entity.name,
      type: entity.type,
      description: entity.description,
      score: distanceToSimilarity(entity.distance as number | null),
    })),
    MIN_ENTITY_RELEVANCE_SCORE
  );

  const nameEntityMatches = nameEntityRows.flatMap((entity): EntityMatch[] => {
    const score = scoreEntityNameMatch(query, entity.name);
    if (score === null) {
      return [];
    }

    return [
      {
        id: entity.id,
        name: entity.name,
        type: entity.type,
        description: entity.description,
        score,
      },
    ];
  });

  const matchedEntities = mergeEntityMatches(
    vectorEntityMatches,
    nameEntityMatches,
    resultLimit
  );
  const { relatedEntities, relevantRelationships } = await expandGraphContext(
    matchedEntities,
    resultLimit
  );
  const relevantEntities = dedupeEntities([...matchedEntities, ...relatedEntities]);
  const graphContext = buildGraphContext(relevantEntities, relevantRelationships);

  return {
    chunks: retrievedChunks,
    entities: relevantEntities.map((e) => ({
      id: e.id,
      name: e.name,
      type: e.type,
      description: e.description,
    })),
    graphContext,
  };
}

async function findEntityNameMatches(query: string): Promise<RetrievedEntity[]> {
  const trimmedQuery = query.trim();
  const normalizedName = sql<string>`trim(regexp_replace(lower(${entities.name}), '[^a-z0-9]+', ' ', 'g'))`;
  const nameTerms = buildEntityNameSearchTerms(query, {
    maxWordsPerTerm: ENTITY_NAME_MAX_WORDS,
    maxTerms: ENTITY_NAME_MAX_TERMS,
  });
  const conditions = [];

  if (nameTerms.length > 0) {
    conditions.push(inArray(normalizedName, nameTerms));
  }

  if (trimmedQuery) {
    conditions.push(ilike(entities.name, trimmedQuery));
    conditions.push(ilike(entities.name, `%${trimmedQuery}%`));
  }

  if (conditions.length === 0) {
    return [];
  }

  return db
    .select({
      id: entities.id,
      name: entities.name,
      type: entities.type,
      description: entities.description,
    })
    .from(entities)
    .where(conditions.length === 1 ? conditions[0] : or(...conditions))
    .limit(ENTITY_NAME_MATCH_LIMIT);
}

async function expandGraphContext(
  matchedEntities: readonly EntityMatch[],
  resultLimit: number
): Promise<{
  relatedEntities: RetrievedEntity[];
  relevantRelationships: RelationshipContextRow[];
}> {
  const seedIds = matchedEntities.map((entity) => entity.id);

  if (seedIds.length === 0) {
    return { relatedEntities: [], relevantRelationships: [] };
  }

  const seedIdSet = new Set(seedIds);
  const neighborhoodRelationships = await db
    .select({
      sourceId: relationships.sourceEntityId,
      targetId: relationships.targetEntityId,
      type: relationships.relationType,
    })
    .from(relationships)
    .where(
      or(
        inArray(relationships.sourceEntityId, seedIds),
        inArray(relationships.targetEntityId, seedIds)
      )
    )
    .limit(MAX_GRAPH_RELATIONSHIPS);

  const neighborIds: string[] = [];
  const seenNeighborIds = new Set<string>();
  const relatedLimit = Math.min(MAX_RELATED_ENTITIES, Math.max(resultLimit * 2, resultLimit));

  for (const relationship of neighborhoodRelationships) {
    for (const entityId of [relationship.sourceId, relationship.targetId]) {
      if (
        seedIdSet.has(entityId) ||
        seenNeighborIds.has(entityId) ||
        neighborIds.length >= relatedLimit
      ) {
        continue;
      }

      seenNeighborIds.add(entityId);
      neighborIds.push(entityId);
    }
  }

  const relatedEntityRows =
    neighborIds.length > 0
      ? await db
          .select({
            id: entities.id,
            name: entities.name,
            type: entities.type,
            description: entities.description,
          })
          .from(entities)
          .where(inArray(entities.id, neighborIds))
          .limit(relatedLimit)
      : [];
  const relatedEntityById = new Map(
    relatedEntityRows.map((entity) => [entity.id, entity] as const)
  );
  const relatedEntities = neighborIds.flatMap((entityId) => {
    const entity = relatedEntityById.get(entityId);
    return entity ? [entity] : [];
  });
  const relevantEntityIds = Array.from(new Set([...seedIds, ...relatedEntities.map((e) => e.id)]));
  const relevantRelationships =
    relevantEntityIds.length >= 2
      ? await db
          .select({
            sourceId: relationships.sourceEntityId,
            targetId: relationships.targetEntityId,
            type: relationships.relationType,
          })
          .from(relationships)
          .where(
            and(
              inArray(relationships.sourceEntityId, relevantEntityIds),
              inArray(relationships.targetEntityId, relevantEntityIds)
            )
          )
          .limit(MAX_GRAPH_RELATIONSHIPS)
      : [];

  return { relatedEntities, relevantRelationships };
}

function dedupeEntities<T extends RetrievedEntity>(entitiesToDedupe: readonly T[]): T[] {
  const byId = new Map<string, T>();

  for (const entity of entitiesToDedupe) {
    if (!byId.has(entity.id)) {
      byId.set(entity.id, entity);
    }
  }

  return Array.from(byId.values());
}

function buildGraphContext(
  relevantEntities: readonly RetrievedEntity[],
  relevantRelationships: readonly RelationshipContextRow[]
): string {
  if (relevantEntities.length === 0 || relevantRelationships.length === 0) {
    return "";
  }

  const entityMap = new Map(relevantEntities.map((entity) => [entity.id, entity.name]));
  const relationshipStrings = relevantRelationships.flatMap((relationship) => {
    const sourceName = entityMap.get(relationship.sourceId);
    const targetName = entityMap.get(relationship.targetId);

    if (!sourceName || !targetName) {
      return [];
    }

    return [`${sourceName} --[${relationship.type}]--> ${targetName}`];
  });

  if (relationshipStrings.length === 0) {
    return "";
  }

  return `Knowledge Graph Context:\n${relationshipStrings.join("\n")}`;
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
