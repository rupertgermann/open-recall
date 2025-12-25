import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { chatThreads } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function POST(req: NextRequest) {
  try {
    const { category, entityId, documentId, title } = await req.json();

    // Validate category
    if (!["general", "entity", "document"].includes(category)) {
      return NextResponse.json(
        { error: "Invalid category. Must be 'general', 'entity', or 'document'" },
        { status: 400 }
      );
    }

    // Validate that either entityId or documentId is provided for non-general chats
    if (category !== "general" && !entityId && !documentId) {
      return NextResponse.json(
        { error: "Entity ID or Document ID is required for entity/document chats" },
        { status: 400 }
      );
    }

    // Create the chat thread with context
    const [thread] = await db
      .insert(chatThreads)
      .values({
        title: title || `New ${category} chat`,
        category,
        entityId: entityId || null,
        documentId: documentId || null,
      })
      .returning();

    return NextResponse.json({ thread }, { status: 201 });
  } catch (error) {
    console.error("Failed to create chat with context:", error);
    return NextResponse.json(
      { error: "Failed to create chat" },
      { status: 500 }
    );
  }
}
