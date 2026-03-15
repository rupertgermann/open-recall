import { streamText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { getChatConfigFromDB, type ChatConfig } from "@/lib/ai/config";
import { db } from "@/db";
import { entities, relationships, entityMentions, documents, discoverInsights } from "@/db/schema";
import { sql, eq } from "drizzle-orm";

function createAIClient(config: ChatConfig) {
  return createOpenAI({
    baseURL: config.baseUrl,
    apiKey: config.apiKey || "ollama",
  });
}

function getModelFromConfig(config: ChatConfig) {
  const client = createAIClient(config);
  return client(config.model);
}

export async function POST(req: Request) {
  const { entityIds }: { entityIds: string[] } = await req.json();

  if (!entityIds || entityIds.length === 0) {
    return new Response("entityIds required", { status: 400 });
  }

  const chatConfig = await getChatConfigFromDB();
  const model = getModelFromConfig(chatConfig);

  // Fetch entity details
  const entityList = await db
    .select({
      id: entities.id,
      name: entities.name,
      type: entities.type,
      description: entities.description,
    })
    .from(entities)
    .where(sql`${entities.id} IN ${entityIds}`);

  // Fetch relationships involving these entities
  const rels = await db
    .select({
      sourceId: relationships.sourceEntityId,
      targetId: relationships.targetEntityId,
      relationType: relationships.relationType,
      description: relationships.description,
    })
    .from(relationships)
    .where(
      sql`${relationships.sourceEntityId} IN ${entityIds} OR ${relationships.targetEntityId} IN ${entityIds}`
    );

  // Fetch source documents
  const docs = await db
    .selectDistinct({
      id: documents.id,
      title: documents.title,
      summary: documents.summary,
    })
    .from(documents)
    .innerJoin(entityMentions, eq(entityMentions.documentId, documents.id))
    .where(sql`${entityMentions.entityId} IN ${entityIds}`)
    .limit(10);

  const entityContext = entityList
    .map((e) => `- ${e.name} (${e.type}): ${e.description || "No description"}`)
    .join("\n");

  const relContext = rels
    .map((r) => {
      const source = entityList.find((e) => e.id === r.sourceId);
      const target = entityList.find((e) => e.id === r.targetId);
      return `- ${source?.name || "Unknown"} --[${r.relationType}]--> ${target?.name || "Unknown"}${r.description ? `: ${r.description}` : ""}`;
    })
    .join("\n");

  const docContext = docs
    .map((d) => `- "${d.title}": ${d.summary?.slice(0, 200) || "No summary"}`)
    .join("\n");

  const result = streamText({
    model: model as Parameters<typeof streamText>[0]["model"],
    system: `You are an insight engine for a personal knowledge base. Your job is to find surprising, non-obvious connections between entities and explain why they matter. Be concise but insightful. Write 2-4 sentences that reveal a hidden pattern or connection the user might not have noticed. Use a warm, engaging tone.`,
    prompt: `Analyze these entities and their connections from the user's knowledge base. What surprising insight or hidden pattern do you see?

Entities:
${entityContext}

Relationships:
${relContext || "No direct relationships between these entities."}

Source Documents:
${docContext || "No source documents found."}

Generate a brief, insightful observation about the hidden connection between these entities. Focus on what makes this connection surprising or valuable.`,
    maxOutputTokens: 300,
    async onFinish({ text }) {
      if (text) {
        await db.insert(discoverInsights).values({ entityIds, insight: text });
      }
    },
  });

  return result.toTextStreamResponse();
}
