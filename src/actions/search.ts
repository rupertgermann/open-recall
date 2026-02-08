"use server";

import { db } from "@/db";
import { documents, entities, chatThreads } from "@/db/schema";
import { like, or, desc, sql } from "drizzle-orm";

export type SearchResult = {
  id: string;
  title: string;
  type: "document" | "entity" | "chat";
  subtype?: string;
  description?: string;
  href: string;
};

export async function globalSearch(query: string): Promise<SearchResult[]> {
  if (!query.trim()) return [];

  const q = `%${query.trim()}%`;
  const results: SearchResult[] = [];

  const [docs, ents, chats] = await Promise.all([
    db
      .select({
        id: documents.id,
        title: documents.title,
        type: documents.type,
        summary: documents.summary,
      })
      .from(documents)
      .where(or(like(documents.title, q), like(documents.summary, q)))
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
      .where(or(like(entities.name, q), like(entities.description, q)))
      .limit(5),
    db
      .select({
        id: chatThreads.id,
        title: chatThreads.title,
        category: chatThreads.category,
      })
      .from(chatThreads)
      .where(like(chatThreads.title, q))
      .orderBy(desc(chatThreads.lastMessageAt))
      .limit(5),
  ]);

  for (const doc of docs) {
    results.push({
      id: doc.id,
      title: doc.title,
      type: "document",
      subtype: doc.type,
      description: doc.summary?.slice(0, 100) || undefined,
      href: `/library/${doc.id}`,
    });
  }

  for (const ent of ents) {
    results.push({
      id: ent.id,
      title: ent.name,
      type: "entity",
      subtype: ent.type,
      description: ent.description?.slice(0, 100) || undefined,
      href: `/graph?entity=${ent.id}`,
    });
  }

  for (const chat of chats) {
    results.push({
      id: chat.id,
      title: chat.title,
      type: "chat",
      subtype: chat.category,
      href: `/chat/${chat.id}`,
    });
  }

  return results;
}
