import { db } from "@/db";
import { chatMessages, chatThreads } from "@/db/schema";
import { asc, eq } from "drizzle-orm";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const [thread] = await db
    .select({
      id: chatThreads.id,
      title: chatThreads.title,
      createdAt: chatThreads.createdAt,
      updatedAt: chatThreads.updatedAt,
      lastMessageAt: chatThreads.lastMessageAt,
    })
    .from(chatThreads)
    .where(eq(chatThreads.id, id))
    .limit(1);

  if (!thread) {
    return new Response("Not found", { status: 404 });
  }

  const messages = await db
    .select({
      id: chatMessages.id,
      role: chatMessages.role,
      content: chatMessages.content,
      createdAt: chatMessages.createdAt,
      metadata: chatMessages.metadata,
    })
    .from(chatMessages)
    .where(eq(chatMessages.threadId, id))
    .orderBy(asc(chatMessages.createdAt));

  return Response.json({ thread, messages });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  await db.delete(chatThreads).where(eq(chatThreads.id, id));

  return Response.json({ success: true });
}
