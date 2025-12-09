import { z } from "zod";

// AI Provider configuration schema
export const aiConfigSchema = z.object({
  provider: z.enum(["local", "openai"]).default("local"),
  baseUrl: z.string().default("http://localhost:11434/v1"),
  model: z.string().default("llama3.2:8b"),
  embeddingModel: z.string().default("nomic-embed-text"),
  apiKey: z.string().optional(),
});

export type AIConfig = z.infer<typeof aiConfigSchema>;

// Default configuration
export const defaultAIConfig: AIConfig = {
  provider: "local",
  baseUrl: process.env.AI_BASE_URL || "http://localhost:11434/v1",
  model: process.env.AI_MODEL || "llama3.2:8b",
  embeddingModel: process.env.EMBEDDING_MODEL || "nomic-embed-text",
  apiKey: process.env.OPENAI_API_KEY,
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
