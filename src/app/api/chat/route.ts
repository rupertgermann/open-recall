import { streamText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { retrieveContext, buildPromptContext } from "@/actions/chat";
import { getChatConfigFromDB, type ChatConfig } from "@/lib/ai/config";

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

export async function POST(req: Request) {
  const { messages } = await req.json();

  // Load chat configuration from database
  const chatConfig = await getChatConfigFromDB();

  // Get the latest user message for retrieval
  const lastUserMessage = messages.filter((m: { role: string }) => m.role === "user").pop();
  
  // Retrieve relevant context using hybrid search
  let contextString = "";
  let retrievedData: Awaited<ReturnType<typeof retrieveContext>> = { 
    chunks: [], 
    entities: [], 
    graphContext: "" 
  };
  
  if (lastUserMessage) {
    try {
      retrievedData = await retrieveContext(lastUserMessage.content, 5);
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
    messages,
  });

  // Return streaming response with metadata
  const response = result.toDataStreamResponse();
  
  // Add retrieved context to response headers for the client
  response.headers.set(
    "X-Retrieved-Sources",
    JSON.stringify(retrievedData.chunks.map((c) => ({ title: c.documentTitle, id: c.documentId })))
  );
  response.headers.set(
    "X-Retrieved-Entities",
    JSON.stringify(retrievedData.entities.map((e) => e.name))
  );

  return response;
}
