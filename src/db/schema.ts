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
  primaryKey,
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
// EMBEDDING_CACHE - Central embedding cache (Phase 3)
// Must be defined before chunks table due to foreign key reference
// ============================================================================
export const embeddingCache = pgTable(
  "embedding_cache",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contentHash: text("content_hash").notNull(),
    model: text("model").notNull(),
    embedding: vector("embedding").notNull(),
    purpose: text("purpose").notNull().default("retrieval"), // 'graph' | 'retrieval'
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    contentHashModelPurposeIdx: uniqueIndex("embedding_cache_hash_model_purpose_idx").on(
      table.contentHash,
      table.model,
      table.purpose
    ),
    modelIdx: index("embedding_cache_model_idx").on(table.model),
    purposeIdx: index("embedding_cache_purpose_idx").on(table.purpose),
  })
);

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
    contentHash: text("content_hash"), // Phase 8: SHA-256 hash for change detection
    summary: text("summary"), // AI-generated summary
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
    processingStatus: text("processing_status").default("pending").notNull(), // 'pending', 'processing', 'completed', 'failed'
    embeddingModel: text("embedding_model"), // Phase 8: Track which model was used
    embeddingVersion: text("embedding_version"), // Phase 8: Track embedding version
    metadata: jsonb("metadata"), // Flexible metadata storage
  },
  (table) => ({
    urlIdx: index("documents_url_idx").on(table.url),
    typeIdx: index("documents_type_idx").on(table.type),
    statusIdx: index("documents_status_idx").on(table.processingStatus),
    contentHashIdx: index("documents_content_hash_idx").on(table.contentHash),
  })
);

export const tags = pgTable(
  "tags",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    nameIdx: uniqueIndex("tags_name_idx").on(table.name),
  })
);

export const documentTags = pgTable(
  "document_tags",
  {
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.documentId, table.tagId] }),
    documentIdx: index("document_tags_document_idx").on(table.documentId),
    tagIdx: index("document_tags_tag_idx").on(table.tagId),
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
    contentHash: text("content_hash"), // Phase 2: SHA-256 hash for deduplication
    embedding: vector("embedding"),
    embeddingCacheId: uuid("embedding_cache_id").references(() => embeddingCache.id), // Phase 3: Reference to cached embedding
    chunkIndex: integer("chunk_index").notNull(),
    tokenCount: integer("token_count"),
    embeddingStatus: text("embedding_status").default("pending").notNull(), // Phase 7: 'pending' | 'embedded'
    embeddingPurpose: text("embedding_purpose").default("retrieval"), // Phase 4: 'graph' | 'retrieval'
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    documentIdx: index("chunks_document_idx").on(table.documentId),
    chunkOrderIdx: index("chunks_order_idx").on(
      table.documentId,
      table.chunkIndex
    ),
    contentHashIdx: uniqueIndex("chunks_content_hash_idx").on(table.contentHash),
    embeddingStatusIdx: index("chunks_embedding_status_idx").on(table.embeddingStatus),
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
// COLLECTIONS - Document groupings / libraries
// ============================================================================
export const collections = pgTable(
  "collections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    description: text("description"),
    color: text("color").default("#6366f1"), // Tailwind indigo-500 default
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    nameIdx: uniqueIndex("collections_name_idx").on(table.name),
  })
);

export const documentCollections = pgTable(
  "document_collections",
  {
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    collectionId: uuid("collection_id")
      .notNull()
      .references(() => collections.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.documentId, table.collectionId] }),
    documentIdx: index("document_collections_document_idx").on(table.documentId),
    collectionIdx: index("document_collections_collection_idx").on(table.collectionId),
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
// CHAT_THREADS - Persistent chat sessions
// ============================================================================
export const chatThreads = pgTable(
  "chat_threads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull().default("New chat"),
    category: text("category").notNull().default("general"), // 'general', 'entity', 'document'
    entityId: uuid("entity_id").references(() => entities.id, { onDelete: "set null" }),
    documentId: uuid("document_id").references(() => documents.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
    lastMessageAt: timestamp("last_message_at").defaultNow().notNull(),
  },
  (table) => ({
    lastMessageIdx: index("chat_threads_last_message_idx").on(table.lastMessageAt),
    entityIdx: index("chat_threads_entity_idx").on(table.entityId),
    documentIdx: index("chat_threads_document_idx").on(table.documentId),
    categoryIdx: index("chat_threads_category_idx").on(table.category),
  })
);

// ============================================================================
// CHAT_MESSAGES - Persistent chat messages
// ============================================================================
export const chatMessages = pgTable(
  "chat_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => chatThreads.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    content: text("content").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    metadata: jsonb("metadata"),
  },
  (table) => ({
    threadIdx: index("chat_messages_thread_idx").on(table.threadId),
    createdAtIdx: index("chat_messages_created_at_idx").on(table.createdAt),
  })
);

// ============================================================================
// RELATIONS
// ============================================================================
export const documentsRelations = relations(documents, ({ many }) => ({
  chunks: many(chunks),
  entityMentions: many(entityMentions),
  srsItems: many(srsItems),
  documentTags: many(documentTags),
  documentCollections: many(documentCollections),
}));

export const tagsRelations = relations(tags, ({ many }) => ({
  documentTags: many(documentTags),
}));

export const documentTagsRelations = relations(documentTags, ({ one }) => ({
  document: one(documents, {
    fields: [documentTags.documentId],
    references: [documents.id],
  }),
  tag: one(tags, {
    fields: [documentTags.tagId],
    references: [tags.id],
  }),
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

export const collectionsRelations = relations(collections, ({ many }) => ({
  documentCollections: many(documentCollections),
}));

export const documentCollectionsRelations = relations(documentCollections, ({ one }) => ({
  document: one(documents, {
    fields: [documentCollections.documentId],
    references: [documents.id],
  }),
  collection: one(collections, {
    fields: [documentCollections.collectionId],
    references: [collections.id],
  }),
}));

export const chatThreadsRelations = relations(chatThreads, ({ many, one }) => ({
  messages: many(chatMessages),
  entity: one(entities, {
    fields: [chatThreads.entityId],
    references: [entities.id],
  }),
  document: one(documents, {
    fields: [chatThreads.documentId],
    references: [documents.id],
  }),
}));

export const chatMessagesRelations = relations(chatMessages, ({ one }) => ({
  thread: one(chatThreads, {
    fields: [chatMessages.threadId],
    references: [chatThreads.id],
  }),
}));

// ============================================================================
// TYPE EXPORTS
// ============================================================================
export type Document = typeof documents.$inferSelect;
export type NewDocument = typeof documents.$inferInsert;
export type Tag = typeof tags.$inferSelect;
export type NewTag = typeof tags.$inferInsert;
export type DocumentTag = typeof documentTags.$inferSelect;
export type NewDocumentTag = typeof documentTags.$inferInsert;
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

export type ChatThread = typeof chatThreads.$inferSelect;
export type NewChatThread = typeof chatThreads.$inferInsert;
export type ChatMessage = typeof chatMessages.$inferSelect;
export type NewChatMessage = typeof chatMessages.$inferInsert;

export type EmbeddingCache = typeof embeddingCache.$inferSelect;
export type NewEmbeddingCache = typeof embeddingCache.$inferInsert;

export type Collection = typeof collections.$inferSelect;
export type NewCollection = typeof collections.$inferInsert;
export type DocumentCollection = typeof documentCollections.$inferSelect;
export type NewDocumentCollection = typeof documentCollections.$inferInsert;
