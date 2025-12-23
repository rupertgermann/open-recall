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
  const cfg = await getChatConfigFromDB();

  if (cfg.provider !== "openai") {
    throw new Error("AI web search requires provider 'openai'.");
  }

  const provider = createOpenAI({
    baseURL: cfg.baseUrl,
    apiKey: cfg.apiKey || undefined,
  }) as any;

  const model = typeof provider.responses === "function" ? provider.responses(cfg.model) : provider(cfg.model);

  const maxResults = Math.max(1, Math.min(10, input.maxResults ?? 6));
  const entityType = (input.entityType || "").trim();
  const additional = (input.additionalPrompt || "").trim();

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
    tools: {
      web_search_preview: provider.tools.webSearchPreview({
        searchContextSize: "high",
      }),
    },
    toolChoice: { type: "tool", toolName: "web_search_preview" },
    maxOutputTokens: 800,
  });

  let parsed: z.infer<typeof webSearchResultsSchema> | null = null;
  try {
    parsed = webSearchResultsSchema.parse(JSON.parse(text));
  } catch {
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

  return deduped;
}
