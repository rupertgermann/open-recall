"use server";

import { z } from "zod";
import { createOpenAI } from "@ai-sdk/openai";
import { generateText } from "ai";
import { getChatConfigFromDB } from "@/lib/ai/config";

const webSearchResultsSchema = z.object({
  results: z.array(
    z.object({
      title: z.string(),
      url: z.string().url(),
      snippet: z.string(),
    })
  ),
});

export type WebSearchResult = z.infer<typeof webSearchResultsSchema>["results"][number];

export async function aiWebSearchForEntity(input: {
  entityName: string;
  entityType?: string | null;
  additionalPrompt?: string | null;
  maxResults?: number;
}): Promise<WebSearchResult[]> {
  console.log("[WebSearch] Starting AI web search for entity:", input.entityName);
  
  const cfg = await getChatConfigFromDB();
  console.log("[WebSearch] Config loaded - provider:", cfg.provider, "model:", cfg.model);

  if (cfg.provider !== "openai") {
    console.error("[WebSearch] Provider is not OpenAI:", cfg.provider);
    throw new Error("AI web search requires provider 'openai'.");
  }

  const provider = createOpenAI({
    baseURL: cfg.baseUrl,
    apiKey: cfg.apiKey || undefined,
  });
  console.log("[WebSearch] OpenAI provider created");

  const model = provider(cfg.model);
  console.log("[WebSearch] Model instance created");

  const maxResults = Math.max(1, Math.min(10, input.maxResults ?? 6));
  const entityType = (input.entityType || "").trim();
  const additional = (input.additionalPrompt || "").trim();

  console.log("[WebSearch] Attempting generateText with web_search_options...");
  
  try {
    const { text } = await generateText({
      model,
      system:
        "You are a research assistant. Use web search to find authoritative, relevant sources. Return concise snippets. Prefer primary sources and official documentation when possible.",
      prompt: `Find up to ${maxResults} good web sources about the following entity and return a short preview for each.

Entity: ${input.entityName}${entityType ? `\nType: ${entityType}` : ""}${additional ? `\nAdditional prompt: ${additional}` : ""}

Return STRICT JSON (no markdown, no commentary) with this shape:
{
  "results": [{ "title": string, "url": string, "snippet": string }]
}

Requirements:
- results must be relevant to the entity
- URLs must be unique
- snippets must be 1-2 sentences describing why the page is relevant
`,
      experimental_telemetry: {
        isEnabled: true,
      },
      // Use OpenAI's native web search parameter
      ...({
        web_search_options: {
          enabled: true,
        },
      } as any),
      maxTokens: 800,
    });
    
    console.log("[WebSearch] generateText completed, response length:", text.length);
    console.log("[WebSearch] Raw response text:", text.substring(0, 200) + "...");

    let parsed: z.infer<typeof webSearchResultsSchema> | null = null;
    try {
      parsed = webSearchResultsSchema.parse(JSON.parse(text));
      console.log("[WebSearch] Successfully parsed", parsed.results.length, "results");
    } catch (parseError) {
      console.error("[WebSearch] Failed to parse response:", parseError);
      console.error("[WebSearch] Raw text that failed to parse:", text);
      parsed = null;
    }

    const deduped: WebSearchResult[] = [];
    const seen = new Set<string>();

    for (const r of parsed?.results || []) {
      const u = r.url.trim();
      if (!u || seen.has(u)) continue;
      seen.add(u);
      deduped.push({
        title: r.title.trim() || u,
        url: u,
        snippet: r.snippet.trim(),
      });
      if (deduped.length >= maxResults) break;
    }

    console.log("[WebSearch] Returning", deduped.length, "deduplicated results");
    return deduped;
    
  } catch (error) {
    console.error("[WebSearch] Error during generateText:", error);
    console.error("[WebSearch] Error details:", {
      name: error instanceof Error ? error.name : "Unknown",
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });
    throw error;
  }
}
