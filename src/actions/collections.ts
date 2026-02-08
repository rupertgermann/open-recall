"use server";

import { db } from "@/db";
import { collections, documentCollections, documents } from "@/db/schema";
import { eq, desc, sql, count, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";

export type CollectionWithCount = {
  id: string;
  name: string;
  description: string | null;
  color: string | null;
  documentCount: number;
  createdAt: Date;
  updatedAt: Date;
};

export async function getCollections(): Promise<CollectionWithCount[]> {
  const results = await db
    .select({
      id: collections.id,
      name: collections.name,
      description: collections.description,
      color: collections.color,
      createdAt: collections.createdAt,
      updatedAt: collections.updatedAt,
      documentCount: sql<number>`(
        SELECT COUNT(*) FROM document_collections
        WHERE document_collections.collection_id = collections.id
      )`.as("document_count"),
    })
    .from(collections)
    .orderBy(desc(collections.updatedAt));

  return results.map((r) => ({
    ...r,
    documentCount: Number(r.documentCount) || 0,
  }));
}

export async function getCollection(id: string) {
  const [collection] = await db
    .select()
    .from(collections)
    .where(eq(collections.id, id))
    .limit(1);

  return collection ?? null;
}

export async function createCollection(data: {
  name: string;
  description?: string;
  color?: string;
}) {
  const [created] = await db
    .insert(collections)
    .values({
      name: data.name,
      description: data.description ?? null,
      color: data.color ?? "#6366f1",
    })
    .returning();

  revalidatePath("/library");
  return created;
}

export async function updateCollection(
  id: string,
  data: { name?: string; description?: string; color?: string }
) {
  const [updated] = await db
    .update(collections)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(collections.id, id))
    .returning();

  revalidatePath("/library");
  return updated;
}

export async function deleteCollection(id: string) {
  await db.delete(collections).where(eq(collections.id, id));
  revalidatePath("/library");
  return { success: true };
}

export async function getDocumentCollections(documentId: string): Promise<string[]> {
  const rows = await db
    .select({ collectionId: documentCollections.collectionId })
    .from(documentCollections)
    .where(eq(documentCollections.documentId, documentId));

  return rows.map((r) => r.collectionId);
}

export async function setDocumentCollections(
  documentId: string,
  collectionIds: string[]
) {
  await db
    .delete(documentCollections)
    .where(eq(documentCollections.documentId, documentId));

  if (collectionIds.length > 0) {
    await db.insert(documentCollections).values(
      collectionIds.map((collectionId) => ({ documentId, collectionId }))
    );
  }

  revalidatePath("/library");
  revalidatePath(`/library/${documentId}`);
  return { success: true };
}

export async function addDocumentToCollection(
  documentId: string,
  collectionId: string
) {
  await db
    .insert(documentCollections)
    .values({ documentId, collectionId })
    .onConflictDoNothing();

  revalidatePath("/library");
  revalidatePath(`/library/${documentId}`);
  return { success: true };
}

export async function removeDocumentFromCollection(
  documentId: string,
  collectionId: string
) {
  await db
    .delete(documentCollections)
    .where(
      sql`${documentCollections.documentId} = ${documentId} AND ${documentCollections.collectionId} = ${collectionId}`
    );

  revalidatePath("/library");
  revalidatePath(`/library/${documentId}`);
  return { success: true };
}
