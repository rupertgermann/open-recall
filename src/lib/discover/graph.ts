export type DiscoverEdge = {
  sourceId: string;
  targetId: string;
};

function getPairKey(left: string, right: string) {
  return left < right ? `${left}:${right}` : `${right}:${left}`;
}

export function buildUndirectedAdjacency(
  edges: readonly DiscoverEdge[]
): Map<string, Set<string>> {
  const adjacency = new Map<string, Set<string>>();

  for (const { sourceId, targetId } of edges) {
    if (!adjacency.has(sourceId)) {
      adjacency.set(sourceId, new Set());
    }
    if (!adjacency.has(targetId)) {
      adjacency.set(targetId, new Set());
    }
    if (sourceId === targetId) {
      continue;
    }
    adjacency.get(sourceId)?.add(targetId);
    adjacency.get(targetId)?.add(sourceId);
  }

  return adjacency;
}

export function getConnectedComponents(
  adjacency: ReadonlyMap<string, ReadonlySet<string>>,
  excludedNodeIds: ReadonlySet<string> = new Set()
): string[][] {
  const visited = new Set<string>();
  const components: string[][] = [];

  for (const nodeId of adjacency.keys()) {
    if (visited.has(nodeId) || excludedNodeIds.has(nodeId)) {
      continue;
    }

    const queue = [nodeId];
    const component: string[] = [];
    visited.add(nodeId);

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) {
        continue;
      }

      component.push(current);

      for (const neighbor of adjacency.get(current) ?? []) {
        if (visited.has(neighbor) || excludedNodeIds.has(neighbor)) {
          continue;
        }
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }

    if (component.length >= 2) {
      components.push(component);
    }
  }

  return components;
}

export function getArticulationPoints(
  adjacency: ReadonlyMap<string, ReadonlySet<string>>,
  nodeIds?: readonly string[]
): Set<string> {
  const allowedNodeIds = nodeIds ? new Set(nodeIds) : new Set(adjacency.keys());
  const discoveryTime = new Map<string, number>();
  const lowLink = new Map<string, number>();
  const parent = new Map<string, string | null>();
  const articulationPoints = new Set<string>();
  let time = 0;

  function visit(nodeId: string) {
    discoveryTime.set(nodeId, time);
    lowLink.set(nodeId, time);
    time += 1;

    let childCount = 0;

    for (const neighbor of adjacency.get(nodeId) ?? []) {
      if (!allowedNodeIds.has(neighbor)) {
        continue;
      }

      if (!discoveryTime.has(neighbor)) {
        parent.set(neighbor, nodeId);
        childCount += 1;
        visit(neighbor);

        lowLink.set(
          nodeId,
          Math.min(lowLink.get(nodeId) ?? 0, lowLink.get(neighbor) ?? 0)
        );

        if (parent.get(nodeId) === null && childCount > 1) {
          articulationPoints.add(nodeId);
        }

        if (
          parent.get(nodeId) !== null &&
          (lowLink.get(neighbor) ?? 0) >= (discoveryTime.get(nodeId) ?? 0)
        ) {
          articulationPoints.add(nodeId);
        }
      } else if (neighbor !== parent.get(nodeId)) {
        lowLink.set(
          nodeId,
          Math.min(lowLink.get(nodeId) ?? 0, discoveryTime.get(neighbor) ?? 0)
        );
      }
    }
  }

  for (const nodeId of allowedNodeIds) {
    if (discoveryTime.has(nodeId) || !adjacency.has(nodeId)) {
      continue;
    }

    parent.set(nodeId, null);
    visit(nodeId);
  }

  return articulationPoints;
}

export function countHiddenConnectionPairs(
  adjacency: ReadonlyMap<string, ReadonlySet<string>>
): number {
  const directPairs = new Set<string>();

  for (const [nodeId, neighbors] of adjacency.entries()) {
    for (const neighbor of neighbors) {
      directPairs.add(getPairKey(nodeId, neighbor));
    }
  }

  let count = 0;

  for (const entityA of adjacency.keys()) {
    const hiddenTargets = new Set<string>();

    for (const bridgeId of adjacency.get(entityA) ?? []) {
      for (const entityB of adjacency.get(bridgeId) ?? []) {
        if (entityA >= entityB || directPairs.has(getPairKey(entityA, entityB))) {
          continue;
        }
        hiddenTargets.add(entityB);
      }
    }

    count += hiddenTargets.size;
  }

  return count;
}
