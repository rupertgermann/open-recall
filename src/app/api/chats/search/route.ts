import { db } from "@/db";
import { chatThreads, chatMessages } from "@/db/schema";
import { desc, eq, or, ilike, and, isNull } from "drizzle-orm";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const query = searchParams.get('q');
  const category = searchParams.get('category');
  
  if (!query || query.length < 2) {
    return Response.json({ suggestions: [] });
  }

  const whereConditions = [
    or(
      ilike(chatThreads.title, `%${query}%`),
      ilike(chatMessages.content, `%${query}%`)
    )
  ];

  // Apply category filter if specified
  if (category && category !== 'all') {
    if (category === 'general') {
      whereConditions.push(and(
        eq(chatThreads.category, 'general'),
        isNull(chatThreads.entityId),
        isNull(chatThreads.documentId)
      ));
    } else {
      whereConditions.push(eq(chatThreads.category, category));
    }
  }

  const suggestions = await db
    .select({
      id: chatThreads.id,
      title: chatThreads.title,
      category: chatThreads.category,
      entityId: chatThreads.entityId,
      documentId: chatThreads.documentId,
      createdAt: chatThreads.createdAt,
      updatedAt: chatThreads.updatedAt,
      lastMessageAt: chatThreads.lastMessageAt,
    })
    .from(chatThreads)
    .leftJoin(chatMessages, eq(chatThreads.id, chatMessages.threadId))
    .where(and(...whereConditions))
    .groupBy(chatThreads.id)
    .orderBy(desc(chatThreads.lastMessageAt))
    .limit(10);

  return Response.json({ suggestions });
}
