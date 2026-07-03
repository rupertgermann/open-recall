import { streamText, convertToModelMessages, type UIMessage, generateText, tool, stepCountIs } from "ai";
import { z } from "zod";
import { createOpenAI } from "@ai-sdk/openai";
import { retrieveContext, buildPromptContext } from "@/actions/chat";
import { getChatConfigFromDB, type ChatConfig } from "@/lib/ai/config";
import { createAIErrorResponse, getAIErrorMessage } from "@/lib/ai/errors";
import {
  dedupeChatSources,
  detectChatCategoryFromContext,
  fallbackTitleFromUserText,
} from "@/lib/chat/helpers";
import {
  formatKnowledgeBaseSearchResults,
  formatLookupEntityResults,
  formatRelatedDocumentsResults,
} from "@/lib/chat/tool-results";
import { db } from "@/db";
import { chatMessages, chatThreads, entities, documents } from "@/db/schema";
import { eq, ilike, or, desc } from "drizzle-orm";
import type { ChatMessageMetadata, ChatEntityReference } from "@/lib/chat/types";

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
  
  // Use standard client for all providers
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

async function ensureThread(threadId?: string | null, category?: string, entityId?: string, documentId?: string): Promise<string> {
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
    .values({
      category: category || 'general',
      entityId: entityId || null,
      documentId: documentId || null,
    })
    .returning({ id: chatThreads.id });
  return created.id;
}

export async function POST(req: Request) {
  try {
    return await handleChatPost(req);
  } catch (error) {
    console.error("Chat request failed:", getAIErrorMessage(error));
    return createAIErrorResponse(error);
  }
}

async function handleChatPost(req: Request) {
  const {
    messages,
    threadId,
  }: {
    messages: UIMessage[];
    threadId?: string;
  } = await req.json();

  const lastUserText = getLastUserText(messages);

  let contextString = "";
  let retrievedData: Awaited<ReturnType<typeof retrieveContext>> = {
    chunks: [],
    entities: [],
    graphContext: "",
  };
  let hasRetrievedForCurrentMessage = false;

  // For new threads, retrieve once and derive the category from that same result.
  let category: string | undefined;
  let entityId: string | undefined;
  let documentId: string | undefined;
  if (!threadId && lastUserText) {
    try {
      retrievedData = await retrieveContext(lastUserText, 3);
      hasRetrievedForCurrentMessage = true;
      const detectedCategory = detectChatCategoryFromContext(retrievedData);
      category = detectedCategory.category;
      entityId = "entityId" in detectedCategory ? detectedCategory.entityId : undefined;
      documentId = "documentId" in detectedCategory ? detectedCategory.documentId : undefined;
    } catch (error) {
      console.error("Failed to retrieve context for new chat:", error);
      category = "general";
    }
  }

  const effectiveThreadId = await ensureThread(threadId, category, entityId, documentId);

  // Load chat configuration from database
  const chatConfig = await getChatConfigFromDB();

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
      if (hasRetrievedForCurrentMessage) {
        // Reuse the retrieval result already used for new-thread category detection.
      } else if (threadContext?.category === "entity" && threadContext.entityId) {
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

  const dedupedSources = dedupeChatSources(retrievedData.chunks);

  const dedupedEntities: ChatEntityReference[] = retrievedData.entities.map((e) => ({
    id: e.id,
    name: e.name,
    type: e.type,
  }));

  const systemPrompt = `You are a helpful AI assistant with access to the user's personal knowledge base.
Answer questions based on the retrieved context.

${contextString ? `Context:\n${contextString}` : "No relevant context found."}

Guidelines:
- Use context to answer accurately
- When referencing information from the knowledge base, mention the document title naturally (e.g. "According to [Document Title]...")
- If context insufficient, say so and provide general knowledge
- Be concise
- Acknowledge uncertainty when unsure`;

  // Get model from DB-backed config
  const model = getModelFromConfig(chatConfig);

  const chatTools = {
    searchKnowledgeBase: tool({
      description: "Search the user's knowledge base for documents and information. Use this when the user asks about something that might be in their saved content.",
      inputSchema: z.object({
        query: z.string().describe("The search query to find relevant documents"),
      }),
      execute: async ({ query }) => {
        try {
          const results = await db
            .select({
              id: documents.id,
              title: documents.title,
              type: documents.type,
              summary: documents.summary,
            })
            .from(documents)
            .where(or(ilike(documents.title, `%${query}%`), ilike(documents.summary, `%${query}%`)))
            .orderBy(desc(documents.createdAt))
            .limit(5);

          return formatKnowledgeBaseSearchResults(results);
        } catch {
          return "Failed to search the knowledge base.";
        }
      },
    }),
    createNote: tool({
      description: "Create a new text note in the user's knowledge base. Use this when the user asks you to save, remember, or note something down.",
      inputSchema: z.object({
        title: z.string().describe("Title for the note"),
        content: z.string().describe("The content of the note in markdown format"),
      }),
      execute: async ({ title, content }) => {
        try {
          const [created] = await db
            .insert(documents)
            .values({
              title,
              type: "note",
              content,
              summary: content.slice(0, 500),
              processingStatus: "pending",
            })
            .returning({ id: documents.id });

          return `Note "${title}" created successfully (ID: ${created.id}). It will be processed and added to the knowledge graph shortly.`;
        } catch {
          return "Failed to create the note.";
        }
      },
    }),
    lookupEntity: tool({
      description: "Look up a specific entity (person, concept, technology, organization) in the knowledge graph to get details and connections.",
      inputSchema: z.object({
        name: z.string().describe("The name of the entity to look up"),
      }),
      execute: async ({ name }) => {
        try {
          const results = await db
            .select({
              id: entities.id,
              name: entities.name,
              type: entities.type,
              description: entities.description,
            })
            .from(entities)
            .where(ilike(entities.name, `%${name}%`))
            .limit(5);

          return formatLookupEntityResults(results, name);
        } catch {
          return "Failed to look up entity.";
        }
      },
    }),
    findRelatedDocuments: tool({
      description: "Find documents related to a specific topic or document. Use this to discover connections between pieces of knowledge.",
      inputSchema: z.object({
        topic: z.string().describe("The topic or document title to find related content for"),
      }),
      execute: async ({ topic }) => {
        try {
          const results = await db
            .select({
              id: documents.id,
              title: documents.title,
              type: documents.type,
              summary: documents.summary,
              createdAt: documents.createdAt,
            })
            .from(documents)
            .where(or(ilike(documents.title, `%${topic}%`), ilike(documents.summary, `%${topic}%`)))
            .orderBy(desc(documents.createdAt))
            .limit(8);

          return formatRelatedDocumentsResults(results, topic);
        } catch {
          return "Failed to find related documents.";
        }
      },
    }),
  };

  const result = streamText({
    model: model as Parameters<typeof streamText>[0]["model"],
    system: systemPrompt,
    messages: await convertToModelMessages(messages),
    tools: chatTools,
    stopWhen: stepCountIs(3),
  });

  // Ensure the stream runs to completion and triggers onFinish even if the client disconnects.
  // (best-effort; ignore errors)
  void result.consumeStream({
    onError: (error) => {
      console.error("Chat stream failed:", getAIErrorMessage(error));
    },
  });

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
    messageMetadata: ({ part }): ChatMessageMetadata | undefined => {
      if (part.type === "finish") {
        return {
          sources: dedupedSources,
          entities: dedupedEntities,
          createdAt: Date.now(),
        };
      }
    },
    onError: (error) => getAIErrorMessage(error),
    onFinish: async ({ messages: responseMessages }) => {
      try {
        const lastAssistant = [...responseMessages].reverse().find((m) => m.role === "assistant");
        const assistantTextPart = lastAssistant?.parts.find((p) => p.type === "text");
        const assistantText =
          assistantTextPart && "text" in assistantTextPart ? assistantTextPart.text : null;

        if (assistantText) {
          const storedMetadata: ChatMessageMetadata = {
            sources: dedupedSources,
            entities: dedupedEntities,
            createdAt: Date.now(),
          };
          await db.insert(chatMessages).values({
            threadId: effectiveThreadId,
            role: "assistant",
            content: assistantText,
            metadata: storedMetadata,
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
