import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { chatThreads, chatMessages, entities, documents } from "@/db/schema";
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

    // Add contextual welcome message for entity/document chats
    if (category !== "general") {
      let welcomeMessage = "";
      
      if (category === "entity" && entityId) {
        const [entity] = await db
          .select({
            name: entities.name,
            type: entities.type,
            description: entities.description,
          })
          .from(entities)
          .where(eq(entities.id, entityId))
          .limit(1);
          
        if (entity) {
          welcomeMessage = `I'm ready to help you learn more about **${entity.name}** (${entity.type}). ${
            entity.description ? `Here's what I know: ${entity.description}` : ""
          }\n\nWhat would you like to know about ${entity.name}?`;
        }
      } else if (category === "document" && documentId) {
        const [doc] = await db
          .select({
            title: documents.title,
            summary: documents.summary,
          })
          .from(documents)
          .where(eq(documents.id, documentId))
          .limit(1);
          
        if (doc) {
          welcomeMessage = `I'm ready to discuss **${doc.title}** with you. ${
            doc.summary ? `Here's a summary: ${doc.summary}` : ""
          }\n\nWhat questions do you have about this document?`;
        }
      }

      if (welcomeMessage) {
        await db
          .insert(chatMessages)
          .values({
            threadId: thread.id,
            role: "assistant",
            content: welcomeMessage,
          });
      }
    }

    return NextResponse.json({ thread }, { status: 201 });
  } catch (error) {
    console.error("Failed to create chat with context:", error);
    return NextResponse.json(
      { error: "Failed to create chat" },
      { status: 500 }
    );
  }
}
