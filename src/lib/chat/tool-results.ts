export type KnowledgeBaseDocumentRow = {
  title: string;
  type: string;
  summary?: string | null;
};

export type LookupEntityRow = {
  name: string;
  type: string;
  description?: string | null;
};

export type RelatedDocumentRow = {
  title: string;
  type: string;
  summary?: string | null;
  createdAt: Date;
};

export function formatKnowledgeBaseSearchResults(results: KnowledgeBaseDocumentRow[]): string {
  if (results.length === 0) return "No documents found matching the query.";

  return results
    .map((document) => `[${document.title}] (${document.type}): ${document.summary?.slice(0, 200) || "No summary"}`)
    .join("\n\n");
}

export function formatLookupEntityResults(results: LookupEntityRow[], name: string): string {
  if (results.length === 0) return `No entity found matching "${name}".`;

  return results
    .map((entity) => `**${entity.name}** (${entity.type}): ${entity.description || "No description"}`)
    .join("\n\n");
}

export function formatRelatedDocumentsResults(results: RelatedDocumentRow[], topic: string): string {
  if (results.length === 0) return `No documents found related to "${topic}".`;

  return results
    .map((document) => `- **${document.title}** (${document.type}, ${document.createdAt.toLocaleDateString()}): ${document.summary?.slice(0, 150) || "No summary"}...`)
    .join("\n");
}
