export type ScoredResult = {
  id: string;
  score: number;
};

export type DocumentScopedResult = ScoredResult & {
  documentId: string;
};

export type EntityMatch = ScoredResult & {
  name: string;
  type: string;
  description: string | null;
};

export function distanceToSimilarity(distance: number | null | undefined): number {
  if (typeof distance !== "number" || !Number.isFinite(distance)) {
    return 0;
  }

  return 1 - distance;
}

export function mergeScoredResults<T extends ScoredResult>(
  sources: readonly (readonly T[])[],
  options: { limit: number }
): T[] {
  const byId = new Map<string, { item: T; order: number }>();
  let order = 0;

  for (const source of sources) {
    for (const item of source) {
      const current = byId.get(item.id);
      if (!current || item.score > current.item.score) {
        byId.set(item.id, { item, order });
      }
      order += 1;
    }
  }

  return Array.from(byId.values())
    .sort((left, right) => right.item.score - left.item.score || left.order - right.order)
    .slice(0, Math.max(0, options.limit))
    .map(({ item }) => item);
}

export function filterByMinimumScore<T extends ScoredResult>(
  items: readonly T[],
  minimumScore: number
): T[] {
  return items.filter((item) => item.score >= minimumScore);
}

export function sortChunksByDocumentPriority<T extends DocumentScopedResult>(
  chunks: readonly T[],
  prioritizedDocumentId?: string | null
): T[] {
  return [...chunks].sort((left, right) => {
    if (prioritizedDocumentId) {
      const leftIsPrioritized = left.documentId === prioritizedDocumentId;
      const rightIsPrioritized = right.documentId === prioritizedDocumentId;

      if (leftIsPrioritized !== rightIsPrioritized) {
        return leftIsPrioritized ? -1 : 1;
      }
    }

    return right.score - left.score;
  });
}

export function mergeEntityMatches<T extends EntityMatch>(
  vectorMatches: readonly T[],
  nameMatches: readonly T[],
  limit: number
): T[] {
  return mergeScoredResults([nameMatches, vectorMatches], { limit });
}

export function scoreEntityNameMatch(query: string, entityName: string): number | null {
  const normalizedQuery = normalizeSearchText(query);
  const normalizedName = normalizeSearchText(entityName);

  if (!normalizedQuery || !normalizedName) {
    return null;
  }

  if (normalizedQuery === normalizedName) {
    return 1;
  }

  if (containsPhrase(normalizedQuery, normalizedName)) {
    return 0.95;
  }

  if (containsPhrase(normalizedName, normalizedQuery)) {
    return 0.9;
  }

  return null;
}

export function buildEntityNameSearchTerms(
  query: string,
  options: { maxWordsPerTerm?: number; maxTerms?: number } = {}
): string[] {
  const words = normalizeSearchText(query).split(" ").filter(Boolean);
  const maxWordsPerTerm = Math.max(1, options.maxWordsPerTerm ?? 5);
  const maxTerms = Math.max(0, options.maxTerms ?? 80);
  const terms: string[] = [];
  const seen = new Set<string>();

  for (let start = 0; start < words.length && terms.length < maxTerms; start += 1) {
    for (
      let wordCount = 1;
      wordCount <= maxWordsPerTerm &&
        start + wordCount <= words.length &&
        terms.length < maxTerms;
      wordCount += 1
    ) {
      const term = words.slice(start, start + wordCount).join(" ");
      if (!seen.has(term)) {
        seen.add(term);
        terms.push(term);
      }
    }
  }

  return terms;
}

function normalizeSearchText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function containsPhrase(haystack: string, needle: string): boolean {
  return ` ${haystack} `.includes(` ${needle} `);
}
