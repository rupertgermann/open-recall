import { streamText, convertToModelMessages, type UIMessage, generateText, tool, stepCountIs } from "ai";
import { z } from "zod";
import { createOpenAI } from "@ai-sdk/openai";
import { retrieveContext, buildPromptContext } from "@/actions/chat";
import { getChatConfigFromDB, type ChatConfig } from "@/lib/ai/config";
import { db } from "@/db";
import { chatMessages, chatThreads, entities, documents } from "@/db/schema";
import { eq, like, or, desc } from "drizzle-orm";
import type { ChatMessageMetadata, ChatSourceReference, ChatEntityReference } from "@/lib/chat/types";

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

async function detectChatCategory(lastUserText: string | null): Promise<{
  category: string;
  entityId?: string;
  documentId?: string;
}> {
  if (!lastUserText) {
    return { category: 'general' };
  }

  try {
    // Retrieve context to determine if this is entity or document specific
    const retrievedData = await retrieveContext(lastUserText, 5);
    
    // Check if there's a dominant entity in the context
    if (retrievedData.entities.length > 0) {
      // Use the highest scoring/most relevant entity
      const topEntity = retrievedData.entities[0];
      return { 
        category: 'entity', 
        entityId: topEntity.id 
      };
    }
    
    // Check if there's a dominant document in the context
    if (retrievedData.chunks.length > 0) {
      // Group chunks by document and find the most referenced one
      const documentCounts = retrievedData.chunks.reduce((acc, chunk) => {
        acc[chunk.documentId] = (acc[chunk.documentId] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);
      
      const topDocumentId = Object.entries(documentCounts)
        .sort(([,a], [,b]) => b - a)[0][0];
      
      return { 
        category: 'document', 
        documentId: topDocumentId 
      };
    }
  } catch (error) {
    console.error("Failed to detect chat category:", error);
  }
  
  return { category: 'general' };
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
  const {
    messages,
    threadId,
  }: {
    messages: UIMessage[];
    threadId?: string;
  } = await req.json();

  const lastUserText = getLastUserText(messages);
  
  // For new threads, detect category automatically
  let category, entityId, documentId;
  if (!threadId) {
    const detectedCategory = await detectChatCategory(lastUserText);
    category = detectedCategory.category;
    entityId = detectedCategory.entityId;
    documentId = detectedCategory.documentId;
  }

  const effectiveThreadId = await ensureThread(threadId, category, entityId, documentId);

  // Load chat configuration from database
  const chatConfig = await getChatConfigFromDB();

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

  // Deduplicate sources by documentId, keeping highest score
  const sourceMap = new Map<string, ChatSourceReference>();
  for (const c of retrievedData.chunks) {
    const existing = sourceMap.get(c.documentId);
    if (!existing || c.score > existing.score) {
      sourceMap.set(c.documentId, {
        documentId: c.documentId,
        title: c.documentTitle,
        score: c.score,
      });
    }
  }
  const dedupedSources = Array.from(sourceMap.values());

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
            .where(or(like(documents.title, `%${query}%`), like(documents.summary, `%${query}%`)))
            .orderBy(desc(documents.createdAt))
            .limit(5);

          if (results.length === 0) return "No documents found matching the query.";
          return results.map((d) => `[${d.title}] (${d.type}): ${d.summary?.slice(0, 200) || "No summary"}`).join("\n\n");
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
            .where(like(entities.name, `%${name}%`))
            .limit(5);

          if (results.length === 0) return `No entity found matching "${name}".`;
          return results
            .map((e) => `**${e.name}** (${e.type}): ${e.description || "No description"}`)
            .join("\n\n");
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
            .where(or(like(documents.title, `%${topic}%`), like(documents.summary, `%${topic}%`)))
            .orderBy(desc(documents.createdAt))
            .limit(8);

          if (results.length === 0) return `No documents found related to "${topic}".`;
          return results
            .map((d) => `- **${d.title}** (${d.type}, ${d.createdAt.toLocaleDateString()}): ${d.summary?.slice(0, 150) || "No summary"}...`)
            .join("\n");
        } catch {
          return "Failed to find related documents.";
        }
      },
    }),
  };

  const result = streamText({
    model: model as Parameters<typeof streamText>[0]["model"],
    system: systemPrompt,
    messages: convertToModelMessages(messages),
    tools: chatTools,
    stopWhen: stepCountIs(3),
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
    messageMetadata: ({ part }): ChatMessageMetadata | undefined => {
      if (part.type === "finish") {
        return {
          sources: dedupedSources,
          entities: dedupedEntities,
          createdAt: Date.now(),
        };
      }
    },
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
