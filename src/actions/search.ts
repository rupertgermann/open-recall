"use server";

import { db } from "@/db";
import { documents, entities, chatThreads } from "@/db/schema";
import { ilike, or, desc } from "drizzle-orm";
import { buildGlobalSearchResults, type SearchResult } from "@/lib/search/results";

export async function globalSearch(query: string): Promise<SearchResult[]> {
  if (!query.trim()) return [];

  const q = `%${query.trim()}%`;

  const [docs, ents, chats] = await Promise.all([
    db
      .select({
        id: documents.id,
        title: documents.title,
        type: documents.type,
        summary: documents.summary,
      })
      .from(documents)
      .where(or(ilike(documents.title, q), ilike(documents.summary, q)))
      .orderBy(desc(documents.createdAt))
      .limit(5),
    db
      .select({
        id: entities.id,
        name: entities.name,
        type: entities.type,
        description: entities.description,
      })
      .from(entities)
      .where(or(ilike(entities.name, q), ilike(entities.description, q)))
      .limit(5),
    db
      .select({
        id: chatThreads.id,
        title: chatThreads.title,
        category: chatThreads.category,
      })
      .from(chatThreads)
      .where(ilike(chatThreads.title, q))
      .orderBy(desc(chatThreads.lastMessageAt))
      .limit(5),
  ]);

  return buildGlobalSearchResults({ documents: docs, entities: ents, chats });
}
