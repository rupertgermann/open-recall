import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { chatThreads } from "@/db/schema";
import { eq, and } from "drizzle-orm";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { searchParams } = new URL(req.url);
    const type = searchParams.get("type"); // "entity" or "document"

    if (!type || !["entity", "document"].includes(type)) {
      return NextResponse.json(
        { error: "Invalid type. Must be 'entity' or 'document'" },
        { status: 400 }
      );
    }

    // Fetch chat threads related to this entity or document
    const relatedChats = await db
      .select({
        id: chatThreads.id,
        title: chatThreads.title,
        category: chatThreads.category,
        createdAt: chatThreads.createdAt,
        updatedAt: chatThreads.updatedAt,
        lastMessageAt: chatThreads.lastMessageAt,
      })
      .from(chatThreads)
      .where(
        and(
          eq(chatThreads.category, type),
          type === "entity" 
            ? eq(chatThreads.entityId, id)
            : eq(chatThreads.documentId, id)
        )
      )
      .orderBy(chatThreads.lastMessageAt);

    return NextResponse.json({ chats: relatedChats });
  } catch (error) {
    console.error("Failed to fetch related chats:", error);
    return NextResponse.json(
      { error: "Failed to fetch related chats" },
      { status: 500 }
    );
  }
}
