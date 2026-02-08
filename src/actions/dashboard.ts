"use server";

import { db } from "@/db";
import { documents, entities, relationships, chunks, chatThreads, chatMessages, collections, documentCollections } from "@/db/schema";
import { count, desc, sql, eq } from "drizzle-orm";

export type DashboardStats = {
  documents: number;
  entities: number;
  relationships: number;
  chunks: number;
  chats: number;
  collections: number;
};

export type RecentDocument = {
  id: string;
  title: string;
  type: string;
  summary: string | null;
  createdAt: Date;
  processingStatus: string;
};

export type RecentChat = {
  id: string;
  title: string;
  category: string;
  lastMessageAt: Date;
};

export type TypeBreakdown = {
  type: string;
  count: number;
};

export type DashboardData = {
  stats: DashboardStats;
  recentDocuments: RecentDocument[];
  recentChats: RecentChat[];
  typeBreakdown: TypeBreakdown[];
  activityByDay: { date: string; count: number }[];
};

export async function getDashboardData(): Promise<DashboardData> {
  const [
    [docCount],
    [entityCount],
    [relCount],
    [chunkCount],
    [chatCount],
    [collectionCount],
    recentDocs,
    recentChatsData,
    typeBreakdownData,
    activityData,
  ] = await Promise.all([
    db.select({ count: count() }).from(documents),
    db.select({ count: count() }).from(entities),
    db.select({ count: count() }).from(relationships),
    db.select({ count: count() }).from(chunks),
    db.select({ count: count() }).from(chatThreads),
    db.select({ count: count() }).from(collections),
    db
      .select({
        id: documents.id,
        title: documents.title,
        type: documents.type,
        summary: documents.summary,
        createdAt: documents.createdAt,
        processingStatus: documents.processingStatus,
      })
      .from(documents)
      .orderBy(desc(documents.createdAt))
      .limit(6),
    db
      .select({
        id: chatThreads.id,
        title: chatThreads.title,
        category: chatThreads.category,
        lastMessageAt: chatThreads.lastMessageAt,
      })
      .from(chatThreads)
      .orderBy(desc(chatThreads.lastMessageAt))
      .limit(5),
    db
      .select({
        type: documents.type,
        count: count(),
      })
      .from(documents)
      .groupBy(documents.type),
    db
      .select({
        date: sql<string>`TO_CHAR(${documents.createdAt}, 'YYYY-MM-DD')`.as("date"),
        count: count(),
      })
      .from(documents)
      .where(sql`${documents.createdAt} > NOW() - INTERVAL '30 days'`)
      .groupBy(sql`TO_CHAR(${documents.createdAt}, 'YYYY-MM-DD')`)
      .orderBy(sql`TO_CHAR(${documents.createdAt}, 'YYYY-MM-DD')`),
  ]);

  return {
    stats: {
      documents: Number(docCount?.count) || 0,
      entities: Number(entityCount?.count) || 0,
      relationships: Number(relCount?.count) || 0,
      chunks: Number(chunkCount?.count) || 0,
      chats: Number(chatCount?.count) || 0,
      collections: Number(collectionCount?.count) || 0,
    },
    recentDocuments: recentDocs,
    recentChats: recentChatsData,
    typeBreakdown: typeBreakdownData.map((t) => ({
      type: t.type,
      count: Number(t.count),
    })),
    activityByDay: activityData.map((a) => ({
      date: a.date,
      count: Number(a.count),
    })),
  };
}
