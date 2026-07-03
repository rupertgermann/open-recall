"use server";

import {
  ingestTextDocument,
  ingestUrlDocument,
  refreshDocument,
  type DocumentIngestionOptions,
} from "@/lib/ingestion/service";

export type IngestProgress = {
  step: "fetching" | "chunking" | "summarizing" | "tagging" | "extracting" | "embedding" | "saving" | "complete" | "error";
  message: string;
  progress?: number;
};

export type IngestResult = {
  success: boolean;
  documentId?: string;
  error?: string;
};

export async function reprocessDocument(
  documentId: string,
  _content?: string,
  options: DocumentIngestionOptions = {}
): Promise<void> {
  await refreshDocument(documentId, options);
}

export async function ingestUrl(url: string): Promise<IngestResult> {
  try {
    const result = await ingestUrlDocument(url);
    return { success: true, documentId: result.documentId };
  } catch (error) {
    console.error("Ingest URL error:", error);
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function ingestText(title: string, content: string): Promise<IngestResult> {
  try {
    const result = await ingestTextDocument({ title, content });
    return { success: true, documentId: result.documentId };
  } catch (error) {
    console.error("Ingest text error:", error);
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}
