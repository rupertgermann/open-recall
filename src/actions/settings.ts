"use server";

import { db } from "@/db";
import { settings, documents, entities, relationships } from "@/db/schema";
import { eq, count } from "drizzle-orm";
import { revalidatePath } from "next/cache";

export type AISettings = {
  provider: "local" | "openai";
  baseUrl: string;
  model: string;
  embeddingModel: string;
  openaiKey?: string;
};

const DEFAULT_SETTINGS: AISettings = {
  provider: "local",
  baseUrl: "http://localhost:11434/v1",
  model: "llama3.2:8b",
  embeddingModel: "nomic-embed-text",
};

/**
 * Get AI settings
 */
export async function getAISettings(): Promise<AISettings> {
  const [result] = await db
    .select()
    .from(settings)
    .where(eq(settings.key, "ai_config"))
    .limit(1);

  if (!result) {
    return DEFAULT_SETTINGS;
  }

  return result.value as AISettings;
}

/**
 * Save AI settings
 */
export async function saveAISettings(config: AISettings): Promise<void> {
  const existing = await db
    .select()
    .from(settings)
    .where(eq(settings.key, "ai_config"))
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(settings)
      .set({ value: config, updatedAt: new Date() })
      .where(eq(settings.key, "ai_config"));
  } else {
    await db.insert(settings).values({
      key: "ai_config",
      value: config,
    });
  }

  revalidatePath("/settings");
}

/**
 * Get database statistics
 */
export async function getDatabaseStats() {
  const [docCount] = await db.select({ count: count() }).from(documents);
  const [entityCount] = await db.select({ count: count() }).from(entities);
  const [relationshipCount] = await db.select({ count: count() }).from(relationships);

  return {
    documents: Number(docCount?.count) || 0,
    entities: Number(entityCount?.count) || 0,
    relationships: Number(relationshipCount?.count) || 0,
  };
}

/**
 * Test connection to AI provider
 */
export async function testAIConnection(baseUrl: string): Promise<{ success: boolean; models?: string[]; error?: string }> {
  try {
    // Try to fetch models from Ollama
    const modelsUrl = baseUrl.replace("/v1", "/api/tags");
    const response = await fetch(modelsUrl, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });

    if (!response.ok) {
      // Try OpenAI-compatible endpoint
      const openaiModelsUrl = `${baseUrl}/models`;
      const openaiResponse = await fetch(openaiModelsUrl);
      
      if (!openaiResponse.ok) {
        return { success: false, error: `Connection failed: ${response.status}` };
      }

      const data = await openaiResponse.json();
      return {
        success: true,
        models: data.data?.map((m: { id: string }) => m.id) || [],
      };
    }

    const data = await response.json();
    return {
      success: true,
      models: data.models?.map((m: { name: string }) => m.name) || [],
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Connection failed",
    };
  }
}
