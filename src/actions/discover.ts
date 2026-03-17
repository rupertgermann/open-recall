"use server";

import { generateText } from "ai";

import { getModel } from "@/lib/ai/client";
import { getChatConfigFromDB } from "@/lib/ai/config";
import {
  buildDiscoverInsightPrompt,
  DISCOVER_INSIGHT_SYSTEM_PROMPT,
  getDiscoverInsightContext,
  getDiscoverInsightKey,
  getSavedInsightsMapFromDB,
} from "@/lib/discover/insights";
import {
  getBridgeEntities as getBridgeEntitiesFromService,
  getDiscoverData,
  getDiscoverStats as getDiscoverStatsFromService,
  getHiddenConnections as getHiddenConnectionsFromService,
  getKnowledgeClusters as getKnowledgeClustersFromService,
  saveDiscoverInsight,
} from "@/lib/discover/service";
import type {
  BridgeEntity,
  DiscoverData,
  DiscoverStats,
  HiddenConnection,
  KnowledgeCluster,
} from "@/lib/discover/types";

export type {
  BridgeEntity,
  DiscoverData as DiscoverSnapshot,
  DiscoverStats,
  HiddenConnection,
  KnowledgeCluster,
} from "@/lib/discover/types";

export async function getHiddenConnections(): Promise<HiddenConnection[]> {
  return getHiddenConnectionsFromService();
}

export async function getBridgeEntities(): Promise<BridgeEntity[]> {
  return getBridgeEntitiesFromService();
}

export async function getKnowledgeClusters(): Promise<KnowledgeCluster[]> {
  return getKnowledgeClustersFromService();
}

export async function generateInsight(entityIds: string[]): Promise<string> {
  const context = await getDiscoverInsightContext(entityIds);
  if (!context.entities.length) {
    return "No matching entities found for this insight.";
  }

  const config = await getChatConfigFromDB();
  const model = getModel(config);

  const { text } = await generateText({
    model,
    system: DISCOVER_INSIGHT_SYSTEM_PROMPT,
    prompt: buildDiscoverInsightPrompt(context),
    maxOutputTokens: 300,
  });

  return text;
}

export async function getDiscoverStats(): Promise<DiscoverStats> {
  return getDiscoverStatsFromService();
}

export async function saveInsight(entityIds: string[], insight: string): Promise<string> {
  return saveDiscoverInsight(entityIds, insight);
}

export async function getSavedInsight(entityIds: string[]): Promise<string | null> {
  const insights = await getSavedInsightsMap();
  return insights.get(getDiscoverInsightKey(entityIds)) ?? null;
}

export async function getSavedInsightsMap(): Promise<Map<string, string>> {
  return getSavedInsightsMapFromDB();
}

export async function getDiscoverSnapshot(): Promise<DiscoverData> {
  return getDiscoverData();
}
