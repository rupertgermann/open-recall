"use server";

import { db } from "@/db";
import { entities, relationships, entityMentions, documents, discoverInsights } from "@/db/schema";
import { sql, count, eq } from "drizzle-orm";

// ============================================================================
// TYPES
// ============================================================================

export type HiddenConnection = {
  entityA: { id: string; name: string; type: string; description: string | null };
  entityB: { id: string; name: string; type: string; description: string | null };
  bridge: { id: string; name: string; type: string; description: string | null };
  relationABridge: string;
  relationBridgeB: string;
  sourceDocuments: { id: string; title: string }[];
};

export type BridgeEntity = {
  id: string;
  name: string;
  type: string;
  description: string | null;
  connectionCount: number;
  connectedEntities: { id: string; name: string; type: string }[];
};

export type KnowledgeCluster = {
  name: string;
  dominantType: string;
  members: { id: string; name: string; type: string }[];
  memberCount: number;
  bridgeEntities: { id: string; name: string; type: string }[];
};

export type DiscoverStats = {
  totalEntities: number;
  totalRelationships: number;
  clustersFound: number;
  potentialInsights: number;
};

// ============================================================================
// getHiddenConnections
// ============================================================================

export async function getHiddenConnections(): Promise<HiddenConnection[]> {
  // Find entity pairs connected through a bridge (2-hop paths)
  // where A and B are NOT directly connected
  const results = await db.execute(sql`
    WITH two_hop AS (
      SELECT DISTINCT
        r1.source_entity_id AS entity_a_id,
        COALESCE(r1.target_entity_id, r2.source_entity_id) AS bridge_id,
        r2.target_entity_id AS entity_b_id,
        r1.relation_type AS rel_a_bridge,
        r2.relation_type AS rel_bridge_b
      FROM relationships r1
      INNER JOIN relationships r2
        ON r1.target_entity_id = r2.source_entity_id
      WHERE r1.source_entity_id != r2.target_entity_id
        AND r1.source_entity_id < r2.target_entity_id
    ),
    direct AS (
      SELECT source_entity_id, target_entity_id FROM relationships
      UNION
      SELECT target_entity_id, source_entity_id FROM relationships
    )
    SELECT
      th.entity_a_id,
      th.bridge_id,
      th.entity_b_id,
      th.rel_a_bridge,
      th.rel_bridge_b
    FROM two_hop th
    WHERE NOT EXISTS (
      SELECT 1 FROM direct d
      WHERE d.source_entity_id = th.entity_a_id
        AND d.target_entity_id = th.entity_b_id
    )
    LIMIT 30
  `);

  const rows = results as unknown as Record<string, unknown>[];
  if (!rows || rows.length === 0) {
    return [];
  }

  // Collect all entity IDs we need to look up
  const entityIds = new Set<string>();
  for (const row of rows) {
    entityIds.add(row.entity_a_id as string);
    entityIds.add(row.bridge_id as string);
    entityIds.add(row.entity_b_id as string);
  }

  if (entityIds.size === 0) return [];

  // Fetch entity details
  const entityList = await db
    .select({
      id: entities.id,
      name: entities.name,
      type: entities.type,
      description: entities.description,
    })
    .from(entities)
    .where(sql`${entities.id} IN ${Array.from(entityIds)}`);

  const entityMap = new Map(entityList.map((e) => [e.id, e]));

  // For each connection, find source documents via entity mentions
  const connections: HiddenConnection[] = [];

  for (const row of rows) {
    const entityA = entityMap.get(row.entity_a_id as string);
    const entityB = entityMap.get(row.entity_b_id as string);
    const bridge = entityMap.get(row.bridge_id as string);

    if (!entityA || !entityB || !bridge) continue;

    // Check that A and B come from different documents (cross-domain connections are more interesting)
    const docsForA = await db
      .selectDistinct({ id: documents.id, title: documents.title })
      .from(documents)
      .innerJoin(entityMentions, eq(entityMentions.documentId, documents.id))
      .where(eq(entityMentions.entityId, entityA.id))
      .limit(3);

    const docsForB = await db
      .selectDistinct({ id: documents.id, title: documents.title })
      .from(documents)
      .innerJoin(entityMentions, eq(entityMentions.documentId, documents.id))
      .where(eq(entityMentions.entityId, entityB.id))
      .limit(3);

    const allDocs = new Map<string, string>();
    for (const d of [...docsForA, ...docsForB]) {
      allDocs.set(d.id, d.title);
    }

    connections.push({
      entityA,
      entityB,
      bridge,
      relationABridge: row.rel_a_bridge as string,
      relationBridgeB: row.rel_bridge_b as string,
      sourceDocuments: Array.from(allDocs.entries()).map(([id, title]) => ({ id, title })),
    });

    if (connections.length >= 10) break;
  }

  // Sort: prefer cross-document connections (more source documents = more interesting)
  connections.sort((a, b) => b.sourceDocuments.length - a.sourceDocuments.length);

  return connections;
}

// ============================================================================
// getBridgeEntities
// ============================================================================

export async function getBridgeEntities(): Promise<BridgeEntity[]> {
  // Find entities with the most connections where their neighbors have few mutual connections
  // Simple heuristic: entities with highest degree (most relationships)
  const results = await db.execute(sql`
    WITH entity_degrees AS (
      SELECT
        e.id,
        e.name,
        e.type,
        e.description,
        COUNT(DISTINCT r.id) AS connection_count
      FROM entities e
      INNER JOIN (
        SELECT id, source_entity_id AS entity_id FROM relationships
        UNION ALL
        SELECT id, target_entity_id AS entity_id FROM relationships
      ) r ON r.entity_id = e.id
      GROUP BY e.id, e.name, e.type, e.description
      HAVING COUNT(DISTINCT r.id) >= 3
      ORDER BY connection_count DESC
      LIMIT 10
    )
    SELECT * FROM entity_degrees
  `);

  const rows = results as unknown as Record<string, unknown>[];
  if (!rows || rows.length === 0) {
    return [];
  }

  const bridgeEntities: BridgeEntity[] = [];

  for (const row of rows) {
    const entityId = row.id as string;

    // Fetch connected entities
    const connectedRows = await db.execute(sql`
      SELECT DISTINCT e.id, e.name, e.type
      FROM entities e
      INNER JOIN relationships r ON (
        (r.source_entity_id = ${entityId} AND r.target_entity_id = e.id)
        OR (r.target_entity_id = ${entityId} AND r.source_entity_id = e.id)
      )
      LIMIT 20
    `) as unknown as Record<string, unknown>[];

    bridgeEntities.push({
      id: entityId,
      name: row.name as string,
      type: row.type as string,
      description: row.description as string | null,
      connectionCount: Number(row.connection_count),
      connectedEntities: (connectedRows || []).map((c) => ({
        id: c.id as string,
        name: c.name as string,
        type: c.type as string,
      })),
    });
  }

  return bridgeEntities;
}

// ============================================================================
// getKnowledgeClusters
// ============================================================================

export async function getKnowledgeClusters(): Promise<KnowledgeCluster[]> {
  // Group entities by their connectivity using a simple connected-component approach
  // We use entity types and shared relationships to form clusters

  // Get all relationships
  const allRels = await db
    .select({
      sourceId: relationships.sourceEntityId,
      targetId: relationships.targetEntityId,
    })
    .from(relationships);

  if (allRels.length === 0) return [];

  // Build adjacency list
  const adjacency = new Map<string, Set<string>>();
  for (const rel of allRels) {
    if (!adjacency.has(rel.sourceId)) adjacency.set(rel.sourceId, new Set());
    if (!adjacency.has(rel.targetId)) adjacency.set(rel.targetId, new Set());
    adjacency.get(rel.sourceId)!.add(rel.targetId);
    adjacency.get(rel.targetId)!.add(rel.sourceId);
  }

  // Simple BFS to find connected components
  const visited = new Set<string>();
  const components: Set<string>[] = [];

  for (const nodeId of adjacency.keys()) {
    if (visited.has(nodeId)) continue;

    const component = new Set<string>();
    const queue = [nodeId];
    visited.add(nodeId);

    while (queue.length > 0) {
      const current = queue.shift()!;
      component.add(current);

      for (const neighbor of adjacency.get(current) || []) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push(neighbor);
        }
      }
    }

    if (component.size >= 2) {
      components.push(component);
    }
  }

  if (components.length === 0) return [];

  // Sort by size (largest first), take top 10
  components.sort((a, b) => b.size - a.size);
  const topComponents = components.slice(0, 10);

  // Fetch entity details for all entities in top components
  const allEntityIds = new Set<string>();
  for (const comp of topComponents) {
    for (const id of comp) {
      allEntityIds.add(id);
    }
  }

  const entityList = await db
    .select({
      id: entities.id,
      name: entities.name,
      type: entities.type,
    })
    .from(entities)
    .where(sql`${entities.id} IN ${Array.from(allEntityIds)}`);

  const entityMap = new Map(entityList.map((e) => [e.id, e]));

  // Build clusters
  const clusters: KnowledgeCluster[] = [];

  for (const comp of topComponents) {
    const members = Array.from(comp)
      .map((id) => entityMap.get(id))
      .filter((e): e is NonNullable<typeof e> => !!e);

    if (members.length < 2) continue;

    // Find dominant type
    const typeCounts = new Map<string, number>();
    for (const m of members) {
      typeCounts.set(m.type, (typeCounts.get(m.type) || 0) + 1);
    }
    const dominantType = Array.from(typeCounts.entries()).sort((a, b) => b[1] - a[1])[0][0];

    // Find the entity with the most connections within this cluster as the "name" source
    let maxConnections = 0;
    let centralEntity = members[0];
    for (const m of members) {
      const connections = (adjacency.get(m.id) || new Set()).size;
      if (connections > maxConnections) {
        maxConnections = connections;
        centralEntity = m;
      }
    }

    // Find bridge entities: members that also connect to entities in OTHER clusters
    const bridgeMembers: typeof members = [];
    for (const m of members) {
      const neighbors = adjacency.get(m.id) || new Set();
      for (const n of neighbors) {
        if (!comp.has(n)) {
          bridgeMembers.push(m);
          break;
        }
      }
    }

    clusters.push({
      name: `${centralEntity.name} cluster`,
      dominantType,
      members: members.slice(0, 20), // Limit displayed members
      memberCount: members.length,
      bridgeEntities: bridgeMembers.slice(0, 5),
    });
  }

  return clusters;
}

// ============================================================================
// generateInsight (server action - non-streaming)
// ============================================================================

export async function generateInsight(entityIds: string[]): Promise<string> {
  const { generateText } = await import("ai");
  const { getChatConfigFromDB } = await import("@/lib/ai/config");
  const { getModel } = await import("@/lib/ai/client");

  const config = await getChatConfigFromDB();
  const model = getModel(config);

  // Fetch entity details
  const entityList = await db
    .select({
      id: entities.id,
      name: entities.name,
      type: entities.type,
      description: entities.description,
    })
    .from(entities)
    .where(sql`${entities.id} IN ${entityIds}`);

  // Fetch relationships between these entities
  const rels = await db
    .select({
      sourceId: relationships.sourceEntityId,
      targetId: relationships.targetEntityId,
      relationType: relationships.relationType,
      description: relationships.description,
    })
    .from(relationships)
    .where(
      sql`${relationships.sourceEntityId} IN ${entityIds} OR ${relationships.targetEntityId} IN ${entityIds}`
    );

  // Fetch source documents for these entities
  const docs = await db
    .selectDistinct({
      id: documents.id,
      title: documents.title,
      summary: documents.summary,
    })
    .from(documents)
    .innerJoin(entityMentions, eq(entityMentions.documentId, documents.id))
    .where(sql`${entityMentions.entityId} IN ${entityIds}`)
    .limit(10);

  const entityContext = entityList
    .map((e) => `- ${e.name} (${e.type}): ${e.description || "No description"}`)
    .join("\n");

  const relContext = rels
    .map((r) => {
      const source = entityList.find((e) => e.id === r.sourceId);
      const target = entityList.find((e) => e.id === r.targetId);
      return `- ${source?.name || "Unknown"} --[${r.relationType}]--> ${target?.name || "Unknown"}${r.description ? `: ${r.description}` : ""}`;
    })
    .join("\n");

  const docContext = docs
    .map((d) => `- "${d.title}": ${d.summary?.slice(0, 200) || "No summary"}`)
    .join("\n");

  const { text } = await generateText({
    model,
    system: `You are an insight engine for a personal knowledge base. Your job is to find surprising, non-obvious connections between entities and explain why they matter. Be concise but insightful. Write 2-4 sentences that reveal a hidden pattern or connection the user might not have noticed.`,
    prompt: `Analyze these entities and their connections. What surprising insight or hidden pattern do you see?

Entities:
${entityContext}

Relationships:
${relContext || "No direct relationships between these entities."}

Source Documents:
${docContext || "No source documents found."}

Generate a brief, insightful observation about the hidden connection between these entities.`,
    maxOutputTokens: 300,
  });

  return text;
}

// ============================================================================
// getDiscoverStats
// ============================================================================

export async function getDiscoverStats(): Promise<DiscoverStats> {
  const [entityCount] = await db.select({ count: count() }).from(entities);
  const [relCount] = await db.select({ count: count() }).from(relationships);

  // Quick cluster count using connected components count
  const allRels = await db
    .select({
      sourceId: relationships.sourceEntityId,
      targetId: relationships.targetEntityId,
    })
    .from(relationships);

  const adjacency = new Map<string, Set<string>>();
  for (const rel of allRels) {
    if (!adjacency.has(rel.sourceId)) adjacency.set(rel.sourceId, new Set());
    if (!adjacency.has(rel.targetId)) adjacency.set(rel.targetId, new Set());
    adjacency.get(rel.sourceId)!.add(rel.targetId);
    adjacency.get(rel.targetId)!.add(rel.sourceId);
  }

  const visited = new Set<string>();
  let clusterCount = 0;

  for (const nodeId of adjacency.keys()) {
    if (visited.has(nodeId)) continue;
    clusterCount++;
    const queue = [nodeId];
    visited.add(nodeId);
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const neighbor of adjacency.get(current) || []) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push(neighbor);
        }
      }
    }
  }

  // Potential insights = number of hidden connections (rough estimate)
  const totalEntities = Number(entityCount?.count) || 0;
  const totalRelationships = Number(relCount?.count) || 0;
  const potentialInsights = Math.max(0, Math.floor(totalEntities * 0.3));

  return {
    totalEntities,
    totalRelationships,
    clustersFound: clusterCount,
    potentialInsights,
  };
}

// ============================================================================
// saveInsight - Persist an AI-generated insight
// ============================================================================

export async function saveInsight(entityIds: string[], insight: string): Promise<string> {
  const [row] = await db
    .insert(discoverInsights)
    .values({ entityIds, insight })
    .returning({ id: discoverInsights.id });
  return row.id;
}

// ============================================================================
// getSavedInsight - Retrieve a persisted insight by entity IDs
// ============================================================================

export async function getSavedInsight(entityIds: string[]): Promise<string | null> {
  // Sort IDs for consistent lookup
  const sorted = [...entityIds].sort();
  const rows = await db
    .select({ insight: discoverInsights.insight, entityIds: discoverInsights.entityIds })
    .from(discoverInsights)
    .orderBy(sql`${discoverInsights.createdAt} DESC`)
    .limit(50);

  for (const row of rows) {
    const savedIds = [...(row.entityIds as string[])].sort();
    if (savedIds.length === sorted.length && savedIds.every((id, i) => id === sorted[i])) {
      return row.insight;
    }
  }
  return null;
}

// ============================================================================
// getSavedInsightsMap - Retrieve all persisted insights as a map
// ============================================================================

export async function getSavedInsightsMap(): Promise<Map<string, string>> {
  const rows = await db
    .select({ entityIds: discoverInsights.entityIds, insight: discoverInsights.insight })
    .from(discoverInsights)
    .orderBy(sql`${discoverInsights.createdAt} DESC`);

  const map = new Map<string, string>();
  for (const row of rows) {
    const key = [...(row.entityIds as string[])].sort().join(",");
    if (!map.has(key)) {
      map.set(key, row.insight);
    }
  }
  return map;
}
