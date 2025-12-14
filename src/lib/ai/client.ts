import { createOpenAI } from "@ai-sdk/openai";
import { generateText, generateObject, streamText, embed, embedMany } from "ai";
import { z } from "zod";
import {
  defaultChatConfig,
  defaultEmbeddingConfig,
  getChatConfigFromDB,
  getEmbeddingConfigFromDB,
  type ChatConfig,
  type EmbeddingConfig,
  ENTITY_TYPES,
} from "./config";

// ============================================================================
// CLIENT CREATION
// ============================================================================

// Create AI client for chat
export function createChatClient(config: ChatConfig = defaultChatConfig) {
  return createOpenAI({
    baseURL: config.baseUrl,
    apiKey: config.apiKey || "ollama", // Ollama doesn't require a real key
  });
}

// Create AI client for embeddings
export function createEmbeddingClient(config: EmbeddingConfig = defaultEmbeddingConfig) {
  return createOpenAI({
    baseURL: config.baseUrl,
    apiKey: config.apiKey || "ollama",
  });
}

// Get the chat model instance
export function getModel(config: ChatConfig = defaultChatConfig) {
  const client = createChatClient(config);
  // Use the standard model interface which works for both text generation
  // and structured output (generateObject). Do NOT use responses() as it
  // is incompatible with generateObject for structured entity extraction.
  return client(config.model);
}

// Get the embedding model instance
export function getEmbeddingModel(config: EmbeddingConfig = defaultEmbeddingConfig) {
  const client = createEmbeddingClient(config);
  return client.embedding(config.model);
}

// ============================================================================
// TEXT GENERATION
// ============================================================================

export async function generateSummary(
  content: string,
  config: ChatConfig = defaultChatConfig
): Promise<string> {
  const model = getModel(config);

  const { text } = await generateText({
    model,
    system: `You are a helpful assistant that creates concise, informative summaries. 
Focus on the key points, main arguments, and important details.
Keep the summary clear and well-structured.`,
    prompt: `Please summarize the following content:\n\n${content}`,
    maxTokens: 1000,
  });

  return text;
}

export async function* streamSummary(
  content: string,
  config: ChatConfig = defaultChatConfig
) {
  const model = getModel(config);

  const result = streamText({
    model,
    system: `You are a helpful assistant that creates concise, informative summaries.`,
    prompt: `Please summarize the following content:\n\n${content}`,
    maxTokens: 1000,
  });

  for await (const chunk of (await result).textStream) {
    yield chunk;
  }
}

// ============================================================================
// ENTITY EXTRACTION
// ============================================================================

const entitySchema = z.object({
  name: z.string().describe("The name of the entity"),
  type: z.enum(ENTITY_TYPES).describe("The type/category of the entity"),
  description: z
    .string()
    .nullable()
    .describe("A brief description of the entity"),
});

const relationshipSchema = z.object({
  source: z.string().describe("The source entity name"),
  target: z.string().describe("The target entity name"),
  type: z.string().describe("The type of relationship"),
  description: z
    .string()
    .nullable()
    .describe("A brief description of the relationship"),
});

const extractionResultSchema = z.object({
  entities: z.array(entitySchema),
  relationships: z.array(relationshipSchema),
});

export type ExtractedEntity = z.infer<typeof entitySchema>;
export type ExtractedRelationship = z.infer<typeof relationshipSchema>;
export type ExtractionResult = z.infer<typeof extractionResultSchema>;

export async function extractEntitiesAndRelationships(
  content: string,
  config: ChatConfig = defaultChatConfig
): Promise<ExtractionResult> {
  const model = getModel(config);

  try {
    const { object } = await generateObject({
      model,
      schema: extractionResultSchema,
      system: `You are an expert at extracting structured knowledge from text.
Your task is to identify:
1. Key entities (people, concepts, technologies, organizations, etc.)
2. Relationships between these entities

Be thorough but precise. Only extract entities and relationships that are clearly present in the text.
For relationships, use descriptive types like "created_by", "part_of", "related_to", "used_by", etc.`,
      prompt: `Extract all entities and their relationships from the following text:\n\n${content}`,
    });

    return object;
  } catch (error) {
    console.error("Entity extraction failed:", error);
    // Return empty result on failure (graceful degradation)
    return { entities: [], relationships: [] };
  }
}

// ============================================================================
// FLASHCARD GENERATION
// ============================================================================

const flashcardSchema = z.object({
  question: z.string().describe("A clear, specific question"),
  answer: z.string().describe("A concise, accurate answer"),
});

const flashcardsResultSchema = z.object({
  flashcards: z.array(flashcardSchema),
});

export type Flashcard = z.infer<typeof flashcardSchema>;

export async function generateFlashcards(
  content: string,
  count: number = 5,
  config: ChatConfig = defaultChatConfig
): Promise<Flashcard[]> {
  const model = getModel(config);

  try {
    const { object } = await generateObject({
      model,
      schema: flashcardsResultSchema,
      system: `You are an expert at creating educational flashcards for spaced repetition learning.
Create questions that test understanding, not just memorization.
Questions should be clear and specific.
Answers should be concise but complete.`,
      prompt: `Create ${count} flashcards based on the following content:\n\n${content}`,
    });

    return object.flashcards;
  } catch (error) {
    console.error("Flashcard generation failed:", error);
    return [];
  }
}

// ============================================================================
// EMBEDDINGS
// ============================================================================

export async function generateEmbedding(
  text: string,
  config: EmbeddingConfig = defaultEmbeddingConfig
): Promise<number[]> {
  const model = getEmbeddingModel(config);

  const { embedding } = await embed({
    model,
    value: text,
  });

  return embedding;
}

export async function generateEmbeddings(
  texts: string[],
  config: EmbeddingConfig = defaultEmbeddingConfig
): Promise<number[][]> {
  if (texts.length === 0) return [];
  
  const model = getEmbeddingModel(config);

  // Use embedMany for batch processing - much faster than sequential calls
  const { embeddings } = await embedMany({
    model,
    values: texts,
  });

  return embeddings;
}

// ============================================================================
// CHAT
// ============================================================================

export async function* streamChat(
  messages: { role: "user" | "assistant" | "system"; content: string }[],
  context: string,
  config: ChatConfig = defaultChatConfig
) {
  const model = getModel(config);

  const systemMessage = `You are a helpful AI assistant with access to the user's personal knowledge base.
Use the following context from the knowledge base to answer questions accurately.
If the context doesn't contain relevant information, say so and provide general knowledge if appropriate.

Context from knowledge base:
${context}`;

  const result = streamText({
    model,
    system: systemMessage,
    messages,
    maxTokens: 2000,
  });

  for await (const chunk of (await result).textStream) {
    yield chunk;
  }
}

// ============================================================================
// DATABASE-BACKED WRAPPERS
// These functions automatically load settings from the database
// ============================================================================

/**
 * Generate summary using database-stored AI settings
 */
export async function generateSummaryWithDBConfig(content: string): Promise<string> {
  const config = await getChatConfigFromDB();
  return generateSummary(content, config);
}

/**
 * Extract entities and relationships using database-stored AI settings
 */
export async function extractEntitiesWithDBConfig(content: string): Promise<ExtractionResult> {
  const config = await getChatConfigFromDB();
  return extractEntitiesAndRelationships(content, config);
}

/**
 * Generate flashcards using database-stored AI settings
 */
export async function generateFlashcardsWithDBConfig(content: string, count: number = 5): Promise<Flashcard[]> {
  const config = await getChatConfigFromDB();
  return generateFlashcards(content, count, config);
}

/**
 * Generate single embedding using database-stored AI settings
 */
export async function generateEmbeddingWithDBConfig(text: string): Promise<number[]> {
  const config = await getEmbeddingConfigFromDB();
  return generateEmbedding(text, config);
}

/**
 * Generate multiple embeddings using database-stored AI settings
 */
export async function generateEmbeddingsWithDBConfig(texts: string[]): Promise<number[][]> {
  const config = await getEmbeddingConfigFromDB();
  return generateEmbeddings(texts, config);
}
