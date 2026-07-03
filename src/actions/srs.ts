"use server";

import { asc, eq, lte } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { chunks, documents, srsItems, type SrsItem } from "@/db/schema";
import { generateFlashcardsWithDBConfig } from "@/lib/ai";
import {
  buildFlashcardSource,
  normalizeFlashcardCount,
  shapeGeneratedFlashcards,
} from "@/lib/srs/flashcards";
import { countDueCardsByDocument } from "@/lib/srs/due-counts";
import {
  SRS_RATINGS,
  SRS_STATES,
  scheduleSrsReview,
  type SrsRating,
} from "@/lib/srs/scheduler";

export type SrsCardListItem = {
  id: string;
  documentId: string;
  question: string;
  answer: string;
  stability: number;
  difficulty: number;
  elapsedDays: number;
  scheduledDays: number;
  reps: number;
  lapses: number;
  state: number;
  dueDate: string;
  isDue: boolean;
  lastReviewDate: string | null;
  createdAt: string;
};

export type DueSrsCard = SrsCardListItem & {
  documentTitle: string;
};

export type SrsStats = {
  total: number;
  due: number;
};

export async function getDocumentFlashcards(documentId: string): Promise<SrsCardListItem[]> {
  const rows = await db
    .select()
    .from(srsItems)
    .where(eq(srsItems.documentId, documentId))
    .orderBy(asc(srsItems.createdAt));

  return rows.map((row) => serializeSrsItem(row));
}

export async function getDocumentSrsStats(documentId: string): Promise<SrsStats> {
  const rows = await db
    .select({
      documentId: srsItems.documentId,
      dueDate: srsItems.dueDate,
    })
    .from(srsItems)
    .where(eq(srsItems.documentId, documentId));

  return {
    total: rows.length,
    due: countDueCardsByDocument(rows, new Date())[documentId] ?? 0,
  };
}

export async function generateDocumentFlashcards(
  documentId: string,
  requestedCount = 5
): Promise<{ success: boolean; created: number; cards: SrsCardListItem[]; error?: string }> {
  const [doc] = await db
    .select({
      id: documents.id,
      title: documents.title,
      summary: documents.summary,
      content: documents.content,
    })
    .from(documents)
    .where(eq(documents.id, documentId))
    .limit(1);

  if (!doc) {
    return { success: false, created: 0, cards: [], error: "Document not found" };
  }

  const docChunks = await db
    .select({ content: chunks.content })
    .from(chunks)
    .where(eq(chunks.documentId, documentId))
    .orderBy(asc(chunks.chunkIndex));

  const source = buildFlashcardSource({
    title: doc.title,
    summary: doc.summary,
    content: doc.content,
    chunks: docChunks.map((chunk) => chunk.content),
  });

  if (!source) {
    return {
      success: false,
      created: 0,
      cards: await getDocumentFlashcards(documentId),
      error: "Document has no text available for flashcards",
    };
  }

  const count = normalizeFlashcardCount(requestedCount);
  const generated = await generateFlashcardsWithDBConfig(source, count);
  const shaped = shapeGeneratedFlashcards(generated, count);

  if (shaped.length === 0) {
    return {
      success: false,
      created: 0,
      cards: await getDocumentFlashcards(documentId),
      error: "No usable flashcards were generated",
    };
  }

  const existingRows = await db
    .select({ question: srsItems.question })
    .from(srsItems)
    .where(eq(srsItems.documentId, documentId));
  const existingQuestions = new Set(
    existingRows.map((row) => row.question.trim().toLocaleLowerCase())
  );
  const newCards = shaped.filter(
    (card) => !existingQuestions.has(card.question.trim().toLocaleLowerCase())
  );

  if (newCards.length > 0) {
    const now = new Date();
    await db.insert(srsItems).values(
      newCards.map((card) => ({
        documentId,
        question: card.question,
        answer: card.answer,
        stability: 0,
        difficulty: 0,
        elapsedDays: 0,
        scheduledDays: 0,
        reps: 0,
        lapses: 0,
        state: SRS_STATES.new,
        dueDate: now,
      }))
    );
  }

  revalidateSrsPaths(documentId);

  return {
    success: true,
    created: newCards.length,
    cards: await getDocumentFlashcards(documentId),
    error: newCards.length === 0 ? "Generated cards already exist for this document" : undefined,
  };
}

export async function listDueSrsItems(limit = 20): Promise<DueSrsCard[]> {
  const now = new Date();
  const rows = await db
    .select({
      id: srsItems.id,
      documentId: srsItems.documentId,
      question: srsItems.question,
      answer: srsItems.answer,
      stability: srsItems.stability,
      difficulty: srsItems.difficulty,
      elapsedDays: srsItems.elapsedDays,
      scheduledDays: srsItems.scheduledDays,
      reps: srsItems.reps,
      lapses: srsItems.lapses,
      state: srsItems.state,
      dueDate: srsItems.dueDate,
      lastReviewDate: srsItems.lastReviewDate,
      createdAt: srsItems.createdAt,
      documentTitle: documents.title,
    })
    .from(srsItems)
    .innerJoin(documents, eq(documents.id, srsItems.documentId))
    .where(lte(srsItems.dueDate, now))
    .orderBy(asc(srsItems.dueDate), asc(srsItems.createdAt))
    .limit(normalizeDueLimit(limit));

  return rows.map((row) => ({
    ...serializeSrsItem(row, now),
    documentTitle: row.documentTitle,
  }));
}

export async function reviewSrsItem(
  itemId: string,
  rating: SrsRating
): Promise<{ success: boolean; item?: SrsCardListItem; error?: string }> {
  if (!isSrsRating(rating)) {
    return { success: false, error: "Invalid review rating" };
  }

  const [item] = await db
    .select()
    .from(srsItems)
    .where(eq(srsItems.id, itemId))
    .limit(1);

  if (!item) {
    return { success: false, error: "Flashcard not found" };
  }

  const next = scheduleSrsReview(
    {
      stability: item.stability,
      difficulty: item.difficulty,
      reps: item.reps,
      lapses: item.lapses,
      state: item.state,
      dueDate: item.dueDate,
      lastReviewDate: item.lastReviewDate,
    },
    rating,
    new Date()
  );

  await db
    .update(srsItems)
    .set({
      stability: next.stability,
      difficulty: next.difficulty,
      elapsedDays: next.elapsedDays,
      scheduledDays: next.scheduledDays,
      reps: next.reps,
      lapses: next.lapses,
      state: next.state,
      dueDate: next.dueDate,
      lastReviewDate: next.lastReviewDate,
    })
    .where(eq(srsItems.id, itemId));

  revalidateSrsPaths(item.documentId);

  return {
    success: true,
    item: serializeSrsItem({
      ...item,
      ...next,
    }),
  };
}

export async function deleteSrsItem(
  itemId: string
): Promise<{ success: boolean; error?: string }> {
  const [item] = await db
    .select({
      id: srsItems.id,
      documentId: srsItems.documentId,
    })
    .from(srsItems)
    .where(eq(srsItems.id, itemId))
    .limit(1);

  if (!item) {
    return { success: false, error: "Flashcard not found" };
  }

  await db.delete(srsItems).where(eq(srsItems.id, itemId));
  revalidateSrsPaths(item.documentId);

  return { success: true };
}

function serializeSrsItem(item: SrsItem, now = new Date()): SrsCardListItem {
  return {
    id: item.id,
    documentId: item.documentId,
    question: item.question,
    answer: item.answer,
    stability: item.stability ?? 0,
    difficulty: item.difficulty ?? 0,
    elapsedDays: item.elapsedDays ?? 0,
    scheduledDays: item.scheduledDays ?? 0,
    reps: item.reps ?? 0,
    lapses: item.lapses ?? 0,
    state: item.state ?? SRS_STATES.new,
    dueDate: item.dueDate.toISOString(),
    isDue: item.dueDate.getTime() <= now.getTime(),
    lastReviewDate: item.lastReviewDate?.toISOString() ?? null,
    createdAt: item.createdAt.toISOString(),
  };
}

function normalizeDueLimit(limit: number): number {
  if (!Number.isFinite(limit)) {
    return 20;
  }

  return Math.min(100, Math.max(1, Math.floor(limit)));
}

function isSrsRating(rating: string): rating is SrsRating {
  return Object.values(SRS_RATINGS).includes(rating as SrsRating);
}

function revalidateSrsPaths(documentId: string) {
  revalidatePath("/library");
  revalidatePath(`/library/${documentId}`);
  revalidatePath("/review");
}
