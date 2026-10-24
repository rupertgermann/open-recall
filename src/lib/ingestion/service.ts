import { randomUUID } from "node:crypto";
import { and, asc, eq, isNotNull, sql } from "drizzle-orm";
import { revalidatePath as nextRevalidatePath } from "next/cache.js";

import {
  documents,
  entities,
} from "../../db/schema.ts";
import { extractFromUrl, downloadDocumentImage } from "../content/extractor.ts";
import { discardDocumentImage } from "../content/images.ts";
import {
  buildDriveFolderImportPlan,
  parseDriveUrl,
  resolveDriveFileSource,
  type DriveFolderImportPlan,
  type GogRunner,
} from "../drive/index.ts";
import { metricsCollector } from "../embedding/metrics.ts";
import { CHUNKING_VERSION, type StructuredChunk } from "../embedding/chunker.ts";
import { generateContentHash } from "../text/index.ts";
import { dedupeDocumentChunks } from "./chunks.ts";
import { entityKeysEqual, makeEntityKey, type EntityKey } from "./entity-key.ts";
import { persistDerivedDocumentData } from "./persistence.ts";

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
  recoverable?: boolean;
  documentId?: string;
};

export type DocumentIngestionOptions = {
  maxEntities?: number;
  maxRelationships?: number;
  driveRunner?: GogRunner;
  onEvent?: (event: DocumentIngestionEvent) => void | Promise<void>;
};

export type DocumentIngestionResult = {
  success: true;
  documentId: string;
  skipped: boolean;
  action: "ingested" | "refreshed" | "skipped";
};

export type DriveFolderImportSummary = {
  ingested: number;
  refreshed: number;
  skippedUnchanged: number;
  skippedUnsupported: number;
  failed: number;
  failures: { fileId: string; name: string; error: string }[];
};

export type DriveFolderImportResult = {
  success: true;
  plan: DriveFolderImportPlan;
  summary: DriveFolderImportSummary;
};

export type SourceContent = {
  title: string;
  content: string;
  type: "article" | "youtube" | "note" | "pdf" | "gdoc";
  url: string | null;
  leadImageUrl?: string;
  metadata?: Record<string, unknown>;
};

type ExtractedEntity = {
  name: string;
  type: string;
  description: string | null;
};

type ExtractedRelationship = {
  source: string;
  target: string;
  type: string;
  description: string | null;
};

export type DerivedDocumentData = {
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

type IngestionDatabase = any;

type BuildDerivedDocumentData = (
  documentId: string,
  source: SourceContent,
  options: DocumentIngestionOptions
) => Promise<DerivedDocumentData>;

type DocumentIngestionServiceContext = {
  database: IngestionDatabase;
  buildDerivedData: BuildDerivedDocumentData;
  getCurrentEmbeddingModel: () => Promise<string>;
  revalidatePath: (path: string) => void;
};

export type DocumentIngestionServiceDependencies = {
  database: IngestionDatabase;
  buildDerivedData?: BuildDerivedDocumentData;
  getCurrentEmbeddingModel?: () => Promise<string>;
  revalidatePath?: (path: string) => void;
};

export function createDocumentIngestionService(
  dependencies: DocumentIngestionServiceDependencies
) {
  const context: DocumentIngestionServiceContext = {
    database: dependencies.database,
    buildDerivedData:
      dependencies.buildDerivedData ??
      ((documentId, source, options) =>
        buildDerivedData(dependencies.database, documentId, source, options)),
    getCurrentEmbeddingModel:
      dependencies.getCurrentEmbeddingModel ?? getDefaultCurrentEmbeddingModel,
    revalidatePath: dependencies.revalidatePath ?? nextRevalidatePath,
  };

  return {
    ingestUrlDocument: (url: string, options: DocumentIngestionOptions = {}) =>
      ingestUrlDocumentWithContext(context, url, options),
    ingestTextDocument: (
      input: { title: string; content: string },
      options: DocumentIngestionOptions = {}
    ) => ingestTextDocumentWithContext(context, input, options),
    refreshDocument: (documentId: string, options: DocumentIngestionOptions = {}) =>
      refreshDocumentWithContext(context, documentId, options),
    ingestDriveFolder: (url: string, options: DocumentIngestionOptions = {}) =>
      ingestDriveFolderWithContext(context, url, options),
  };
}

let defaultDatabasePromise: Promise<IngestionDatabase> | null = null;

async function getDefaultDatabase(): Promise<IngestionDatabase> {
  defaultDatabasePromise ??= import("@/db").then((module) => module.db);
  return defaultDatabasePromise;
}

async function getDefaultService() {
  return createDocumentIngestionService({
    database: await getDefaultDatabase(),
    revalidatePath: nextRevalidatePath,
  });
}

async function getDefaultCurrentEmbeddingModel(): Promise<string> {
  const { getCurrentEmbeddingModel } = await import("../embedding/service.ts");
  return getCurrentEmbeddingModel();
}

export async function ingestUrlDocument(
  url: string,
  options: DocumentIngestionOptions = {}
): Promise<DocumentIngestionResult> {
  return (await getDefaultService()).ingestUrlDocument(url, options);
}

export async function ingestDriveFolder(
  url: string,
  options: DocumentIngestionOptions = {}
): Promise<DriveFolderImportResult> {
  return (await getDefaultService()).ingestDriveFolder(url, options);
}

async function ingestUrlDocumentWithContext(
  context: DocumentIngestionServiceContext,
  url: string,
  options: DocumentIngestionOptions = {}
): Promise<DocumentIngestionResult> {
  const normalizedUrl = validateUrl(url);
  await emit(options, "fetching", `Extracting content from ${normalizedUrl}...`, 10);

  const existingDriveDocument = await findExistingDriveDocument(context.database, normalizedUrl);
  if (existingDriveDocument) {
    assertDriveDocumentAvailable(existingDriveDocument);
    await emit(
      options,
      "fetching",
      "Existing Drive File found; refreshing source.",
      15,
      false,
      existingDriveDocument.id
    );
    return refreshDocumentWithContext(context, existingDriveDocument.id, options);
  }

  const source = await getUrlSource(normalizedUrl, options);
  await emit(options, "saving", "Creating document record...", 20);

  const runId = randomUUID();
  const doc = await createOrFindUrlDocument(context.database, source, runId);
  if (!doc.created) {
    assertDriveDocumentAvailable(doc);
    return refreshDocumentWithContext(context, doc.id, options);
  }

  let imagePath: string | undefined;
  try {
    imagePath = await fetchLeadImage(source, runId);
    const derived = await context.buildDerivedData(doc.id, source, options);
    const persistence = await persistDerivedDocumentData(context.database, {
      documentId: doc.id,
      runId,
      source,
      derived,
      replaceExisting: false,
    });
    imagePath = undefined;
    afterPersistDerivedDocumentData(context, doc.id, persistence.droppedRelationshipCount);
    await complete(context, options, doc.id, "Document processed successfully!", false);
    return { success: true, documentId: doc.id, skipped: false, action: "ingested" };
  } catch (error) {
    await discardDocumentImage(imagePath);
    await markFailed(context.database, doc.id, runId);
    await emit(options, "error", error instanceof Error ? error.message : String(error), 0, true, doc.id);
    throw error;
  }
}

export async function ingestTextDocument(
  input: { title: string; content: string },
  options: DocumentIngestionOptions = {}
): Promise<DocumentIngestionResult> {
  return (await getDefaultService()).ingestTextDocument(input, options);
}

async function ingestTextDocumentWithContext(
  context: DocumentIngestionServiceContext,
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

  const runId = randomUUID();
  await emit(options, "saving", "Creating document record...", 20);
  const [doc] = await context.database
    .insert(documents)
    .values({
      title: source.title,
      type: "note",
      content: source.content,
      processingStatus: "processing",
      metadata: { _ingestionRunId: runId },
    })
    .returning({ id: documents.id });

  try {
    const derived = await context.buildDerivedData(doc.id, source, options);
    const persistence = await persistDerivedDocumentData(context.database, {
      documentId: doc.id,
      runId,
      source,
      derived,
      replaceExisting: false,
    });
    afterPersistDerivedDocumentData(context, doc.id, persistence.droppedRelationshipCount);
    await complete(context, options, doc.id, "Document processed successfully!", false);
    return { success: true, documentId: doc.id, skipped: false, action: "ingested" };
  } catch (error) {
    await markFailed(context.database, doc.id, runId);
    await emit(options, "error", error instanceof Error ? error.message : String(error), 0, true, doc.id);
    throw error;
  }
}

export async function refreshDocument(
  documentId: string,
  options: DocumentIngestionOptions = {}
): Promise<DocumentIngestionResult> {
  return (await getDefaultService()).refreshDocument(documentId, options);
}

async function refreshDocumentWithContext(
  context: DocumentIngestionServiceContext,
  documentId: string,
  options: DocumentIngestionOptions = {}
): Promise<DocumentIngestionResult> {
  await emit(options, "fetching", "Validating document...", 5, false, documentId);
  const runId = randomUUID();
  const [existing] = await context.database
    .update(documents)
    .set({
      metadata: sql`coalesce(${documents.metadata}, '{}'::jsonb) || ${JSON.stringify({ _ingestionRunId: runId })}::jsonb`,
      updatedAt: new Date(),
    })
    .where(and(eq(documents.id, documentId), isNotNull(documents.url)))
    .returning();
  if (!existing) {
    const [document] = await context.database.select({ id: documents.id }).from(documents).where(eq(documents.id, documentId)).limit(1);
    throw new Error(document ? "Document has no source URL" : "Document not found");
  }

  let processingStarted = false;
  let imagePath: string | undefined;
  const previousImagePath = typeof existing.metadata?.imagePath === "string" ? existing.metadata.imagePath : undefined;
  try {
    if (!existing.url) throw new Error("Document has no source URL");
    await emit(options, "fetching", "Fetching content from source...", 15, false, documentId);
    const source = await getUrlSource(existing.url, options);
    const embeddingModel = await context.getCurrentEmbeddingModel();
    const contentHash = generateContentHash(source.content);
    imagePath = await fetchLeadImage(source, runId);
    const unchanged =
      contentHash === existing.contentHash &&
      source.content === existing.content &&
      existing.embeddingModel === embeddingModel &&
      existing.embeddingVersion === CHUNKING_VERSION;

    if (unchanged) {
      await emit(options, "saving", "Source and embedding model unchanged; keeping derived data.", 85, false, documentId);
      const updated = await context.database
        .update(documents)
        .set({
          title: source.title,
          type: source.type,
          content: source.content,
          contentHash,
          embeddingModel,
          processingStatus: "completed",
          metadata: sql`(coalesce(${documents.metadata}, '{}'::jsonb) || ${JSON.stringify(source.metadata ?? {})}::jsonb) - '_ingestionRunId'`,
          updatedAt: new Date(),
        })
        .where(ownedRun(documentId, runId))
        .returning({ id: documents.id });
      if (updated.length === 0) throw new Error("Document ingestion was superseded by another run");
      if (imagePath && imagePath !== previousImagePath) await discardDocumentImage(previousImagePath);
      imagePath = undefined;
      await complete(context, options, documentId, "Document refresh skipped; derived data is unchanged.", true);
      return { success: true, documentId, skipped: true, action: "skipped" };
    }

    const updated = await context.database
      .update(documents)
      .set({ processingStatus: "processing", updatedAt: new Date() })
      .where(ownedRun(documentId, runId))
      .returning({ id: documents.id });
    if (updated.length === 0) throw new Error("Document ingestion was superseded by another run");
    processingStarted = true;
    const derived = await context.buildDerivedData(documentId, source, options);
    const persistence = await persistDerivedDocumentData(context.database, {
      documentId,
      runId,
      source,
      derived,
      replaceExisting: true,
    });
    if (imagePath && imagePath !== previousImagePath) await discardDocumentImage(previousImagePath);
    imagePath = undefined;
    afterPersistDerivedDocumentData(context, documentId, persistence.droppedRelationshipCount);
    await complete(context, options, documentId, "Document updated successfully!", false);
    return { success: true, documentId, skipped: false, action: "refreshed" };
  } catch (error) {
    await discardDocumentImage(imagePath);
    await markFailed(context.database, documentId, runId,
      processingStarted || existing.processingStatus === "processing" ? "failed" : existing.processingStatus);
    await emit(options, "error", error instanceof Error ? error.message : String(error), 0, true, documentId);
    throw error;
  }
}

async function ingestDriveFolderWithContext(
  context: DocumentIngestionServiceContext,
  url: string,
  options: DocumentIngestionOptions = {}
): Promise<DriveFolderImportResult> {
  const plan = await buildDriveFolderImportPlan(url, { runner: options.driveRunner });
  const summary: DriveFolderImportSummary = {
    ingested: 0,
    refreshed: 0,
    skippedUnchanged: 0,
    skippedUnsupported: plan.skipped.length,
    failed: 0,
    failures: [],
  };
  const total = plan.supported.length;

  if (total === 0) {
    await emit(options, "complete", "Folder Import complete: no supported Drive Files found.", 100);
    revalidateImportViews(context);
    return { success: true, plan, summary };
  }

  for (const [index, file] of plan.supported.entries()) {
    const fileNumber = index + 1;
    try {
      const result = await ingestUrlDocumentWithContext(context, file.canonicalUrl, {
        ...options,
        onEvent: async (event) => {
          await notify(options, {
            ...event,
            ...(event.error ? { recoverable: true } : {}),
            message: `File ${fileNumber}/${total}: ${event.message}`,
            progress: Math.round(((index + event.progress / 100) / total) * 100),
          });
        },
      });

      if (result.action === "ingested") summary.ingested += 1;
      if (result.action === "refreshed") summary.refreshed += 1;
      if (result.action === "skipped") summary.skippedUnchanged += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      summary.failed += 1;
      summary.failures.push({ fileId: file.id, name: file.name, error: message });
      await notify(options, {
        step: "error",
        message: `File ${fileNumber}/${total}: ${file.name} failed: ${message}`,
        progress: Math.round((fileNumber / total) * 100),
        error: true,
        recoverable: true,
      });
    }
  }

  await emit(
    options,
    "complete",
    `Folder Import complete: ${summary.ingested} ingested, ${summary.refreshed} refreshed, ${summary.skippedUnchanged} unchanged, ${summary.failed} failed.`,
    100
  );
  revalidateImportViews(context);
  return { success: true, plan, summary };
}

async function buildDerivedData(
  database: IngestionDatabase,
  documentId: string,
  source: SourceContent,
  options: DocumentIngestionOptions
): Promise<DerivedDocumentData> {
  const [
    { extractEntitiesWithDBConfig, generateSummaryWithDBConfig, generateTagsWithDBConfig, getEmbeddingConfigFromDB },
    { chunkStructured },
    { generateGraphEmbeddings, generateRetrievalEmbeddings },
  ] = await Promise.all([
    import("../ai/index.ts"),
    import("../embedding/chunker.ts"),
    import("../embedding/service.ts"),
  ]);

  metricsCollector.startIngestion(documentId);

  try {
    const embeddingConfig = await getEmbeddingConfigFromDB();
    const embeddingModel = embeddingConfig.model;
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
    const chunkEmbeddingResult = await generateRetrievalEmbeddings(uniqueChunks.map((chunk) => chunk.content), embeddingConfig);
    await emit(options, "embedding", `Generated ${chunkEmbeddingResult.embeddings.length} chunk embeddings`, 75, false, documentId);

    const uniqueEntities = dedupeEntities(extractedData.entities);
    const newEntities = await getNewEntities(database, uniqueEntities);
    const generatedEntityEmbeddings =
      newEntities.length > 0
        ? (await generateGraphEmbeddings(
            newEntities.map((entity) => entity.name + (entity.description ? `: ${entity.description}` : "")),
            embeddingConfig
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

async function getNewEntities(
  database: IngestionDatabase,
  uniqueEntities: ExtractedEntity[]
): Promise<ExtractedEntity[]> {
  const newEntities: ExtractedEntity[] = [];

  for (const entity of uniqueEntities) {
    const existing = await database
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

function afterPersistDerivedDocumentData(
  context: DocumentIngestionServiceContext,
  documentId: string,
  droppedRelationshipCount: number
) {
  if (droppedRelationshipCount > 0) {
    metricsCollector.log(`[INGEST] Dropped ${droppedRelationshipCount} unresolved relationships for ${documentId}`);
  }

  revalidateDocument(context, documentId);
}

async function findExistingDriveDocument(
  database: IngestionDatabase,
  url: string
): Promise<{ id: string; processingStatus: string } | null> {
  const parsed = parseDriveUrl(url);
  if (parsed?.kind !== "file") return null;

  const [existing] = await database
    .select({ id: documents.id, processingStatus: documents.processingStatus })
    .from(documents)
    .where(eq(documents.url, parsed.canonicalUrl))
    .orderBy(asc(documents.createdAt), asc(documents.id))
    .limit(1);

  return existing ?? null;
}

function assertDriveDocumentAvailable(document: { processingStatus: string }) {
  if (document.processingStatus === "processing") {
    throw new Error("Drive File is already being processed. Try again when it finishes.");
  }
}

async function createOrFindUrlDocument(database: IngestionDatabase, source: SourceContent, runId: string) {
  const insert = async (tx: IngestionDatabase) => {
    const [document] = await tx.insert(documents).values({
      url: source.url,
      title: source.title,
      type: source.type,
      content: source.content,
      processingStatus: "processing",
      metadata: { ...getSourceMetadata(source), _ingestionRunId: runId },
    }).returning({ id: documents.id, processingStatus: documents.processingStatus });
    return { ...document, created: true };
  };
  const drive = source.url ? parseDriveUrl(source.url) : null;
  if (drive?.kind !== "file") return insert(database);

  return database.transaction(async (tx: IngestionDatabase) => {
    // Serialize only the identity claim, not the network or AI work.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${drive.canonicalUrl}))`);
    const existing = await findExistingDriveDocument(tx, drive.canonicalUrl);
    if (existing) return { ...existing, created: false };
    return insert(tx);
  });
}

async function getUrlSource(
  url: string,
  options: DocumentIngestionOptions
): Promise<SourceContent> {
  if (parseDriveUrl(url)?.kind === "file") {
    return resolveDriveFileSource(url, { runner: options.driveRunner });
  }

  const extracted = await extractFromUrl(url);
  if (!extracted) throw new Error("Failed to extract content from URL");

  return {
    title: extracted.title,
    content: extracted.content,
    type: extracted.type,
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

async function fetchLeadImage(source: SourceContent, runId: string): Promise<string | undefined> {
  if (!source.leadImageUrl) return;
  // Each run owns its image bytes; only its winning database write publishes the path.
  const image = await downloadDocumentImage(source.leadImageUrl, runId);
  if (!image) return;
  source.metadata = {
    ...source.metadata,
    leadImageUrl: image.url,
    imagePath: image.publicPath,
    imageContentType: image.contentType,
  };
  return image.publicPath;
}

function ownedRun(documentId: string, runId: string) {
  return and(eq(documents.id, documentId), sql`${documents.metadata}->>'_ingestionRunId' = ${runId}`);
}

async function markFailed(database: IngestionDatabase, documentId: string, runId: string, status = "failed") {
  await database
    .update(documents)
    .set({
      processingStatus: status,
      metadata: sql`${documents.metadata} - '_ingestionRunId'`,
      updatedAt: new Date(),
    })
    .where(ownedRun(documentId, runId));
}

async function complete(
  context: DocumentIngestionServiceContext,
  options: DocumentIngestionOptions,
  documentId: string,
  message: string,
  skipped: boolean
) {
  await emit(options, "complete", message, 100, false, documentId);
  revalidateDocument(context, documentId);
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
  await notify(options, { step, message, progress, error, documentId });
}

async function notify(options: DocumentIngestionOptions, event: DocumentIngestionEvent) {
  try {
    await options.onEvent?.(event);
  } catch {
    // Progress delivery cannot undo Document Persistence or stop a Folder Import.
    metricsCollector.log("[INGEST] Progress delivery failed; continuing ingestion");
  }
}

function revalidateDocument(
  context: DocumentIngestionServiceContext,
  documentId: string
) {
  context.revalidatePath("/library");
  context.revalidatePath(`/library/${documentId}`);
  context.revalidatePath("/graph");
}

function revalidateImportViews(context: DocumentIngestionServiceContext) {
  context.revalidatePath("/library");
  context.revalidatePath("/graph");
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
