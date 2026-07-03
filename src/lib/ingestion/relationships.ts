export type ExtractedRelationshipCandidate = {
  source: string;
  target: string;
  type: string;
  description: string | null;
};

export type PlannedRelationshipInsert = {
  sourceEntityId: string;
  targetEntityId: string;
  relationType: string;
  description: string | null;
  sourceDocumentId: string;
};

export type RelationshipDropReason =
  | "source_unresolved"
  | "source_ambiguous"
  | "target_unresolved"
  | "target_ambiguous";

export type DroppedRelationship = {
  index: number;
  relationship: ExtractedRelationshipCandidate;
  reasons: RelationshipDropReason[];
};

export type PlanRelationshipInsertsInput = {
  sourceDocumentId: string;
  entityIdMap: ReadonlyMap<string, string>;
  relationships: readonly ExtractedRelationshipCandidate[];
};

export type PlanRelationshipInsertsResult = {
  values: PlannedRelationshipInsert[];
  dropped: DroppedRelationship[];
  duplicateCount: number;
};

type EntityResolution =
  | { status: "resolved"; entityId: string }
  | { status: "unresolved" }
  | { status: "ambiguous" };

export function planRelationshipInserts({
  sourceDocumentId,
  entityIdMap,
  relationships,
}: PlanRelationshipInsertsInput): PlanRelationshipInsertsResult {
  const entityNameIndex = buildEntityNameIndex(entityIdMap);
  const values: PlannedRelationshipInsert[] = [];
  const dropped: DroppedRelationship[] = [];
  const seenTriples = new Set<string>();
  let duplicateCount = 0;

  relationships.forEach((relationship, index) => {
    const source = resolveEntityName(entityNameIndex, relationship.source);
    const target = resolveEntityName(entityNameIndex, relationship.target);
    const reasons = relationshipDropReasons(source, target);

    if (reasons.length > 0) {
      dropped.push({ index, relationship, reasons });
      return;
    }

    if (source.status !== "resolved" || target.status !== "resolved") return;

    const sourceEntityId = source.entityId;
    const targetEntityId = target.entityId;
    const tripleKey = `${sourceEntityId}\0${targetEntityId}\0${normalizeKey(relationship.type)}`;

    if (seenTriples.has(tripleKey)) {
      duplicateCount += 1;
      return;
    }

    seenTriples.add(tripleKey);
    values.push({
      sourceEntityId,
      targetEntityId,
      relationType: relationship.type,
      description: relationship.description,
      sourceDocumentId,
    });
  });

  return { values, dropped, duplicateCount };
}

function buildEntityNameIndex(entityIdMap: ReadonlyMap<string, string>): Map<string, Set<string>> {
  const index = new Map<string, Set<string>>();

  for (const [entityKey, entityId] of entityIdMap.entries()) {
    const entityName = parseEntityName(entityKey);
    const normalizedName = normalizeKey(entityName);
    if (!normalizedName) continue;

    const ids = index.get(normalizedName) ?? new Set<string>();
    ids.add(entityId);
    index.set(normalizedName, ids);
  }

  return index;
}

function parseEntityName(entityKey: string): string {
  return entityKey.split("||", 1)[0] ?? entityKey;
}

function resolveEntityName(entityNameIndex: ReadonlyMap<string, ReadonlySet<string>>, name: string): EntityResolution {
  const ids = entityNameIndex.get(normalizeKey(name));
  if (!ids || ids.size === 0) return { status: "unresolved" };
  if (ids.size > 1) return { status: "ambiguous" };

  return { status: "resolved", entityId: Array.from(ids)[0] };
}

function relationshipDropReasons(source: EntityResolution, target: EntityResolution): RelationshipDropReason[] {
  const reasons: RelationshipDropReason[] = [];

  if (source.status === "unresolved") reasons.push("source_unresolved");
  if (source.status === "ambiguous") reasons.push("source_ambiguous");
  if (target.status === "unresolved") reasons.push("target_unresolved");
  if (target.status === "ambiguous") reasons.push("target_ambiguous");

  return reasons;
}

function normalizeKey(value: string): string {
  return value.trim().toLocaleLowerCase();
}
