import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { db } from "@/db";
import {
  documents,
  entities,
} from "@/db/schema";
import { extractFromUrl, detectContentType, downloadDocumentImage } from "@/lib/content/extractor";
import { parseDriveUrl, resolveDriveFileSource } from "@/lib/drive";
import {
  extractEntitiesWithDBConfig,
  generateSummaryWithDBConfig,
  generateTagsWithDBConfig,
  type ExtractedEntity,
  type ExtractedRelationship,
} from "@/lib/ai";
import {
  chunkStructured,
  generateContentHash,
  generateGraphEmbeddings,
  generateRetrievalEmbeddings,
  getCurrentEmbeddingModel,
  hasContentChanged,
  metricsCollector,
  type StructuredChunk,
} from "@/lib/embedding";
import { dedupeDocumentChunks } from "./chunks";
import { entityKeysEqual, makeEntityKey, type EntityKey } from "./entity-key";
import { persistDerivedDocumentData } from "./persistence";

export type DocumentIngestionStep =
  | "fetching"
  | "chunking"
  | "summarizing"
  | "tagging"
  | "extracting"
  | "embedding"
  | "saving"
  | "complete"
  | "error";

export type DocumentIngestionEvent = {
  step: DocumentIngestionStep;
  message: string;
  progress: number;
  error?: boolean;
  documentId?: string;
};

export type DocumentIngestionOptions = {
  maxEntities?: number;
  maxRelationships?: number;
  onEvent?: (event: DocumentIngestionEvent) => void | Promise<void>;
};

export type DocumentIngestionResult = {
  success: true;
  documentId: string;
  skipped: boolean;
};

type SourceContent = {
  title: string;
  content: string;
  type: "article" | "youtube" | "note" | "pdf" | "gdoc";
  url: string | null;
  leadImageUrl?: string;
  metadata?: Record<string, unknown>;
};

type DerivedDocumentData = {
  contentHash: string;
  embeddingModel: string;
  chunks: StructuredChunk[];
  chunkEmbeddings: number[][];
  summary: string | null;
  tags: string[];
  entities: ExtractedEntity[];
  relationships: ExtractedRelationship[];
  entityEmbeddingsByKey: ReadonlyMap<EntityKey, number[]>;
};

export async function ingestUrlDocument(
  url: string,
  options: DocumentIngestionOptions = {}
): Promise<DocumentIngestionResult> {
  const normalizedUrl = validateUrl(url);
  await emit(options, "fetching", `Extracting content from ${normalizedUrl}...`, 10);

  const source = await getUrlSource(normalizedUrl);
  await emit(options, "saving", "Creating document record...", 20);

  const [doc] = await db
    .insert(documents)
    .values({
      url: source.url,
      title: source.title,
      type: source.type,
      content: source.content,
      processingStatus: "processing",
      metadata: getSourceMetadata(source),
    })
    .returning({ id: documents.id });

  try {
    await saveLeadImage(doc.id, source.leadImageUrl, source.metadata);
    const derived = await buildDerivedData(doc.id, source, options);
    const persistence = await persistDerivedDocumentData(db, {
      documentId: doc.id,
      source,
      derived,
      replaceExisting: false,
    });
    afterPersistDerivedDocumentData(doc.id, persistence.droppedRelationshipCount);
    await complete(options, doc.id, "Document processed successfully!", false);
    return { success: true, documentId: doc.id, skipped: false };
  } catch (error) {
    await markFailed(doc.id);
    await emit(options, "error", error instanceof Error ? error.message : String(error), 0, true, doc.id);
    throw error;
  }
}

export async function ingestTextDocument(
  input: { title: string; content: string },
  options: DocumentIngestionOptions = {}
): Promise<DocumentIngestionResult> {
  if (!input.title.trim()) throw new Error("Title is required");
  if (!input.content.trim()) throw new Error("Content is required");

  const source: SourceContent = {
    title: input.title.trim(),
    content: input.content,
    type: "note",
    url: null,
  };

  await emit(options, "saving", "Creating document record...", 20);
  const [doc] = await db
    .insert(documents)
    .values({
      title: source.title,
      type: "note",
      content: source.content,
      processingStatus: "processing",
    })
    .returning({ id: documents.id });

  try {
    const derived = await buildDerivedData(doc.id, source, options);
    const persistence = await persistDerivedDocumentData(db, {
      documentId: doc.id,
      source,
      derived,
      replaceExisting: false,
    });
    afterPersistDerivedDocumentData(doc.id, persistence.droppedRelationshipCount);
    await complete(options, doc.id, "Document processed successfully!", false);
    return { success: true, documentId: doc.id, skipped: false };
  } catch (error) {
    await markFailed(doc.id);
    await emit(options, "error", error instanceof Error ? error.message : String(error), 0, true, doc.id);
    throw error;
  }
}

export async function refreshDocument(
  documentId: string,
  options: DocumentIngestionOptions = {}
): Promise<DocumentIngestionResult> {
  await emit(options, "fetching", "Validating document...", 5, false, documentId);

  const [existing] = await db
    .select({
      id: documents.id,
      url: documents.url,
      contentHash: documents.contentHash,
      embeddingModel: documents.embeddingModel,
    })
    .from(documents)
    .where(eq(documents.id, documentId))
    .limit(1);

  if (!existing) throw new Error("Document not found");
  if (!existing.url) throw new Error("Document has no source URL");

  await emit(options, "fetching", "Fetching content from source...", 15, false, documentId);
  const source = await getUrlSource(existing.url);
  await saveLeadImage(documentId, source.leadImageUrl);

  const embeddingModel = await getCurrentEmbeddingModel();
  const contentHash = generateContentHash(source.content);
  const unchanged =
    !hasContentChanged(source.content, existing.contentHash) &&
    existing.embeddingModel === embeddingModel;

  if (unchanged) {
    await emit(options, "saving", "Source and embedding model unchanged; keeping derived data.", 85, false, documentId);
    await db
      .update(documents)
      .set({
        title: source.title,
        type: source.type,
        content: source.content,
        contentHash,
        embeddingModel,
        processingStatus: "completed",
        updatedAt: new Date(),
      })
      .where(eq(documents.id, documentId));
    revalidateDocument(documentId);
    await complete(options, documentId, "Document refresh skipped; derived data is unchanged.", true);
    return { success: true, documentId, skipped: true };
  }

  await db
    .update(documents)
    .set({ processingStatus: "processing", updatedAt: new Date() })
    .where(eq(documents.id, documentId));

  try {
    const derived = await buildDerivedData(documentId, source, options);
    const persistence = await persistDerivedDocumentData(db, {
      documentId,
      source,
      derived,
      replaceExisting: true,
    });
    afterPersistDerivedDocumentData(documentId, persistence.droppedRelationshipCount);
    await complete(options, documentId, "Document updated successfully!", false);
    return { success: true, documentId, skipped: false };
  } catch (error) {
    await markFailed(documentId);
    await emit(options, "error", error instanceof Error ? error.message : String(error), 0, true, documentId);
    throw error;
  }
}

async function buildDerivedData(
  documentId: string,
  source: SourceContent,
  options: DocumentIngestionOptions
): Promise<DerivedDocumentData> {
  metricsCollector.startIngestion(documentId);

  try {
    const embeddingModel = await getCurrentEmbeddingModel();
    const contentHash = generateContentHash(source.content);

    await emit(options, "chunking", "Splitting content into chunks...", 25, false, documentId);
    const textChunks = chunkStructured(source.content, {
      minChunkTokens: 100,
      maxChunkTokens: 800,
      targetChunkTokens: 500,
    });
    const dedupedChunks = dedupeDocumentChunks(
      textChunks.map((chunk) => ({ ...chunk, chunkIndex: chunk.index }))
    );
    const uniqueChunks = dedupedChunks.uniqueChunks;
    metricsCollector.recordChunking(uniqueChunks.length);
    const dedupeMsg =
      dedupedChunks.duplicateCount > 0
        ? ` (${dedupedChunks.duplicateCount} duplicates removed)`
        : "";
    await emit(options, "chunking", `Created ${uniqueChunks.length} chunks${dedupeMsg}`, 30, false, documentId);

    await emit(options, "summarizing", "Generating AI summary...", 35, false, documentId);
    const summary = await generateSummaryWithDBConfig(source.content.slice(0, 8000));
    await emit(options, "summarizing", "Summary generated", 45, false, documentId);

    await emit(options, "tagging", "Generating tags...", 47, false, documentId);
    const aiTags = await generateTagsWithDBConfig({
      title: source.title,
      summary,
      content: source.content.slice(0, 8000),
    });
    await emit(options, "tagging", aiTags.length > 0 ? `Generated ${aiTags.length} tags` : "No tags generated", 49, false, documentId);

    await emit(options, "extracting", "Extracting entities and relationships...", 50, false, documentId);
    const extractedData = await extractEntitiesWithDBConfig(source.content.slice(0, 8000), {
      maxEntities: options.maxEntities,
      maxRelationships: options.maxRelationships,
    });
    await emit(
      options,
      "extracting",
      `Found ${extractedData.entities.length} entities, ${extractedData.relationships.length} relationships`,
      60,
      false,
      documentId
    );

    await emit(options, "embedding", `Generating embeddings for ${uniqueChunks.length} chunks...`, 65, false, documentId);
    const chunkEmbeddingResult = await generateRetrievalEmbeddings(uniqueChunks.map((chunk) => chunk.content));
    await emit(options, "embedding", `Generated ${chunkEmbeddingResult.embeddings.length} chunk embeddings`, 75, false, documentId);

    const uniqueEntities = dedupeEntities(extractedData.entities);
    const newEntities = await getNewEntities(uniqueEntities);
    const generatedEntityEmbeddings =
      newEntities.length > 0
        ? (await generateGraphEmbeddings(
            newEntities.map((entity) => entity.name + (entity.description ? `: ${entity.description}` : ""))
          )).embeddings
        : [];
    const entityEmbeddingsByKey = new Map<EntityKey, number[]>();
    newEntities.forEach((entity, index) => {
      const embedding = generatedEntityEmbeddings[index];
      if (embedding) {
        entityEmbeddingsByKey.set(makeEntityKey(entity), embedding);
      }
    });

    return {
      contentHash,
      embeddingModel,
      chunks: uniqueChunks,
      chunkEmbeddings: chunkEmbeddingResult.embeddings,
      summary,
      tags: aiTags,
      entities: uniqueEntities,
      relationships: extractedData.relationships,
      entityEmbeddingsByKey,
    };
  } finally {
    metricsCollector.finishIngestion();
  }
}

async function getNewEntities(uniqueEntities: ExtractedEntity[]): Promise<ExtractedEntity[]> {
  const newEntities: ExtractedEntity[] = [];

  for (const entity of uniqueEntities) {
    const existing = await db
      .select({ id: entities.id })
      .from(entities)
      .where(and(eq(entities.name, entity.name), eq(entities.type, entity.type)))
      .limit(1);

    if (existing.length === 0) {
      newEntities.push(entity);
    }
  }

  return newEntities;
}

function afterPersistDerivedDocumentData(documentId: string, droppedRelationshipCount: number) {
  if (droppedRelationshipCount > 0) {
    metricsCollector.log(`[INGEST] Dropped ${droppedRelationshipCount} unresolved relationships for ${documentId}`);
  }

  revalidateDocument(documentId);
}

async function getUrlSource(url: string): Promise<SourceContent> {
  if (parseDriveUrl(url)?.kind === "file") {
    return resolveDriveFileSource(url);
  }

  const extracted = await extractFromUrl(url);
  if (!extracted) throw new Error("Failed to extract content from URL");

  const contentType = detectContentType(url);
  return {
    title: extracted.title,
    content: extracted.content,
    type: contentType === "youtube" ? "youtube" : "article",
    url,
    leadImageUrl: extracted.leadImageUrl,
  };
}

function validateUrl(url: string): string {
  if (!url || url.trim().length === 0) throw new Error("URL is required");
  const parsed = new URL(url);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Unsupported URL scheme: ${parsed.protocol}`);
  }
  return parsed.toString();
}

function getSourceMetadata(source: SourceContent): Record<string, unknown> | undefined {
  if (!source.metadata && !source.leadImageUrl) return undefined;
  return {
    ...(source.metadata ?? {}),
    ...(source.leadImageUrl ? { leadImageUrl: source.leadImageUrl } : {}),
  };
}

async function saveLeadImage(
  documentId: string,
  leadImageUrl?: string,
  existingMetadata?: Record<string, unknown>
) {
  if (!leadImageUrl) return;
  const image = await downloadDocumentImage(leadImageUrl, documentId);
  if (!image) return;

  await db
    .update(documents)
    .set({
      metadata: {
        ...(existingMetadata ?? {}),
        leadImageUrl: image.url,
        imagePath: image.publicPath,
        imageContentType: image.contentType,
      },
      updatedAt: new Date(),
    })
    .where(eq(documents.id, documentId));
}

async function markFailed(documentId: string) {
  await db
    .update(documents)
    .set({ processingStatus: "failed", updatedAt: new Date() })
    .where(eq(documents.id, documentId));
}

async function complete(
  options: DocumentIngestionOptions,
  documentId: string,
  message: string,
  skipped: boolean
) {
  await emit(options, "complete", message, 100, false, documentId);
  revalidateDocument(documentId);
  if (skipped) {
    metricsCollector.log(`[INGEST] Document ${documentId} unchanged, skipped derived rebuild`);
  }
}

async function emit(
  options: DocumentIngestionOptions,
  step: DocumentIngestionStep,
  message: string,
  progress: number,
  error = false,
  documentId?: string
) {
  await options.onEvent?.({ step, message, progress, error, documentId });
}

function revalidateDocument(documentId: string) {
  revalidatePath("/library");
  revalidatePath(`/library/${documentId}`);
  revalidatePath("/graph");
}

function dedupeEntities<T extends ExtractedEntity>(entityRows: T[]): T[] {
  const seen: EntityKey[] = [];
  const unique: T[] = [];

  for (const entity of entityRows) {
    const key = makeEntityKey(entity);
    if (seen.some((existingKey) => entityKeysEqual(existingKey, key))) continue;
    seen.push(key);
    unique.push(entity);
  }

  return unique;
}
