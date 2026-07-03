export type DocumentReingestCleanupPlan = {
  documentId: string;
  deleteOrder: readonly ["entityMentions", "relationships", "chunks"];
  targets: {
    chunks: { documentId: string };
    entityMentions: { documentId: string };
    relationships: { sourceDocumentId: string };
  };
};

export function planDocumentReingestCleanup(documentId: string): DocumentReingestCleanupPlan {
  return {
    documentId,
    deleteOrder: ["entityMentions", "relationships", "chunks"],
    targets: {
      chunks: { documentId },
      entityMentions: { documentId },
      relationships: { sourceDocumentId: documentId },
    },
  };
}
