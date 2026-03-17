import "server-only";

import { desc, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  discoverInsights,
  documents,
  entities,
  entityMentions,
  relationships,
} from "@/db/schema";
import {
  buildUndirectedAdjacency,
  countHiddenConnectionPairs,
  getArticulationPoints,
  getConnectedComponents,
} from "@/lib/discover/graph";
import type { DiscoverEdge } from "@/lib/discover/graph";
import type {
  BridgeEntity,
  DiscoverData,
  DiscoverDocumentReference,
  DiscoverEntitySummary,
  DiscoverRelatedEntity,
  DiscoverStats,
  HiddenConnection,
  KnowledgeCluster,
} from "@/lib/discover/types";
import { getInsightKey, normalizeEntityIds } from "@/lib/discover/utils";

type GraphSnapshot = {
  entities: DiscoverEntitySummary[];
  adjacency: Map<string, Set<string>>;
  relationshipCount: number;
};

type HiddenConnectionRow = {
  entity_a_id: string;
  bridge_id: string;
  entity_b_id: string;
  rel_a_bridge: string;
  rel_bridge_b: string;
};

const MAX_HIDDEN_CONNECTIONS = 10;
const HIDDEN_CONNECTION_QUERY_LIMIT = 60;
const MAX_BRIDGE_ENTITIES = 10;
const MAX_CONNECTED_ENTITIES = 20;
const MAX_KNOWLEDGE_CLUSTERS = 10;
const MAX_CLUSTER_MEMBERS = 20;
const MAX_CLUSTER_BRIDGES = 5;
const MIN_BRIDGE_DEGREE = 3;

export async function saveDiscoverInsight(
  entityIds: string[],
  insight: string
): Promise<string> {
  const normalizedEntityIds = normalizeEntityIds(entityIds);
  const trimmedInsight = insight.trim();

  if (!normalizedEntityIds.length || !trimmedInsight) {
    throw new Error("entityIds and insight are required");
  }

  const [row] = await db
    .insert(discoverInsights)
    .values({
      entityIds: normalizedEntityIds,
      insight: trimmedInsight,
    })
    .returning({ id: discoverInsights.id });

  return row.id;
}

export async function getSavedInsightsRecord(): Promise<Record<string, string>> {
  const rows = await db
    .select({
      entityIds: discoverInsights.entityIds,
      insight: discoverInsights.insight,
    })
    .from(discoverInsights)
    .orderBy(desc(discoverInsights.createdAt));

  const savedInsights: Record<string, string> = {};

  for (const row of rows) {
    const key = getInsightKey(row.entityIds as string[]);
    if (!savedInsights[key]) {
      savedInsights[key] = row.insight;
    }
  }

  return savedInsights;
}

export async function getDiscoverData(): Promise<DiscoverData> {
  const [graphSnapshot, connections, savedInsights] = await Promise.all([
    loadGraphSnapshot(),
    getHiddenConnections(),
    getSavedInsightsRecord(),
  ]);
  const clusters = buildKnowledgeClusters(graphSnapshot);

  return {
    stats: {
      totalEntities: graphSnapshot.entities.length,
      totalRelationships: graphSnapshot.relationshipCount,
      clustersFound: clusters.length,
      potentialInsights: countHiddenConnectionPairs(graphSnapshot.adjacency),
    },
    connections,
    bridges: buildBridgeEntities(graphSnapshot),
    clusters,
    savedInsights,
  };
}

export async function getHiddenConnections(): Promise<HiddenConnection[]> {
  const rows = (await db.execute(sql`
    WITH undirected AS (
      SELECT
        source_entity_id AS left_id,
        target_entity_id AS right_id,
        relation_type
      FROM relationships
      UNION ALL
      SELECT
        target_entity_id AS left_id,
        source_entity_id AS right_id,
        relation_type
      FROM relationships
    ),
    two_hop AS (
      SELECT DISTINCT
        u1.left_id AS entity_a_id,
        u1.right_id AS bridge_id,
        u2.right_id AS entity_b_id,
        u1.relation_type AS rel_a_bridge,
        u2.relation_type AS rel_bridge_b
      FROM undirected u1
      INNER JOIN undirected u2
        ON u1.right_id = u2.left_id
      WHERE u1.left_id <> u2.right_id
        AND u1.left_id < u2.right_id
    ),
    direct AS (
      SELECT source_entity_id AS entity_a_id, target_entity_id AS entity_b_id
      FROM relationships
      UNION
      SELECT target_entity_id AS entity_a_id, source_entity_id AS entity_b_id
      FROM relationships
    )
    SELECT
      th.entity_a_id,
      th.bridge_id,
      th.entity_b_id,
      th.rel_a_bridge,
      th.rel_bridge_b
    FROM two_hop th
    WHERE NOT EXISTS (
      SELECT 1
      FROM direct d
      WHERE d.entity_a_id = th.entity_a_id
        AND d.entity_b_id = th.entity_b_id
    )
    LIMIT ${HIDDEN_CONNECTION_QUERY_LIMIT}
  `)) as unknown as HiddenConnectionRow[];

  if (!rows.length) {
    return [];
  }

  const entityIds = new Set<string>();
  const endpointIds = new Set<string>();

  for (const row of rows) {
    entityIds.add(row.entity_a_id);
    entityIds.add(row.bridge_id);
    entityIds.add(row.entity_b_id);
    endpointIds.add(row.entity_a_id);
    endpointIds.add(row.entity_b_id);
  }

  const [entityList, documentRows] = await Promise.all([
    db
      .select({
        id: entities.id,
        name: entities.name,
        type: entities.type,
        description: entities.description,
      })
      .from(entities)
      .where(inArray(entities.id, Array.from(entityIds))),
    db
      .selectDistinct({
        entityId: entityMentions.entityId,
        id: documents.id,
        title: documents.title,
      })
      .from(entityMentions)
      .innerJoin(documents, eq(entityMentions.documentId, documents.id))
      .where(inArray(entityMentions.entityId, Array.from(endpointIds))),
  ]);

  const entityById = new Map(entityList.map((entity) => [entity.id, entity]));
  const documentsByEntityId = new Map<string, DiscoverDocumentReference[]>();

  for (const row of documentRows) {
    const currentDocuments = documentsByEntityId.get(row.entityId) ?? [];
    if (currentDocuments.length < 3) {
      currentDocuments.push({ id: row.id, title: row.title });
      documentsByEntityId.set(row.entityId, currentDocuments);
    }
  }

  const connections = new Map<string, HiddenConnection>();

  for (const row of rows) {
    const entityA = entityById.get(row.entity_a_id);
    const bridge = entityById.get(row.bridge_id);
    const entityB = entityById.get(row.entity_b_id);

    if (!entityA || !bridge || !entityB) {
      continue;
    }

    const key = getInsightKey([entityA.id, bridge.id, entityB.id]);
    if (connections.has(key)) {
      continue;
    }

    const sourceDocuments = new Map<string, DiscoverDocumentReference>();
    for (const document of documentsByEntityId.get(entityA.id) ?? []) {
      sourceDocuments.set(document.id, document);
    }
    for (const document of documentsByEntityId.get(entityB.id) ?? []) {
      sourceDocuments.set(document.id, document);
    }

    connections.set(key, {
      key,
      entityA,
      bridge,
      entityB,
      relationABridge: row.rel_a_bridge,
      relationBridgeB: row.rel_bridge_b,
      sourceDocuments: Array.from(sourceDocuments.values()),
    });
  }

  return Array.from(connections.values())
    .sort((left, right) => {
      const documentDelta = right.sourceDocuments.length - left.sourceDocuments.length;
      return documentDelta || left.key.localeCompare(right.key);
    })
    .slice(0, MAX_HIDDEN_CONNECTIONS);
}

export async function getBridgeEntities(): Promise<BridgeEntity[]> {
  return buildBridgeEntities(await loadGraphSnapshot());
}

export async function getKnowledgeClusters(): Promise<KnowledgeCluster[]> {
  return buildKnowledgeClusters(await loadGraphSnapshot());
}

export async function getDiscoverStats(): Promise<DiscoverStats> {
  const graphSnapshot = await loadGraphSnapshot();

  return {
    totalEntities: graphSnapshot.entities.length,
    totalRelationships: graphSnapshot.relationshipCount,
    clustersFound: buildKnowledgeClusters(graphSnapshot).length,
    potentialInsights: countHiddenConnectionPairs(graphSnapshot.adjacency),
  };
}

async function loadGraphSnapshot(): Promise<GraphSnapshot> {
  const [entityList, relationshipList] = await Promise.all([
    db
      .select({
        id: entities.id,
        name: entities.name,
        type: entities.type,
        description: entities.description,
      })
      .from(entities),
    db
      .select({
        sourceId: relationships.sourceEntityId,
        targetId: relationships.targetEntityId,
      })
      .from(relationships),
  ]);

  return {
    entities: entityList,
    adjacency: buildUndirectedAdjacency(relationshipList as DiscoverEdge[]),
    relationshipCount: relationshipList.length,
  };
}

function buildBridgeEntities(snapshot: GraphSnapshot): BridgeEntity[] {
  const entityById = new Map(snapshot.entities.map((entity) => [entity.id, entity]));
  const articulationPoints = getArticulationPoints(snapshot.adjacency);

  return Array.from(snapshot.adjacency.entries())
    .map(([entityId, neighbors]) => ({
      entityId,
      degree: neighbors.size,
      splitCount: neighbors.size >= 2 ? countNeighborGroups(entityId, snapshot.adjacency) : 1,
      isArticulationPoint: articulationPoints.has(entityId),
    }))
    .filter((entry) => entry.degree >= MIN_BRIDGE_DEGREE)
    .sort((left, right) => {
      if (left.isArticulationPoint !== right.isArticulationPoint) {
        return left.isArticulationPoint ? -1 : 1;
      }
      if (right.splitCount !== left.splitCount) {
        return right.splitCount - left.splitCount;
      }
      if (right.degree !== left.degree) {
        return right.degree - left.degree;
      }
      return (entityById.get(left.entityId)?.name ?? "").localeCompare(
        entityById.get(right.entityId)?.name ?? ""
      );
    })
    .slice(0, MAX_BRIDGE_ENTITIES)
    .flatMap((entry) => {
      const entity = entityById.get(entry.entityId);
      if (!entity) {
        return [];
      }

      const connectedEntities = Array.from(snapshot.adjacency.get(entry.entityId) ?? [])
        .map((neighborId) => entityById.get(neighborId))
        .filter((neighbor): neighbor is DiscoverEntitySummary => Boolean(neighbor))
        .sort((left, right) => {
          const leftDegree = snapshot.adjacency.get(left.id)?.size ?? 0;
          const rightDegree = snapshot.adjacency.get(right.id)?.size ?? 0;
          return rightDegree - leftDegree || left.name.localeCompare(right.name);
        })
        .slice(0, MAX_CONNECTED_ENTITIES)
        .map(toRelatedEntity);

      return [
        {
          ...entity,
          connectionCount: entry.degree,
          connectedEntities,
        },
      ];
    });
}

function buildKnowledgeClusters(snapshot: GraphSnapshot): KnowledgeCluster[] {
  if (snapshot.adjacency.size === 0) {
    return [];
  }

  const entityById = new Map(snapshot.entities.map((entity) => [entity.id, entity]));
  const articulationIds = new Set(
    Array.from(getArticulationPoints(snapshot.adjacency)).filter(
      (entityId) => (snapshot.adjacency.get(entityId)?.size ?? 0) >= MIN_BRIDGE_DEGREE
    )
  );

  const components = getConnectedComponents(snapshot.adjacency, articulationIds);
  const effectiveComponents =
    components.length > 0 ? components : getConnectedComponents(snapshot.adjacency);

  return effectiveComponents
    .map((component) => {
      const componentSet = new Set(component);
      const members = component
        .map((entityId) => entityById.get(entityId))
        .filter((entity): entity is DiscoverEntitySummary => Boolean(entity))
        .sort((left, right) => {
          const leftDegree = getInternalDegree(left.id, componentSet, snapshot.adjacency);
          const rightDegree = getInternalDegree(right.id, componentSet, snapshot.adjacency);
          return rightDegree - leftDegree || left.name.localeCompare(right.name);
        });

      if (members.length < 2) {
        return null;
      }

      const bridgeEntities = Array.from(articulationIds)
        .filter((entityId) =>
          Array.from(snapshot.adjacency.get(entityId) ?? []).some((neighborId) =>
            componentSet.has(neighborId)
          )
        )
        .map((entityId) => entityById.get(entityId))
        .filter((entity): entity is DiscoverEntitySummary => Boolean(entity))
        .sort((left, right) => {
          const leftDegree = snapshot.adjacency.get(left.id)?.size ?? 0;
          const rightDegree = snapshot.adjacency.get(right.id)?.size ?? 0;
          return rightDegree - leftDegree || left.name.localeCompare(right.name);
        })
        .slice(0, MAX_CLUSTER_BRIDGES)
        .map(toRelatedEntity);

      return {
        id: getInsightKey(component),
        name: `${members[0].name} cluster`,
        dominantType: getDominantType(members),
        members: members.slice(0, MAX_CLUSTER_MEMBERS).map(toRelatedEntity),
        memberCount: members.length,
        bridgeEntities,
      };
    })
    .filter((cluster): cluster is KnowledgeCluster => Boolean(cluster))
    .sort((left, right) => {
      return right.memberCount - left.memberCount || left.name.localeCompare(right.name);
    })
    .slice(0, MAX_KNOWLEDGE_CLUSTERS);
}

function countNeighborGroups(
  entityId: string,
  adjacency: ReadonlyMap<string, ReadonlySet<string>>
): number {
  const neighbors = adjacency.get(entityId);
  if (!neighbors || neighbors.size < 2) {
    return 1;
  }

  const visited = new Set<string>();
  let groupCount = 0;

  for (const neighbor of neighbors) {
    if (visited.has(neighbor)) {
      continue;
    }

    groupCount += 1;
    const queue = [neighbor];
    visited.add(neighbor);

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) {
        continue;
      }

      for (const nextNeighbor of adjacency.get(current) ?? []) {
        if (nextNeighbor === entityId || visited.has(nextNeighbor)) {
          continue;
        }

        visited.add(nextNeighbor);
        queue.push(nextNeighbor);
      }
    }
  }

  return groupCount;
}

function getInternalDegree(
  entityId: string,
  component: ReadonlySet<string>,
  adjacency: ReadonlyMap<string, ReadonlySet<string>>
): number {
  let degree = 0;

  for (const neighbor of adjacency.get(entityId) ?? []) {
    if (component.has(neighbor)) {
      degree += 1;
    }
  }

  return degree;
}

function getDominantType(members: DiscoverEntitySummary[]): string {
  const typeCounts = new Map<string, number>();

  for (const member of members) {
    typeCounts.set(member.type, (typeCounts.get(member.type) ?? 0) + 1);
  }

  return (
    Array.from(typeCounts.entries()).sort((left, right) => {
      return right[1] - left[1] || left[0].localeCompare(right[0]);
    })[0]?.[0] ?? "other"
  );
}

function toRelatedEntity(entity: DiscoverEntitySummary): DiscoverRelatedEntity {
  return {
    id: entity.id,
    name: entity.name,
    type: entity.type,
  };
}
