import { relations } from "drizzle-orm/relations";
import { entities, entityMentions, chunks, documents, relationships, srsItems, chatThreads, chatMessages, embeddingCache } from "./schema";

export const entityMentionsRelations = relations(entityMentions, ({one}) => ({
	entity: one(entities, {
		fields: [entityMentions.entityId],
		references: [entities.id]
	}),
	chunk: one(chunks, {
		fields: [entityMentions.chunkId],
		references: [chunks.id]
	}),
	document: one(documents, {
		fields: [entityMentions.documentId],
		references: [documents.id]
	}),
}));

export const entitiesRelations = relations(entities, ({many}) => ({
	entityMentions: many(entityMentions),
	relationships_sourceEntityId: many(relationships, {
		relationName: "relationships_sourceEntityId_entities_id"
	}),
	relationships_targetEntityId: many(relationships, {
		relationName: "relationships_targetEntityId_entities_id"
	}),
}));

export const chunksRelations = relations(chunks, ({one, many}) => ({
	entityMentions: many(entityMentions),
	document: one(documents, {
		fields: [chunks.documentId],
		references: [documents.id]
	}),
	embeddingCache: one(embeddingCache, {
		fields: [chunks.embeddingCacheId],
		references: [embeddingCache.id]
	}),
}));

export const documentsRelations = relations(documents, ({many}) => ({
	entityMentions: many(entityMentions),
	relationships: many(relationships),
	srsItems: many(srsItems),
	chunks: many(chunks),
}));

export const relationshipsRelations = relations(relationships, ({one}) => ({
	entity_sourceEntityId: one(entities, {
		fields: [relationships.sourceEntityId],
		references: [entities.id],
		relationName: "relationships_sourceEntityId_entities_id"
	}),
	entity_targetEntityId: one(entities, {
		fields: [relationships.targetEntityId],
		references: [entities.id],
		relationName: "relationships_targetEntityId_entities_id"
	}),
	document: one(documents, {
		fields: [relationships.sourceDocumentId],
		references: [documents.id]
	}),
}));

export const srsItemsRelations = relations(srsItems, ({one}) => ({
	document: one(documents, {
		fields: [srsItems.documentId],
		references: [documents.id]
	}),
}));

export const chatMessagesRelations = relations(chatMessages, ({one}) => ({
	chatThread: one(chatThreads, {
		fields: [chatMessages.threadId],
		references: [chatThreads.id]
	}),
}));

export const chatThreadsRelations = relations(chatThreads, ({many}) => ({
	chatMessages: many(chatMessages),
}));

export const embeddingCacheRelations = relations(embeddingCache, ({many}) => ({
	chunks: many(chunks),
}));