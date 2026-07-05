"use server";

import { db } from "@/db";
import { settings, documents, entities, relationships } from "@/db/schema";
import { eq, count } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getAIErrorMessage } from "@/lib/ai/errors";
import { DEFAULT_LOCAL_CHAT_MODEL, DEFAULT_LOCAL_EMBEDDING_MODEL } from "@/lib/ai/models";

// Provider-specific settings
export type ProviderSettings = {
  provider: "local" | "openai";
  baseUrl: string;
  model: string;
  apiKey?: string;
  // OpenAI-specific options
  reasoningEffort?: "low" | "medium" | "high";
  verbosity?: "low" | "medium" | "high";
  webSearchEnabled?: boolean;
};

// Combined AI settings with separate chat and embedding configs
export type AISettings = {
  openaiApiKey?: string;
  chat: ProviderSettings;
  embedding: ProviderSettings;
};

// Legacy format for backwards compatibility
export type LegacyAISettings = {
  provider: "local" | "openai";
  baseUrl: string;
  model: string;
  embeddingModel: string;
  openaiKey?: string;
};

const DEFAULT_SETTINGS: AISettings = {
  chat: {
    provider: "local",
    baseUrl: "http://localhost:11434/v1",
    model: DEFAULT_LOCAL_CHAT_MODEL,
  },
  embedding: {
    provider: "local",
    baseUrl: "http://localhost:11434/v1",
    model: DEFAULT_LOCAL_EMBEDDING_MODEL,
  },
};

// Helper to migrate legacy settings to new format
function migrateSettings(value: unknown): AISettings {
  const legacy = value as LegacyAISettings;
  
  // Check if already in new format
  if (legacy && typeof legacy === "object" && "chat" in legacy && "embedding" in legacy) {
    return legacy as unknown as AISettings;
  }
  
  // Migrate from legacy format
  if (legacy && typeof legacy === "object" && "baseUrl" in legacy) {
    return {
      openaiApiKey: legacy.openaiKey,
      chat: {
        provider: legacy.provider || "local",
        baseUrl: legacy.baseUrl,
        model: legacy.model,
        apiKey: legacy.openaiKey,
      },
      embedding: {
        provider: legacy.provider || "local",
        baseUrl: legacy.baseUrl,
        model: legacy.embeddingModel || "nomic-embed-text",
        apiKey: legacy.openaiKey,
      },
    };
  }
  
  return DEFAULT_SETTINGS;
}

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

  // Migrate legacy settings if needed
  return migrateSettings(result.value);
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

  // Clear the settings cache so new settings take effect immediately
  const { clearSettingsCache } = await import("@/lib/ai/config");
  clearSettingsCache();

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
 * Validate an OpenAI API key by checking the models endpoint.
 */
export async function validateOpenAIApiKey(
  apiKey?: string
): Promise<{ success: boolean; models?: string[]; error?: string }> {
  const trimmedKey = apiKey?.trim();

  if (!trimmedKey) {
    return { success: false, error: "Enter an OpenAI API key" };
  }

  try {
    const response = await fetch("https://api.openai.com/v1/models", {
      method: "GET",
      headers: { Authorization: `Bearer ${trimmedKey}` },
      cache: "no-store",
    });

    if (!response.ok) {
      if (response.status === 401) {
        return { success: false, error: getAIErrorMessage({ statusCode: response.status }) };
      }

      if (response.status === 403) {
        return { success: false, error: getAIErrorMessage({ statusCode: response.status }) };
      }

      return { success: false, error: `OpenAI validation failed: ${response.status}` };
    }

    const data = await response.json();

    return {
      success: true,
      models: data.data?.map((model: { id: string }) => model.id) || [],
    };
  } catch (error) {
    return {
      success: false,
      error: getAIErrorMessage(error),
    };
  }
}

/**
 * Test connection to AI provider
 */
export async function testAIConnection(
  baseUrl: string,
  apiKey?: string
): Promise<{ success: boolean; models?: string[]; error?: string }> {
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
      let host: string | undefined;
      try {
        host = new URL(openaiModelsUrl).host;
      } catch {
        host = undefined;
      }

      if ((host === "api.openai.com" || host?.endsWith(".openai.com")) && !apiKey) {
        return { success: false, error: "Missing OpenAI API key" };
      }

      const openaiResponse = await fetch(openaiModelsUrl, {
        headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
      });
      
      if (!openaiResponse.ok) {
        return {
          success: false,
          error: getAIErrorMessage({
            statusCode: openaiResponse.status,
            message: openaiResponse.statusText,
          }),
        };
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
      error: getAIErrorMessage(error),
    };
  }
}
