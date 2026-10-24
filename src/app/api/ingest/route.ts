import {
  ingestDriveFolder,
  ingestTextDocument,
  ingestUrlDocument,
  type DocumentIngestionEvent,
} from "@/lib/ingestion/service";
import { getAIErrorMessage } from "@/lib/ai/errors";
import { buildDriveFolderImportPlan, parseDriveUrl } from "@/lib/drive";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type IngestRequest = {
  type: "url" | "text";
  url?: string;
  title?: string;
  content?: string;
  maxEntities?: number;
  maxRelationships?: number;
  confirmFolderImport?: boolean;
};

function createSSEMessage(event: DocumentIngestionEvent | Record<string, unknown>) {
  return `data: ${JSON.stringify(event)}\n\n`;
}

export async function POST(req: Request) {
  const body: IngestRequest = await req.json();
  const encoder = new TextEncoder();
  let cancelled = false;

  const stream = new ReadableStream({
    async start(controller) {
      let emittedError = false;
      const send = (event: DocumentIngestionEvent | Record<string, unknown>) => {
        if (!cancelled) controller.enqueue(encoder.encode(createSSEMessage(event)));
      };
      const onEvent = (event: DocumentIngestionEvent) => {
        if (event.error && !event.recoverable) emittedError = true;
        send(event);
      };

      try {
        if (body.type === "url") {
          const url = body.url ?? "";
          const driveLink = parseDriveUrl(url);
          if (driveLink?.kind === "folder" && !body.confirmFolderImport) {
            const plan = await buildDriveFolderImportPlan(url);
            send({
              step: "folder_confirmation",
              message: "Confirm Folder Import",
              progress: 0,
              folderImportPlan: {
                folderId: plan.folderId,
                supportedCount: plan.supported.length,
                skipped: plan.skipped.map((file) => ({
                  id: file.id,
                  name: file.name,
                  mimeType: file.mimeType,
                  reason: file.reason,
                })),
              },
            });
            return;
          }

          const result = driveLink?.kind === "folder"
            ? await ingestDriveFolder(url, {
                maxEntities: body.maxEntities,
                maxRelationships: body.maxRelationships,
                onEvent,
              })
            : await ingestUrlDocument(url, {
                maxEntities: body.maxEntities,
                maxRelationships: body.maxRelationships,
                onEvent,
              });

          send({
            step: "done",
            documentId: "documentId" in result ? result.documentId : undefined,
            summary: "summary" in result ? result.summary : undefined,
          });
          return;
        }

        const result = await ingestTextDocument(
          { title: body.title ?? "", content: body.content ?? "" },
          {
            maxEntities: body.maxEntities,
            maxRelationships: body.maxRelationships,
            onEvent,
          }
        );

        send({ step: "done", documentId: result.documentId });
      } catch (error) {
        if (!emittedError) {
          send({
            step: "error",
            message: getAIErrorMessage(error),
            progress: 0,
            error: true,
          });
        }
      } finally {
        if (!cancelled) controller.close();
      }
    },
    cancel() {
      cancelled = true;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
}
