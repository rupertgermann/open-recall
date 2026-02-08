"use server";

import { db } from "@/db";
import { projects, projectDocuments, chatThreads, documents } from "@/db/schema";
import { eq, desc, sql, count } from "drizzle-orm";
import { revalidatePath } from "next/cache";

export type ProjectWithCounts = {
  id: string;
  name: string;
  description: string | null;
  goal: string | null;
  color: string | null;
  chatCount: number;
  documentCount: number;
  createdAt: Date;
  updatedAt: Date;
};

export async function getProjects(): Promise<ProjectWithCounts[]> {
  const results = await db
    .select({
      id: projects.id,
      name: projects.name,
      description: projects.description,
      goal: projects.goal,
      color: projects.color,
      createdAt: projects.createdAt,
      updatedAt: projects.updatedAt,
      chatCount: sql<number>`(
        SELECT COUNT(*) FROM chat_threads
        WHERE chat_threads.project_id = projects.id
      )`.as("chat_count"),
      documentCount: sql<number>`(
        SELECT COUNT(*) FROM project_documents
        WHERE project_documents.project_id = projects.id
      )`.as("document_count"),
    })
    .from(projects)
    .orderBy(desc(projects.updatedAt));

  return results.map((r) => ({
    ...r,
    chatCount: Number(r.chatCount) || 0,
    documentCount: Number(r.documentCount) || 0,
  }));
}

export async function createProject(data: {
  name: string;
  description?: string;
  goal?: string;
}) {
  const [created] = await db
    .insert(projects)
    .values({
      name: data.name,
      description: data.description ?? null,
      goal: data.goal ?? null,
    })
    .returning();

  revalidatePath("/chat");
  return created;
}

export async function updateProject(
  id: string,
  data: { name?: string; description?: string; goal?: string }
) {
  const [updated] = await db
    .update(projects)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(projects.id, id))
    .returning();

  revalidatePath("/chat");
  return updated;
}

export async function deleteProject(id: string) {
  // Unlink threads (don't delete them)
  await db
    .update(chatThreads)
    .set({ projectId: null, category: "general" })
    .where(eq(chatThreads.projectId, id));

  await db.delete(projects).where(eq(projects.id, id));
  revalidatePath("/chat");
  return { success: true };
}

export async function addDocumentToProject(projectId: string, documentId: string) {
  await db
    .insert(projectDocuments)
    .values({ projectId, documentId })
    .onConflictDoNothing();

  revalidatePath("/chat");
  return { success: true };
}

export async function removeDocumentFromProject(projectId: string, documentId: string) {
  await db
    .delete(projectDocuments)
    .where(
      sql`${projectDocuments.projectId} = ${projectId} AND ${projectDocuments.documentId} = ${documentId}`
    );

  revalidatePath("/chat");
  return { success: true };
}

export async function getProjectDocuments(projectId: string) {
  const docs = await db
    .select({
      id: documents.id,
      title: documents.title,
      type: documents.type,
    })
    .from(documents)
    .innerJoin(projectDocuments, eq(projectDocuments.documentId, documents.id))
    .where(eq(projectDocuments.projectId, projectId))
    .orderBy(desc(documents.createdAt));

  return docs;
}

export async function assignThreadToProject(threadId: string, projectId: string) {
  await db
    .update(chatThreads)
    .set({ projectId, category: "project" })
    .where(eq(chatThreads.id, threadId));

  revalidatePath("/chat");
  return { success: true };
}
