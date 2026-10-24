import { getAIErrorMessage } from "@/lib/ai/errors";
import { refreshDocument, type DocumentIngestionEvent } from "@/lib/ingestion/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type UpdateRequest = {
  documentId: string;
  maxEntities?: number;
  maxRelationships?: number;
};

function createSSEMessage(event: DocumentIngestionEvent | { step: "done"; documentId?: string }) {
  return `data: ${JSON.stringify(event)}\n\n`;
}

export async function POST(req: Request) {
  const body: UpdateRequest = await req.json();

  if (!body.documentId) {
    return new Response("Missing documentId", { status: 400 });
  }

  const encoder = new TextEncoder();
  let cancelled = false;
  const stream = new ReadableStream({
    async start(controller) {
      let emittedError = false;
      const send = (event: Parameters<typeof createSSEMessage>[0]) => {
        if (!cancelled) controller.enqueue(encoder.encode(createSSEMessage(event)));
      };
      const onEvent = (event: DocumentIngestionEvent) => {
        if (event.error) emittedError = true;
        send(event);
      };

      try {
        const result = await refreshDocument(body.documentId, {
          maxEntities: body.maxEntities,
          maxRelationships: body.maxRelationships,
          onEvent,
        });

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
