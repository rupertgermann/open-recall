"use server";

import { db } from "@/db";
import { collections, documentCollections, documents } from "@/db/schema";
import { eq, desc, sql, count, inArray, notInArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { generateObject } from "ai";
import { z } from "zod";
import { getChatConfigFromDB, getModel } from "@/lib/ai";

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

// ============================================================================
// AI-POWERED COLLECTION ASSIGNMENT
// ============================================================================

export type CollectionSuggestion = {
  collectionId: string;
  collectionName: string;
  confidence: "high" | "medium" | "low";
  reason: string;
};

const suggestionSchema = z.object({
  suggestions: z.array(
    z.object({
      collectionName: z.string(),
      confidence: z.enum(["high", "medium", "low"]),
      reason: z.string(),
    })
  ),
});

export async function suggestCollectionsForDocument(
  documentId: string
): Promise<CollectionSuggestion[]> {
  const [doc] = await db
    .select({ title: documents.title, summary: documents.summary })
    .from(documents)
    .where(eq(documents.id, documentId))
    .limit(1);

  if (!doc) return [];

  const allCollections = await db
    .select({ id: collections.id, name: collections.name, description: collections.description })
    .from(collections);

  if (allCollections.length === 0) return [];

  const assignedIds = await getDocumentCollections(documentId);
  const unassigned = allCollections.filter((c) => !assignedIds.includes(c.id));

  if (unassigned.length === 0) return [];

  const collectionList = unassigned
    .map((c) => `- "${c.name}"${c.description ? `: ${c.description}` : ""}`)
    .join("\n");

  const config = await getChatConfigFromDB();
  const model = getModel(config);

  try {
    const { object } = await generateObject({
      model,
      schema: suggestionSchema,
      system: `You classify documents into collections in a personal knowledge base.
Only suggest collections that are a strong thematic match. Return an empty array if no collection fits.
Be conservative — only "high" confidence if the match is obvious.`,
      prompt: `Document title: "${doc.title}"
Document summary: ${doc.summary || "(no summary)"}

Available collections:
${collectionList}

Which collections should this document belong to?`,
    });

    return object.suggestions
      .map((s) => {
        const match = unassigned.find(
          (c) => c.name.toLowerCase() === s.collectionName.toLowerCase()
        );
        if (!match) return null;
        return {
          collectionId: match.id,
          collectionName: match.name,
          confidence: s.confidence,
          reason: s.reason,
        };
      })
      .filter((s): s is CollectionSuggestion => s !== null);
  } catch (error) {
    console.error("Collection suggestion failed:", error);
    return [];
  }
}

export type AutoOrganizeResult = {
  documentId: string;
  documentTitle: string;
  assignedCollections: string[];
};

export type AutoOrganizeSuggestion = {
  documentId: string;
  documentTitle: string;
  existingCollections: {
    collectionId: string;
    collectionName: string;
    reason: string;
  }[];
  newCollections: {
    suggestedName: string;
    suggestedDescription: string;
    reason: string;
  }[];
};

const autoOrganizeSuggestionSchema = z.object({
  assignments: z.array(
    z.object({
      documentTitle: z.string(),
      existingCollections: z.array(
        z.object({
          collectionName: z.string(),
          reason: z.string().describe("Brief reason why this document fits this collection"),
        })
      ),
      newCollections: z.array(
        z.object({
          suggestedName: z.string().describe("Short, descriptive name for the new collection"),
          suggestedDescription: z.string().describe("Brief description of what this collection contains"),
          reason: z.string().describe("Why this new collection is needed"),
        })
      ),
    })
  ),
});

const batchAssignmentSchema = z.object({
  assignments: z.array(
    z.object({
      documentTitle: z.string(),
      collectionNames: z.array(z.string()),
    })
  ),
});

export async function suggestAutoOrganize(): Promise<AutoOrganizeSuggestion[]> {
  const allCollections = await db
    .select({ id: collections.id, name: collections.name, description: collections.description })
    .from(collections);

  const unassignedDocs = await db
    .select({
      id: documents.id,
      title: documents.title,
      summary: documents.summary,
    })
    .from(documents)
    .where(
      sql`${documents.id} NOT IN (
        SELECT document_id FROM document_collections
      )`
    )
    .orderBy(desc(documents.createdAt))
    .limit(50);

  if (unassignedDocs.length === 0) return [];

  const collectionList = allCollections.length > 0
    ? allCollections
        .map((c) => `- "${c.name}"${c.description ? `: ${c.description}` : ""}`)
        .join("\n")
    : "(no existing collections)";

  const docList = unassignedDocs
    .map((d) => `- "${d.title}": ${(d.summary || "").slice(0, 200)}`)
    .join("\n");

  const config = await getChatConfigFromDB();
  const model = getModel(config);

  try {
    const { object } = await generateObject({
      model,
      schema: autoOrganizeSuggestionSchema,
      system: `You organize documents into collections in a personal knowledge base.
For each document:
1. First check if it fits any EXISTING collection. Only suggest existing collections where the match is clear.
2. If no existing collection is a good fit, suggest creating a NEW collection with a short, descriptive name.
3. If a document truly doesn't need organizing, you may skip it.
Use exact collection names from the provided list when suggesting existing collections.
Keep new collection names concise (2-4 words). Group similar unassigned documents under the same new collection name.`,
      prompt: `Existing collections:
${collectionList}

Documents to organize:
${docList}

For each document, suggest which existing collection(s) it belongs to, or propose new collection(s) to create.`,
    });

    return object.assignments
      .map((assignment) => {
        const doc = unassignedDocs.find(
          (d) => d.title.toLowerCase() === assignment.documentTitle.toLowerCase()
        );
        if (!doc) return null;

        const existingCollections = assignment.existingCollections
          .map((ec) => {
            const match = allCollections.find(
              (c) => c.name.toLowerCase() === ec.collectionName.toLowerCase()
            );
            if (!match) return null;
            return {
              collectionId: match.id,
              collectionName: match.name,
              reason: ec.reason,
            };
          })
          .filter((x): x is NonNullable<typeof x> => x !== null);

        return {
          documentId: doc.id,
          documentTitle: doc.title,
          existingCollections,
          newCollections: assignment.newCollections,
        };
      })
      .filter((x): x is AutoOrganizeSuggestion => x !== null)
      .filter((x) => x.existingCollections.length > 0 || x.newCollections.length > 0);
  } catch (error) {
    console.error("Auto-organize suggestion failed:", error);
    return [];
  }
}

export async function applyAutoOrganizeSuggestions(
  suggestions: {
    documentId: string;
    existingCollectionIds: string[];
    newCollections: { name: string; description: string }[];
  }[]
): Promise<AutoOrganizeResult[]> {
  const results: AutoOrganizeResult[] = [];

  for (const suggestion of suggestions) {
    const [doc] = await db
      .select({ id: documents.id, title: documents.title })
      .from(documents)
      .where(eq(documents.id, suggestion.documentId))
      .limit(1);

    if (!doc) continue;

    const assignedNames: string[] = [];

    // Add to existing collections
    for (const collectionId of suggestion.existingCollectionIds) {
      await db
        .insert(documentCollections)
        .values({ documentId: doc.id, collectionId })
        .onConflictDoNothing();

      const [col] = await db
        .select({ name: collections.name })
        .from(collections)
        .where(eq(collections.id, collectionId))
        .limit(1);
      if (col) assignedNames.push(col.name);
    }

    // Create new collections and add document
    for (const newCol of suggestion.newCollections) {
      const [created] = await db
        .insert(collections)
        .values({
          name: newCol.name,
          description: newCol.description || null,
          color: "#6366f1",
        })
        .onConflictDoNothing()
        .returning();

      if (created) {
        await db
          .insert(documentCollections)
          .values({ documentId: doc.id, collectionId: created.id })
          .onConflictDoNothing();
        assignedNames.push(created.name);
      } else {
        // Collection already exists, find it and add
        const [existing] = await db
          .select({ id: collections.id, name: collections.name })
          .from(collections)
          .where(eq(collections.name, newCol.name))
          .limit(1);
        if (existing) {
          await db
            .insert(documentCollections)
            .values({ documentId: doc.id, collectionId: existing.id })
            .onConflictDoNothing();
          assignedNames.push(existing.name);
        }
      }
    }

    if (assignedNames.length > 0) {
      results.push({
        documentId: doc.id,
        documentTitle: doc.title,
        assignedCollections: assignedNames,
      });
    }
  }

  revalidatePath("/library");
  return results;
}

export async function autoOrganizeDocuments(): Promise<AutoOrganizeResult[]> {
  const allCollections = await db
    .select({ id: collections.id, name: collections.name, description: collections.description })
    .from(collections);

  if (allCollections.length === 0) return [];

  const unassignedDocs = await db
    .select({
      id: documents.id,
      title: documents.title,
      summary: documents.summary,
    })
    .from(documents)
    .where(
      sql`${documents.id} NOT IN (
        SELECT document_id FROM document_collections
      )`
    )
    .orderBy(desc(documents.createdAt))
    .limit(50);

  if (unassignedDocs.length === 0) return [];

  const collectionList = allCollections
    .map((c) => `- "${c.name}"${c.description ? `: ${c.description}` : ""}`)
    .join("\n");

  const docList = unassignedDocs
    .map((d) => `- "${d.title}": ${(d.summary || "").slice(0, 200)}`)
    .join("\n");

  const config = await getChatConfigFromDB();
  const model = getModel(config);

  try {
    const { object } = await generateObject({
      model,
      schema: batchAssignmentSchema,
      system: `You organize documents into collections in a personal knowledge base.
For each document, assign it to one or more collections that fit thematically.
Only assign a document to a collection if the match is clear. Skip documents that don't fit any collection.
Use exact collection names from the provided list.`,
      prompt: `Collections:
${collectionList}

Documents to organize:
${docList}

Assign each document to the appropriate collection(s). Only include documents that clearly fit.`,
    });

    const results: AutoOrganizeResult[] = [];

    for (const assignment of object.assignments) {
      const doc = unassignedDocs.find(
        (d) => d.title.toLowerCase() === assignment.documentTitle.toLowerCase()
      );
      if (!doc) continue;

      const matchedCollectionIds = assignment.collectionNames
        .map((name) =>
          allCollections.find((c) => c.name.toLowerCase() === name.toLowerCase())
        )
        .filter((c): c is (typeof allCollections)[number] => c !== null)
        .map((c) => c.id);

      if (matchedCollectionIds.length === 0) continue;

      for (const collectionId of matchedCollectionIds) {
        await db
          .insert(documentCollections)
          .values({ documentId: doc.id, collectionId })
          .onConflictDoNothing();
      }

      results.push({
        documentId: doc.id,
        documentTitle: doc.title,
        assignedCollections: assignment.collectionNames.filter((name) =>
          allCollections.some((c) => c.name.toLowerCase() === name.toLowerCase())
        ),
      });
    }

    revalidatePath("/library");
    return results;
  } catch (error) {
    console.error("Auto-organize failed:", error);
    return [];
  }
}

export async function bulkAddToCollection(
  documentIds: string[],
  collectionId: string
) {
  if (documentIds.length === 0) return { success: true, count: 0 };

  const values = documentIds.map((documentId) => ({ documentId, collectionId }));
  await db.insert(documentCollections).values(values).onConflictDoNothing();

  revalidatePath("/library");
  return { success: true, count: documentIds.length };
}

export async function getUnassignedDocumentCount(): Promise<number> {
  const [result] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(documents)
    .where(
      sql`${documents.id} NOT IN (
        SELECT document_id FROM document_collections
      )`
    );

  return Number(result?.count) || 0;
}
