import type { ChatSourceReference } from "./types";

export type ChatSourceChunk = {
  documentId: string;
  documentTitle: string;
  score: number;
};

export function fallbackTitleFromUserText(text: string): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return "New chat";
  return cleaned.length > 60 ? `${cleaned.slice(0, 57)}...` : cleaned;
}

export function dedupeChatSources(chunks: ChatSourceChunk[]): ChatSourceReference[] {
  const sourceMap = new Map<string, ChatSourceReference>();

  for (const chunk of chunks) {
    const existing = sourceMap.get(chunk.documentId);
    if (!existing || chunk.score > existing.score) {
      sourceMap.set(chunk.documentId, {
        documentId: chunk.documentId,
        title: chunk.documentTitle,
        score: chunk.score,
      });
    }
  }

  return Array.from(sourceMap.values());
}

export type ChatCategoryContext = {
  chunks: { documentId: string }[];
  entities: { id: string }[];
};

export type ChatCategoryDecision =
  | { category: "entity"; entityId: string }
  | { category: "document"; documentId: string }
  | { category: "general" };

export function detectChatCategoryFromContext(context: ChatCategoryContext): ChatCategoryDecision {
  const topEntity = context.entities[0];
  if (topEntity) {
    return { category: "entity", entityId: topEntity.id };
  }

  const documentCounts = new Map<string, number>();
  for (const chunk of context.chunks) {
    documentCounts.set(chunk.documentId, (documentCounts.get(chunk.documentId) ?? 0) + 1);
  }

  let topDocumentId: string | null = null;
  let topCount = 0;
  for (const [documentId, count] of documentCounts.entries()) {
    if (count > topCount) {
      topDocumentId = documentId;
      topCount = count;
    }
  }

  return topDocumentId ? { category: "document", documentId: topDocumentId } : { category: "general" };
}
