export function normalizeEntityIds(entityIds: readonly string[]): string[] {
  return Array.from(
    new Set(entityIds.map((entityId) => entityId.trim()).filter(Boolean))
  ).sort();
}

export function getInsightKey(entityIds: readonly string[]): string {
  return normalizeEntityIds(entityIds).join(",");
}
