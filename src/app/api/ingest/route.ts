import {
  ingestTextDocument,
  ingestUrlDocument,
  type DocumentIngestionEvent,
} from "@/lib/ingestion/service";
import { getAIErrorMessage } from "@/lib/ai/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type IngestRequest = {
  type: "url" | "text";
  url?: string;
  title?: string;
  content?: string;
  maxEntities?: number;
  maxRelationships?: number;
};

function createSSEMessage(event: DocumentIngestionEvent | { step: "done"; documentId?: string }) {
  return `data: ${JSON.stringify(event)}\n\n`;
}

export async function POST(req: Request) {
  const body: IngestRequest = await req.json();
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let emittedError = false;
      const onEvent = (event: DocumentIngestionEvent) => {
        if (event.error) emittedError = true;
        controller.enqueue(encoder.encode(createSSEMessage(event)));
      };

      try {
        const result =
          body.type === "url"
            ? await ingestUrlDocument(body.url ?? "", {
                maxEntities: body.maxEntities,
                maxRelationships: body.maxRelationships,
                onEvent,
              })
            : await ingestTextDocument(
                { title: body.title ?? "", content: body.content ?? "" },
                {
                  maxEntities: body.maxEntities,
                  maxRelationships: body.maxRelationships,
                  onEvent,
                }
              );

        controller.enqueue(encoder.encode(createSSEMessage({ step: "done", documentId: result.documentId })));
      } catch (error) {
        if (!emittedError) {
          controller.enqueue(
            encoder.encode(
              createSSEMessage({
                step: "error",
                message: getAIErrorMessage(error),
                progress: 0,
                error: true,
              })
            )
          );
        }
      } finally {
        controller.close();
      }
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
