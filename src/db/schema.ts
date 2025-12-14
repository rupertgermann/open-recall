import {
  pgTable,
  text,
  timestamp,
  uuid,
  integer,
  real,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

// Custom vector type for pgvector
import { customType } from "drizzle-orm/pg-core";

// We remove the fixed dimension constraint to allow switching between 
// different embedding models (e.g. 768 for nomic-embed-text, 1536 for OpenAI)
// Note: This means you need to ensure consistent model usage for existing data
// or re-generate embeddings when switching models.
const vector = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return `vector`; // No fixed dimension
  },
  toDriver(value: number[]): string {
    return `[${value.join(",")}]`;
  },
  fromDriver(value: string): number[] {
    return value
      .slice(1, -1)
      .split(",")
      .map((v) => parseFloat(v));
  },
});

// ============================================================================
// DOCUMENTS - Source content metadata
// ============================================================================
export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    url: text("url"),
    title: text("title").notNull(),
    type: text("type").notNull(), // 'article', 'youtube', 'pdf', 'note'
    content: text("content"), // Original raw content
    summary: text("summary"), // AI-generated summary
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
    processingStatus: text("processing_status").default("pending").notNull(), // 'pending', 'processing', 'completed', 'failed'
    metadata: jsonb("metadata"), // Flexible metadata storage
  },
  (table) => ({
    urlIdx: index("documents_url_idx").on(table.url),
    typeIdx: index("documents_type_idx").on(table.type),
    statusIdx: index("documents_status_idx").on(table.processingStatus),
  })
);

// ============================================================================
// CHUNKS - Text segments with embeddings
// ============================================================================
export const chunks = pgTable(
  "chunks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    content: text("content").notNull(),
    embedding: vector("embedding"),
    chunkIndex: integer("chunk_index").notNull(),
    tokenCount: integer("token_count"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    documentIdx: index("chunks_document_idx").on(table.documentId),
    chunkOrderIdx: index("chunks_order_idx").on(
      table.documentId,
      table.chunkIndex
    ),
  })
);

// ============================================================================
// ENTITIES - Knowledge graph nodes
// ============================================================================
export const entities = pgTable(
  "entities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    type: text("type").notNull(), // 'person', 'concept', 'technology', 'organization', 'location', etc.
    description: text("description"),
    embedding: vector("embedding"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    nameTypeIdx: uniqueIndex("entities_name_type_idx").on(
      table.name,
      table.type
    ),
    typeIdx: index("entities_type_idx").on(table.type),
  })
);

// ============================================================================
// ENTITY_MENTIONS - Links chunks to entities
// ============================================================================
export const entityMentions = pgTable(
  "entity_mentions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
    chunkId: uuid("chunk_id")
      .notNull()
      .references(() => chunks.id, { onDelete: "cascade" }),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    confidence: real("confidence").default(1.0),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    entityIdx: index("mentions_entity_idx").on(table.entityId),
    chunkIdx: index("mentions_chunk_idx").on(table.chunkId),
    documentIdx: index("mentions_document_idx").on(table.documentId),
  })
);

// ============================================================================
// RELATIONSHIPS - Knowledge graph edges
// ============================================================================
export const relationships = pgTable(
  "relationships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceEntityId: uuid("source_entity_id")
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
    targetEntityId: uuid("target_entity_id")
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
    relationType: text("relation_type").notNull(), // 'built_with', 'parent_of', 'related_to', etc.
    description: text("description"),
    weight: real("weight").default(1.0),
    sourceDocumentId: uuid("source_document_id").references(() => documents.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    sourceIdx: index("relationships_source_idx").on(table.sourceEntityId),
    targetIdx: index("relationships_target_idx").on(table.targetEntityId),
    relationTypeIdx: index("relationships_type_idx").on(table.relationType),
  })
);

// ============================================================================
// SRS_ITEMS - Spaced repetition flashcards
// ============================================================================
export const srsItems = pgTable(
  "srs_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    question: text("question").notNull(),
    answer: text("answer").notNull(),
    // FSRS parameters
    stability: real("stability").default(0),
    difficulty: real("difficulty").default(0),
    elapsedDays: integer("elapsed_days").default(0),
    scheduledDays: integer("scheduled_days").default(0),
    reps: integer("reps").default(0),
    lapses: integer("lapses").default(0),
    state: integer("state").default(0), // 0: New, 1: Learning, 2: Review, 3: Relearning
    dueDate: timestamp("due_date").defaultNow().notNull(),
    lastReviewDate: timestamp("last_review_date"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    documentIdx: index("srs_document_idx").on(table.documentId),
    dueIdx: index("srs_due_idx").on(table.dueDate),
    stateIdx: index("srs_state_idx").on(table.state),
  })
);

// ============================================================================
// SETTINGS - User preferences
// ============================================================================
export const settings = pgTable("settings", {
  id: uuid("id").primaryKey().defaultRandom(),
  key: text("key").notNull().unique(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ============================================================================
// RELATIONS
// ============================================================================
export const documentsRelations = relations(documents, ({ many }) => ({
  chunks: many(chunks),
  entityMentions: many(entityMentions),
  srsItems: many(srsItems),
}));

export const chunksRelations = relations(chunks, ({ one, many }) => ({
  document: one(documents, {
    fields: [chunks.documentId],
    references: [documents.id],
  }),
  entityMentions: many(entityMentions),
}));

export const entitiesRelations = relations(entities, ({ many }) => ({
  mentions: many(entityMentions),
  outgoingRelationships: many(relationships, { relationName: "source" }),
  incomingRelationships: many(relationships, { relationName: "target" }),
}));

export const entityMentionsRelations = relations(entityMentions, ({ one }) => ({
  entity: one(entities, {
    fields: [entityMentions.entityId],
    references: [entities.id],
  }),
  chunk: one(chunks, {
    fields: [entityMentions.chunkId],
    references: [chunks.id],
  }),
  document: one(documents, {
    fields: [entityMentions.documentId],
    references: [documents.id],
  }),
}));

export const relationshipsRelations = relations(relationships, ({ one }) => ({
  sourceEntity: one(entities, {
    fields: [relationships.sourceEntityId],
    references: [entities.id],
    relationName: "source",
  }),
  targetEntity: one(entities, {
    fields: [relationships.targetEntityId],
    references: [entities.id],
    relationName: "target",
  }),
  sourceDocument: one(documents, {
    fields: [relationships.sourceDocumentId],
    references: [documents.id],
  }),
}));

export const srsItemsRelations = relations(srsItems, ({ one }) => ({
  document: one(documents, {
    fields: [srsItems.documentId],
    references: [documents.id],
  }),
}));

// ============================================================================
// TYPE EXPORTS
// ============================================================================
export type Document = typeof documents.$inferSelect;
export type NewDocument = typeof documents.$inferInsert;
export type Chunk = typeof chunks.$inferSelect;
export type NewChunk = typeof chunks.$inferInsert;
export type Entity = typeof entities.$inferSelect;
export type NewEntity = typeof entities.$inferInsert;
export type EntityMention = typeof entityMentions.$inferSelect;
export type NewEntityMention = typeof entityMentions.$inferInsert;
export type Relationship = typeof relationships.$inferSelect;
export type NewRelationship = typeof relationships.$inferInsert;
export type SrsItem = typeof srsItems.$inferSelect;
export type NewSrsItem = typeof srsItems.$inferInsert;
export type Setting = typeof settings.$inferSelect;
export type NewSetting = typeof settings.$inferInsert;
