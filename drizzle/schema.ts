import { pgTable, index, foreignKey, uuid, real, timestamp, uniqueIndex, text, vector, jsonb, unique, integer } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"



export const entityMentions = pgTable("entity_mentions", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	entityId: uuid("entity_id").notNull(),
	chunkId: uuid("chunk_id").notNull(),
	documentId: uuid("document_id").notNull(),
	confidence: real().default(1),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => {
	return {
		mentionsChunkIdx: index("mentions_chunk_idx").using("btree", table.chunkId.asc().nullsLast().op("uuid_ops")),
		mentionsDocumentIdx: index("mentions_document_idx").using("btree", table.documentId.asc().nullsLast().op("uuid_ops")),
		mentionsEntityIdx: index("mentions_entity_idx").using("btree", table.entityId.asc().nullsLast().op("uuid_ops")),
		entityMentionsEntityIdEntitiesIdFk: foreignKey({
			columns: [table.entityId],
			foreignColumns: [entities.id],
			name: "entity_mentions_entity_id_entities_id_fk"
		}).onDelete("cascade"),
		entityMentionsChunkIdChunksIdFk: foreignKey({
			columns: [table.chunkId],
			foreignColumns: [chunks.id],
			name: "entity_mentions_chunk_id_chunks_id_fk"
		}).onDelete("cascade"),
		entityMentionsDocumentIdDocumentsIdFk: foreignKey({
			columns: [table.documentId],
			foreignColumns: [documents.id],
			name: "entity_mentions_document_id_documents_id_fk"
		}).onDelete("cascade"),
	}
});

export const entities = pgTable("entities", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	name: text().notNull(),
	type: text().notNull(),
	description: text(),
	embedding: vector({ dimensions: 1536 }),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => {
	return {
		nameTypeIdx: uniqueIndex("entities_name_type_idx").using("btree", table.name.asc().nullsLast().op("text_ops"), table.type.asc().nullsLast().op("text_ops")),
		typeIdx: index("entities_type_idx").using("btree", table.type.asc().nullsLast().op("text_ops")),
	}
});

export const relationships = pgTable("relationships", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	sourceEntityId: uuid("source_entity_id").notNull(),
	targetEntityId: uuid("target_entity_id").notNull(),
	relationType: text("relation_type").notNull(),
	description: text(),
	weight: real().default(1),
	sourceDocumentId: uuid("source_document_id"),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => {
	return {
		sourceIdx: index("relationships_source_idx").using("btree", table.sourceEntityId.asc().nullsLast().op("uuid_ops")),
		targetIdx: index("relationships_target_idx").using("btree", table.targetEntityId.asc().nullsLast().op("uuid_ops")),
		typeIdx: index("relationships_type_idx").using("btree", table.relationType.asc().nullsLast().op("text_ops")),
		relationshipsSourceEntityIdEntitiesIdFk: foreignKey({
			columns: [table.sourceEntityId],
			foreignColumns: [entities.id],
			name: "relationships_source_entity_id_entities_id_fk"
		}).onDelete("cascade"),
		relationshipsTargetEntityIdEntitiesIdFk: foreignKey({
			columns: [table.targetEntityId],
			foreignColumns: [entities.id],
			name: "relationships_target_entity_id_entities_id_fk"
		}).onDelete("cascade"),
		relationshipsSourceDocumentIdDocumentsIdFk: foreignKey({
			columns: [table.sourceDocumentId],
			foreignColumns: [documents.id],
			name: "relationships_source_document_id_documents_id_fk"
		}).onDelete("cascade"),
	}
});

export const documents = pgTable("documents", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	url: text(),
	title: text().notNull(),
	type: text().notNull(),
	content: text(),
	summary: text(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
	processingStatus: text("processing_status").default('pending').notNull(),
	metadata: jsonb(),
	contentHash: text("content_hash"),
	embeddingModel: text("embedding_model"),
	embeddingVersion: text("embedding_version"),
}, (table) => {
	return {
		contentHashIdx: index("documents_content_hash_idx").using("btree", table.contentHash.asc().nullsLast().op("text_ops")),
		statusIdx: index("documents_status_idx").using("btree", table.processingStatus.asc().nullsLast().op("text_ops")),
		typeIdx: index("documents_type_idx").using("btree", table.type.asc().nullsLast().op("text_ops")),
		urlIdx: index("documents_url_idx").using("btree", table.url.asc().nullsLast().op("text_ops")),
	}
});

export const settings = pgTable("settings", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	key: text().notNull(),
	value: jsonb().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => {
	return {
		settingsKeyUnique: unique("settings_key_unique").on(table.key),
	}
});

export const srsItems = pgTable("srs_items", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	documentId: uuid("document_id").notNull(),
	question: text().notNull(),
	answer: text().notNull(),
	stability: real().default(0),
	difficulty: real().default(0),
	elapsedDays: integer("elapsed_days").default(0),
	scheduledDays: integer("scheduled_days").default(0),
	reps: integer().default(0),
	lapses: integer().default(0),
	state: integer().default(0),
	dueDate: timestamp("due_date", { mode: 'string' }).defaultNow().notNull(),
	lastReviewDate: timestamp("last_review_date", { mode: 'string' }),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => {
	return {
		srsDocumentIdx: index("srs_document_idx").using("btree", table.documentId.asc().nullsLast().op("uuid_ops")),
		srsDueIdx: index("srs_due_idx").using("btree", table.dueDate.asc().nullsLast().op("timestamp_ops")),
		srsStateIdx: index("srs_state_idx").using("btree", table.state.asc().nullsLast().op("int4_ops")),
		srsItemsDocumentIdDocumentsIdFk: foreignKey({
			columns: [table.documentId],
			foreignColumns: [documents.id],
			name: "srs_items_document_id_documents_id_fk"
		}).onDelete("cascade"),
	}
});

export const chatThreads = pgTable("chat_threads", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	title: text().default('New chat').notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
	lastMessageAt: timestamp("last_message_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => {
	return {
		lastMessageIdx: index("chat_threads_last_message_idx").using("btree", table.lastMessageAt.asc().nullsLast().op("timestamp_ops")),
	}
});

export const chatMessages = pgTable("chat_messages", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	threadId: uuid("thread_id").notNull(),
	role: text().notNull(),
	content: text().notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	metadata: jsonb(),
}, (table) => {
	return {
		createdAtIdx: index("chat_messages_created_at_idx").using("btree", table.createdAt.asc().nullsLast().op("timestamp_ops")),
		threadIdx: index("chat_messages_thread_idx").using("btree", table.threadId.asc().nullsLast().op("uuid_ops")),
		chatMessagesThreadIdChatThreadsIdFk: foreignKey({
			columns: [table.threadId],
			foreignColumns: [chatThreads.id],
			name: "chat_messages_thread_id_chat_threads_id_fk"
		}).onDelete("cascade"),
	}
});

export const chunks = pgTable("chunks", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	documentId: uuid("document_id").notNull(),
	content: text().notNull(),
	embedding: vector({ dimensions: 1536 }),
	chunkIndex: integer("chunk_index").notNull(),
	tokenCount: integer("token_count"),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	contentHash: text("content_hash"),
	embeddingCacheId: uuid("embedding_cache_id"),
	embeddingStatus: text("embedding_status").default('pending').notNull(),
	embeddingPurpose: text("embedding_purpose").default('retrieval'),
}, (table) => {
	return {
		contentHashIdx: uniqueIndex("chunks_content_hash_idx").using("btree", table.contentHash.asc().nullsLast().op("text_ops")),
		documentIdx: index("chunks_document_idx").using("btree", table.documentId.asc().nullsLast().op("uuid_ops")),
		embeddingStatusIdx: index("chunks_embedding_status_idx").using("btree", table.embeddingStatus.asc().nullsLast().op("text_ops")),
		orderIdx: index("chunks_order_idx").using("btree", table.documentId.asc().nullsLast().op("uuid_ops"), table.chunkIndex.asc().nullsLast().op("uuid_ops")),
		chunksDocumentIdDocumentsIdFk: foreignKey({
			columns: [table.documentId],
			foreignColumns: [documents.id],
			name: "chunks_document_id_documents_id_fk"
		}).onDelete("cascade"),
		chunksEmbeddingCacheIdEmbeddingCacheIdFk: foreignKey({
			columns: [table.embeddingCacheId],
			foreignColumns: [embeddingCache.id],
			name: "chunks_embedding_cache_id_embedding_cache_id_fk"
		}),
	}
});

export const embeddingCache = pgTable("embedding_cache", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	contentHash: text("content_hash").notNull(),
	model: text().notNull(),
	embedding: vector({ dimensions: 1536 }).notNull(),
	purpose: text().default('retrieval').notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => {
	return {
		hashModelPurposeIdx: uniqueIndex("embedding_cache_hash_model_purpose_idx").using("btree", table.contentHash.asc().nullsLast().op("text_ops"), table.model.asc().nullsLast().op("text_ops"), table.purpose.asc().nullsLast().op("text_ops")),
		modelIdx: index("embedding_cache_model_idx").using("btree", table.model.asc().nullsLast().op("text_ops")),
		purposeIdx: index("embedding_cache_purpose_idx").using("btree", table.purpose.asc().nullsLast().op("text_ops")),
	}
});
