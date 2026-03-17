import { streamText } from "ai";
import { z } from "zod";

import { getModel } from "@/lib/ai/client";
import { getChatConfigFromDB } from "@/lib/ai/config";
import {
  buildDiscoverInsightPrompt,
  DISCOVER_INSIGHT_SYSTEM_PROMPT,
  getDiscoverInsightContext,
  normalizeEntityIds,
  persistDiscoverInsight,
} from "@/lib/discover/insights";

const requestSchema = z.object({
  entityIds: z.array(z.string()).min(1).max(10),
});

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const parsed = requestSchema.safeParse(body);

    if (!parsed.success) {
      return Response.json(
        { error: "Request body must include 1 to 10 entityIds." },
        { status: 400 }
      );
    }

    const entityIds = normalizeEntityIds(parsed.data.entityIds);
    if (!entityIds.length) {
      return Response.json(
        { error: "Request body must include at least one valid entity id." },
        { status: 400 }
      );
    }

    const context = await getDiscoverInsightContext(entityIds);
    if (!context.entities.length) {
      return Response.json(
        { error: "No matching entities were found for this insight request." },
        { status: 404 }
      );
    }

    const chatConfig = await getChatConfigFromDB();
    const model = getModel(chatConfig);

    const result = streamText({
      model: model as Parameters<typeof streamText>[0]["model"],
      system: DISCOVER_INSIGHT_SYSTEM_PROMPT,
      prompt: buildDiscoverInsightPrompt(context, {
        includeKnowledgeBase: true,
      }),
      maxOutputTokens: 300,
      async onFinish({ text }) {
        try {
          await persistDiscoverInsight(context.entityIds, text);
        } catch (error) {
          console.error("Failed to persist discover insight:", error);
        }
      },
    });

    return result.toTextStreamResponse();
  } catch (error) {
    console.error("Discover insight generation failed:", error);
    return Response.json(
      { error: "Failed to generate discover insight." },
      { status: 500 }
    );
  }
}
