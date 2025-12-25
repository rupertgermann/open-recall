import { db } from "@/db";
import { chatThreads } from "@/db/schema";
import { desc, eq, and, isNull } from "drizzle-orm";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const category = searchParams.get('category');
  
  const threads = await db
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
    .where(category ? (
      category === 'general' ? 
        and(
          eq(chatThreads.category, 'general'),
          isNull(chatThreads.entityId),
          isNull(chatThreads.documentId)
        ) :
        eq(chatThreads.category, category)
    ) : undefined)
    .orderBy(desc(chatThreads.lastMessageAt));

  return Response.json({ threads });
}
