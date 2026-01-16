import { db } from "@/db";
import { chatThreads } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function POST(req: Request) {
  const { category, entityId, documentId } = await req.json();

  const [created] = await db
    .insert(chatThreads)
    .values({
      category: category || 'general',
      entityId: entityId || null,
      documentId: documentId || null,
    })
    .returning({ 
      id: chatThreads.id,
      title: chatThreads.title,
      category: chatThreads.category,
      entityId: chatThreads.entityId,
      documentId: chatThreads.documentId,
      createdAt: chatThreads.createdAt,
      updatedAt: chatThreads.updatedAt,
      lastMessageAt: chatThreads.lastMessageAt,
    });

  return Response.json({ thread: created });
}
