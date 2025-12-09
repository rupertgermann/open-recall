import { streamText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { retrieveContext, buildPromptContext } from "@/actions/chat";

// Create AI client for local Ollama
const ollama = createOpenAI({
  baseURL: process.env.AI_BASE_URL || "http://localhost:11434/v1",
  apiKey: "ollama", // Ollama doesn't need a real key
});

export async function POST(req: Request) {
  const { messages } = await req.json();

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
      contextString = buildPromptContext(retrievedData);
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

  const result = streamText({
    model: ollama(process.env.AI_MODEL || "llama3.2:8b"),
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
