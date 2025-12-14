import { db } from "@/db";
import { chatThreads } from "@/db/schema";
import { desc } from "drizzle-orm";

export async function GET() {
  const threads = await db
    .select({
      id: chatThreads.id,
      title: chatThreads.title,
      createdAt: chatThreads.createdAt,
      updatedAt: chatThreads.updatedAt,
      lastMessageAt: chatThreads.lastMessageAt,
    })
    .from(chatThreads)
    .orderBy(desc(chatThreads.lastMessageAt));

  return Response.json({ threads });
}
