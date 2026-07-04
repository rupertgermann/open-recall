import { and, eq, inArray } from "drizzle-orm";

import {
  chunks,
  documentTags,
  documents,
  entities,
  entityMentions,
  relationships,
  tags,
} from "../../db/schema.ts";
import { makeEntityKey, type EntityKey } from "./entity-key.ts";
import { planEntityMentions } from "./mentions.ts";
import { planRelationshipInserts } from "./relationships.ts";

type DocumentPersistenceDatabase = {
  transaction<T>(callback: (tx: any) => Promise<T>): Promise<T>;
};

type SourceContent = {
  title: string;
  content: string;
  type: "article" | "youtube" | "note" | "pdf" | "gdoc";
  url: string | null;
  metadata?: Record<string, unknown>;
};

type DerivedDocumentData = {
  contentHash: string;
  embeddingModel: string;
  chunks: {
    content: string;
    contentHash: string;
    index: number;
    tokenCount: number;
  }[];
  chunkEmbeddings: number[][];
  summary: string | null;
  tags: string[];
  entities: {
    name: string;
    type: string;
    description: string | null;
  }[];
  relationships: {
    source: string;
    target: string;
    type: string;
    description: string | null;
  }[];
  entityEmbeddingsByKey: ReadonlyMap<EntityKey, number[]>;
};

type PersistDerivedDocumentDataInput = {
  documentId: string;
  source: SourceContent;
  derived: DerivedDocumentData;
  replaceExisting: boolean;
};

type PersistDerivedDocumentDataResult = {
  droppedRelationshipCount: number;
};

type EntityIdRecord = {
  id: string;
  name: string;
  type: string;
};

export async function persistDerivedDocumentData(
  database: DocumentPersistenceDatabase,
  input: PersistDerivedDocumentDataInput
): Promise<PersistDerivedDocumentDataResult> {
  let droppedRelationshipCount = 0;

  await database.transaction(async (tx) => {
    const { documentId, source, derived } = input;

    if (input.replaceExisting) {
      await tx.delete(relationships).where(eq(relationships.sourceDocumentId, documentId));
      await tx.delete(entityMentions).where(eq(entityMentions.documentId, documentId));
      await tx.delete(documentTags).where(eq(documentTags.documentId, documentId));
      await tx.delete(chunks).where(eq(chunks.documentId, documentId));
    }

    await tx
      .update(documents)
      .set({
        url: source.url,
        title: source.title,
        type: source.type,
        content: source.content,
        contentHash: derived.contentHash,
        summary: derived.summary,
        embeddingModel: derived.embeddingModel,
        embeddingVersion: "1.0",
        processingStatus: "completed",
        ...(source.metadata ? { metadata: source.metadata } : {}),
        updatedAt: new Date(),
      })
      .where(eq(documents.id, documentId));

    const insertedChunks =
      derived.chunks.length > 0
        ? await tx
            .insert(chunks)
            .values(
              derived.chunks.map((chunk, index) => {
                const embedding = derived.chunkEmbeddings[index] ?? null;

                return {
                  documentId,
                  content: chunk.content,
                  contentHash: chunk.contentHash,
                  chunkIndex: chunk.index,
                  tokenCount: chunk.tokenCount,
                  embedding,
                  embeddingStatus: embedding ? "embedded" : "pending",
                  embeddingPurpose: "retrieval",
                };
              })
            )
            .returning({
              id: chunks.id,
              content: chunks.content,
            })
        : [];

    await saveDocumentTags(tx, documentId, derived.tags);
    const entityRecords = await saveEntities(tx, derived);

    const mentionRows = planEntityMentions({
      documentId,
      entities: entityRecords,
      chunks: insertedChunks,
    }).mentions.map((mention) => ({
      documentId,
      entityId: mention.entityId,
      chunkId: mention.chunkId,
      confidence: mention.confidence,
    }));

    if (mentionRows.length > 0) {
      await tx.insert(entityMentions).values(mentionRows);
    }

    const relationshipPlan = planRelationshipInserts({
      sourceDocumentId: documentId,
      entityIdMap: new Map(entityRecords.map((entity) => [makeEntityKey(entity), entity.id])),
      relationships: derived.relationships,
    });
    droppedRelationshipCount = relationshipPlan.dropped.length;

    if (relationshipPlan.values.length > 0) {
      await tx.insert(relationships).values(relationshipPlan.values);
    }
  });

  return { droppedRelationshipCount };
}

async function saveEntities(tx: any, derived: DerivedDocumentData): Promise<EntityIdRecord[]> {
  const records: EntityIdRecord[] = [];

  for (const entity of derived.entities) {
    const entityKey = makeEntityKey(entity);
    const [existing] = await tx
      .select({ id: entities.id, name: entities.name, type: entities.type })
      .from(entities)
      .where(and(eq(entities.name, entity.name), eq(entities.type, entity.type)))
      .limit(1);

    if (existing) {
      records.push(existing);
      continue;
    }

    const [inserted] = await tx
      .insert(entities)
      .values({
        name: entity.name,
        type: entity.type,
        description: entity.description,
        embedding: derived.entityEmbeddingsByKey.get(entityKey) ?? null,
      })
      .onConflictDoNothing({ target: [entities.name, entities.type] })
      .returning({ id: entities.id, name: entities.name, type: entities.type });

    if (inserted) {
      records.push(inserted);
      continue;
    }

    const [createdConcurrently] = await tx
      .select({ id: entities.id, name: entities.name, type: entities.type })
      .from(entities)
      .where(and(eq(entities.name, entity.name), eq(entities.type, entity.type)))
      .limit(1);

    if (createdConcurrently) {
      records.push(createdConcurrently);
    }
  }

  return records;
}

async function saveDocumentTags(tx: any, documentId: string, nextTags: string[]) {
  const normalized = Array.from(
    new Set(nextTags.map((tag) => tag.trim().toLowerCase()).filter((tag) => tag.length > 0))
  );

  if (normalized.length === 0) return;

  await tx.insert(tags).values(normalized.map((name) => ({ name }))).onConflictDoNothing();
  const tagRows = await tx
    .select({ id: tags.id, name: tags.name })
    .from(tags)
    .where(inArray(tags.name, normalized));

  if (tagRows.length > 0) {
    await tx
      .insert(documentTags)
      .values(tagRows.map((tag: { id: string }) => ({ documentId, tagId: tag.id })))
      .onConflictDoNothing();
  }
}
