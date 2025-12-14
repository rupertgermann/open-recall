import { streamText, convertToModelMessages, type UIMessage } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { retrieveContext, buildPromptContext } from "@/actions/chat";
import { getChatConfigFromDB, type ChatConfig } from "@/lib/ai/config";
import { db } from "@/db";
import { chatMessages, chatThreads } from "@/db/schema";
import { eq } from "drizzle-orm";

// Helper to create AI client from config
function createAIClient(config: ChatConfig) {
  return createOpenAI({
    baseURL: config.baseUrl,
    apiKey: config.apiKey || "ollama",
  });
}

// Helper to get model instance based on provider
function getModelFromConfig(config: ChatConfig) {
  const client = createAIClient(config);
  
  // Use responses API for OpenAI, default for others
  if (config.provider === "openai") {
    const anyClient = client as unknown as { responses?: (modelId: string) => unknown };
    if (typeof anyClient.responses === "function") {
      return anyClient.responses(config.model);
    }
  }
  
  return client(config.model);
}

function getLastUserText(messages: UIMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "user") continue;
    const textPart = m.parts.find((p) => p.type === "text");
    if (textPart && "text" in textPart) {
      return textPart.text;
    }
  }
  return null;
}

async function ensureThread(threadId?: string | null): Promise<string> {
  if (threadId) {
    const existing = await db
      .select({ id: chatThreads.id })
      .from(chatThreads)
      .where(eq(chatThreads.id, threadId))
      .limit(1);
    if (existing.length > 0) return existing[0].id;
  }

  const [created] = await db
    .insert(chatThreads)
    .values({})
    .returning({ id: chatThreads.id });
  return created.id;
}

export async function POST(req: Request) {
  const {
    messages,
    threadId,
  }: {
    messages: UIMessage[];
    threadId?: string;
  } = await req.json();

  const effectiveThreadId = await ensureThread(threadId);

  // Load chat configuration from database
  const chatConfig = await getChatConfigFromDB();

  // Get the latest user message for retrieval
  const lastUserText = getLastUserText(messages);
  
  // Retrieve relevant context using hybrid search
  let contextString = "";
  let retrievedData: Awaited<ReturnType<typeof retrieveContext>> = { 
    chunks: [], 
    entities: [], 
    graphContext: "" 
  };
  
  if (lastUserText) {
    try {
      retrievedData = await retrieveContext(lastUserText, 5);
      contextString = await buildPromptContext(retrievedData);
    } catch (error) {
      console.error("Context retrieval failed:", error);
    }
  }

  const systemPrompt = `You are a helpful AI assistant with access to the user's personal knowledge base.
Your role is to answer questions accurately based on the retrieved context from their documents.

${contextString ? `Here is the relevant context from the knowledge base:\n\n${contextString}` : "No relevant context was found in the knowledge base."}

Guidelines:
- If the context contains relevant information, use it to answer the question accurately.
- If the context doesn't contain enough information, say so clearly and provide general knowledge if appropriate.
- Always cite which documents or entities your information comes from when possible.
- Be concise but thorough in your responses.
- If you're unsure about something, acknowledge the uncertainty.`;

  // Get model from DB-backed config
  const model = getModelFromConfig(chatConfig);

  const result = streamText({
    model: model as Parameters<typeof streamText>[0]["model"],
    system: systemPrompt,
    messages: convertToModelMessages(messages),
  });

  // Ensure the stream runs to completion and triggers onFinish even if the client disconnects.
  // (best-effort; ignore errors)
  try {
    result.consumeStream();
  } catch {
    // ignore
  }

  // Persist latest user message (best-effort).
  try {
    if (lastUserText) {
      await db.insert(chatMessages).values({
        threadId: effectiveThreadId,
        role: "user",
        content: lastUserText,
      });
      await db
        .update(chatThreads)
        .set({ lastMessageAt: new Date(), updatedAt: new Date() })
        .where(eq(chatThreads.id, effectiveThreadId));
    }
  } catch (error) {
    console.error("Failed to persist user chat message:", error);
  }

  // Return a UI message stream so the client gets structured message parts.
  return result.toUIMessageStreamResponse({
    headers: {
      "X-Chat-Thread-Id": effectiveThreadId,
      "X-Retrieved-Sources": JSON.stringify(
        retrievedData.chunks.map((c) => ({ title: c.documentTitle, id: c.documentId }))
      ),
      "X-Retrieved-Entities": JSON.stringify(retrievedData.entities.map((e) => e.name)),
    },
    originalMessages: messages,
    onFinish: async ({ messages: responseMessages }) => {
      try {
        const lastAssistant = [...responseMessages].reverse().find((m) => m.role === "assistant");
        const assistantTextPart = lastAssistant?.parts.find((p) => p.type === "text");
        const assistantText =
          assistantTextPart && "text" in assistantTextPart ? assistantTextPart.text : null;

        if (assistantText) {
          await db.insert(chatMessages).values({
            threadId: effectiveThreadId,
            role: "assistant",
            content: assistantText,
            metadata: {
              retrievedSources: retrievedData.chunks.map((c) => ({
                id: c.documentId,
                title: c.documentTitle,
                score: c.score,
              })),
              retrievedEntities: retrievedData.entities.map((e) => e.name),
            },
          });
          await db
            .update(chatThreads)
            .set({ lastMessageAt: new Date(), updatedAt: new Date() })
            .where(eq(chatThreads.id, effectiveThreadId));
        }
      } catch (error) {
        console.error("Failed to persist assistant chat message:", error);
      }
    },
  });
}
