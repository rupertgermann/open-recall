import { z } from "zod";

const ingestionEventSchema = z.object({
  step: z.string(),
  message: z.string().optional(),
  progress: z.number().optional(),
  error: z.boolean().optional(),
  recoverable: z.boolean().optional(),
  documentId: z.string().optional(),
  folderImportPlan: z.object({
    folderId: z.string(),
    supportedCount: z.number(),
    skipped: z.array(z.object({ id: z.string(), name: z.string(), mimeType: z.string(), reason: z.string() })),
  }).optional(),
  summary: z.object({
    ingested: z.number(),
    refreshed: z.number(),
    skippedUnchanged: z.number(),
    skippedUnsupported: z.number(),
    failed: z.number(),
    failures: z.array(z.object({ fileId: z.string(), name: z.string(), error: z.string() })),
  }).optional(),
});

export type IngestionStreamEvent = z.infer<typeof ingestionEventSchema>;
export type FolderImportPlan = NonNullable<IngestionStreamEvent["folderImportPlan"]>;
export type FolderImportSummary = NonNullable<IngestionStreamEvent["summary"]>;

export async function readIngestionStream(
  response: Response,
  onEvent: (event: IngestionStreamEvent) => void = () => {}
): Promise<IngestionStreamEvent> {
  if (!response.ok) {
    const text = await response.text();
    let message = text.trim() || `Failed to start processing (${response.status})`;
    if (response.headers.get("content-type")?.includes("application/json")) {
      try {
        const error = z.object({ error: z.string().optional(), message: z.string().optional() }).safeParse(JSON.parse(text));
        if (error.success) message = error.data.error || error.data.message || message;
      } catch {
        throw new Error(message);
      }
    }
    throw new Error(message);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error("No response stream");
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const event = ingestionEventSchema.parse(JSON.parse(line.slice(6)));
        onEvent(event);
        if (event.error && !event.recoverable) throw new Error(event.message || "Processing failed");
        if (event.step === "done" || event.step === "folder_confirmation") return event;
      }
      if (done) throw new Error("Processing stream ended before completion");
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
}
