import { z } from "zod";

// ============================================================================
// PROVIDER CONFIGURATION SCHEMAS
// ============================================================================

// Base provider config (shared fields)
const providerConfigSchema = z.object({
  provider: z.enum(["local", "openai"]).default("local"),
  baseUrl: z.string(),
  apiKey: z.string().optional(),
});

// Chat-specific configuration
export const chatConfigSchema = providerConfigSchema.extend({
  model: z.string(),
});

// Embedding-specific configuration
export const embeddingConfigSchema = providerConfigSchema.extend({
  model: z.string(),
});

// Combined config (for backwards compatibility)
export const aiConfigSchema = z.object({
  chat: chatConfigSchema,
  embedding: embeddingConfigSchema,
});

export type ChatConfig = z.infer<typeof chatConfigSchema>;
export type EmbeddingConfig = z.infer<typeof embeddingConfigSchema>;
export type AIConfig = z.infer<typeof aiConfigSchema>;

// ============================================================================
// DEFAULT CONFIGURATIONS
// ============================================================================

// Chat provider defaults (e.g., Ollama with llama3.2)
export const defaultChatConfig: ChatConfig = {
  provider: (process.env.CHAT_PROVIDER as "local" | "openai") || "local",
  baseUrl: process.env.CHAT_BASE_URL || process.env.AI_BASE_URL || "http://localhost:11434/v1",
  model: process.env.CHAT_MODEL || process.env.AI_MODEL || "llama3.2:8b",
  apiKey: process.env.CHAT_API_KEY || process.env.OPENAI_API_KEY,
};

// Embedding provider defaults (e.g., Ollama with nomic-embed-text)
export const defaultEmbeddingConfig: EmbeddingConfig = {
  provider: (process.env.EMBEDDING_PROVIDER as "local" | "openai") || "local",
  baseUrl: process.env.EMBEDDING_BASE_URL || process.env.AI_BASE_URL || "http://localhost:11434/v1",
  model: process.env.EMBEDDING_MODEL || "nomic-embed-text",
  apiKey: process.env.EMBEDDING_API_KEY || process.env.OPENAI_API_KEY,
};

// Combined default config
export const defaultAIConfig: AIConfig = {
  chat: defaultChatConfig,
  embedding: defaultEmbeddingConfig,
};

// Entity types for extraction
export const ENTITY_TYPES = [
  "person",
  "concept",
  "technology",
  "organization",
  "location",
  "event",
  "product",
  "other",
] as const;

export type EntityType = (typeof ENTITY_TYPES)[number];

// Relationship types
export const RELATIONSHIP_TYPES = [
  "related_to",
  "part_of",
  "built_with",
  "created_by",
  "used_by",
  "depends_on",
  "similar_to",
  "opposite_of",
  "parent_of",
  "child_of",
] as const;

export type RelationshipType = (typeof RELATIONSHIP_TYPES)[number];
