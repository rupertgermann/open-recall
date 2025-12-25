import { streamText, convertToModelMessages, type UIMessage, generateText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { retrieveContext, buildPromptContext } from "@/actions/chat";
import { getChatConfigFromDB, type ChatConfig } from "@/lib/ai/config";
import { db } from "@/db";
import { chatMessages, chatThreads, entities, documents } from "@/db/schema";
import { eq } from "drizzle-orm";

// Helper to create AI client from config
function createAIClient(config: ChatConfig) {
  return createOpenAI({
    baseURL: config.baseUrl,
    apiKey: config.apiKey || "ollama",
  });
}

function fallbackTitleFromUserText(text: string): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return "New chat";
  return cleaned.length > 60 ? `${cleaned.slice(0, 57)}...` : cleaned;
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

  // Check if this is a context-specific chat
  let threadContext = null;
  if (effectiveThreadId) {
    const [thread] = await db
      .select({
        category: chatThreads.category,
        entityId: chatThreads.entityId,
        documentId: chatThreads.documentId,
      })
      .from(chatThreads)
      .where(eq(chatThreads.id, effectiveThreadId))
      .limit(1);
    
    threadContext = thread;
  }
  
  if (lastUserText) {
    try {
      // For entity-specific chats, prioritize that entity in retrieval
      if (threadContext?.category === "entity" && threadContext.entityId) {
        // Get entity details for context
        const entityResult = await db
          .select({
            name: entities.name,
            type: entities.type,
            description: entities.description,
          })
          .from(entities)
          .where(eq(entities.id, threadContext.entityId))
          .limit(1);

        if (entityResult.length > 0) {
          const entity = entityResult[0];
          // Add entity context to the query for better retrieval (truncate description)
          const truncatedDescription = entity.description ? entity.description.slice(0, 200) : "";
          const enhancedQuery = `${lastUserText} ${entity.name} ${truncatedDescription}`;
          retrievedData = await retrieveContext(enhancedQuery, 3); // Reduced from 5 to 3
          
          // Ensure the specific entity is included in results
          if (!retrievedData.entities.some(e => e.id === threadContext.entityId)) {
            retrievedData.entities.push({
              id: threadContext.entityId,
              name: entity.name,
              type: entity.type,
              description: entity.description,
            });
          }
        } else {
          retrievedData = await retrieveContext(lastUserText, 3); // Reduced from 5 to 3
        }
      } else if (threadContext?.category === "document" && threadContext.documentId) {
        // For document-specific chats, prioritize that document
        const docResult = await db
          .select({
            title: documents.title,
            summary: documents.summary,
          })
          .from(documents)
          .where(eq(documents.id, threadContext.documentId))
          .limit(1);

        if (docResult.length > 0) {
          const doc = docResult[0];
          // Add document context to the query (only title and summary, not full content)
          const truncatedSummary = doc.summary ? doc.summary.slice(0, 200) : "";
          const enhancedQuery = `${lastUserText} ${doc.title} ${truncatedSummary}`;
          retrievedData = await retrieveContext(enhancedQuery, 3); // Reduced from 5 to 3
          
          // Prioritize chunks from this document
          retrievedData.chunks.sort((a, b) => {
            if (a.documentId === threadContext.documentId && b.documentId !== threadContext.documentId) return -1;
            if (a.documentId !== threadContext.documentId && b.documentId === threadContext.documentId) return 1;
            return b.score - a.score;
          });
        } else {
          retrievedData = await retrieveContext(lastUserText, 3); // Reduced from 5 to 3
        }
      } else {
        // General chat - use standard retrieval
        retrievedData = await retrieveContext(lastUserText, 3); // Reduced from 5 to 3
      }
      
      contextString = await buildPromptContext(retrievedData);
    } catch (error) {
      console.error("Context retrieval failed:", error);
    }
  }

  const systemPrompt = `You are a helpful AI assistant with access to the user's personal knowledge base.
Answer questions based on the retrieved context.

${contextString ? `Context:\n${contextString}` : "No relevant context found."}

Guidelines:
- Use context to answer accurately
- If context insufficient, say so and provide general knowledge
- Cite sources when possible
- Be concise
- Acknowledge uncertainty when unsure`;

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

        // Auto-name chat if it still has the default title.
        const [thread] = await db
          .select({ id: chatThreads.id, title: chatThreads.title })
          .from(chatThreads)
          .where(eq(chatThreads.id, effectiveThreadId))
          .limit(1);

        if (thread && (thread.title === "New chat" || thread.title.trim() === "")) {
          let title = lastUserText ? fallbackTitleFromUserText(lastUserText) : "New chat";

          // Best-effort LLM title generation (keep it short).
          try {
            if (lastUserText) {
              const { text: titleText } = await generateText({
                model: model as Parameters<typeof generateText>[0]["model"],
                system:
                  "Generate a short chat title (3-6 words). Return only the title, no quotes.",
                prompt: `User message: ${lastUserText}`,
                maxOutputTokens: 32,
              });
              const candidate = titleText.replace(/^"|"$/g, "").trim();
              if (candidate.length > 0) {
                title = candidate.length > 80 ? `${candidate.slice(0, 77)}...` : candidate;
              }
            }
          } catch {
            // ignore, fallback title already set
          }

          await db
            .update(chatThreads)
            .set({ title, updatedAt: new Date() })
            .where(eq(chatThreads.id, effectiveThreadId));
        }
      } catch (error) {
        console.error("Failed to persist assistant chat message:", error);
      }
    },
  });
}
