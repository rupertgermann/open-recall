import assert from "node:assert/strict";
import test from "node:test";

import { eq, sql } from "drizzle-orm";

import {
  chunks,
  documentTags,
  documents,
  entities,
  entityMentions,
  relationships,
  tags,
} from "../src/db/schema.ts";
import { makeEntityKey } from "../src/lib/ingestion/entity-key.ts";
import { persistDerivedDocumentData } from "../src/lib/ingestion/persistence.ts";
import { createTestDatabase, type TestDatabase } from "./helpers/db.ts";

test("persistDerivedDocumentData writes a fresh Document's Derived Document Data", async (t) => {
  const { db, close } = await createTestDatabase();
  t.after(close);

  const document = await createDocument({ db });
  const result = await persistDerivedDocumentData(db, {
    documentId: document.id,
    source: noteSource({
      title: "React and Postgres",
      content: "React uses Postgres for this note.",
    }),
    derived: derivedData(),
    replaceExisting: false,
  });

  assert.equal(result.droppedRelationshipCount, 0);

  const [savedDocument] = await db
    .select({
      title: documents.title,
      content: documents.content,
      contentHash: documents.contentHash,
      summary: documents.summary,
      processingStatus: documents.processingStatus,
      embeddingModel: documents.embeddingModel,
      embeddingVersion: documents.embeddingVersion,
    })
    .from(documents)
    .where(eq(documents.id, document.id));
  assert.deepEqual(savedDocument, {
    title: "React and Postgres",
    content: "React uses Postgres for this note.",
    contentHash: "hash-react-postgres",
    summary: "React works with Postgres.",
    processingStatus: "completed",
    embeddingModel: "test-embedding-model",
    embeddingVersion: "1.0",
  });

  const chunkRows = await db
    .select({
      content: chunks.content,
      chunkIndex: chunks.chunkIndex,
      embedding: chunks.embedding,
      embeddingStatus: chunks.embeddingStatus,
    })
    .from(chunks)
    .where(eq(chunks.documentId, document.id));
  assert.deepEqual(sortBy(chunkRows, "chunkIndex"), [
    {
      content: "React uses Postgres.",
      chunkIndex: 0,
      embedding: [0.1, 0.2, 0.3],
      embeddingStatus: "embedded",
    },
    {
      content: "Postgres stores data for React apps.",
      chunkIndex: 1,
      embedding: [0.4, 0.5, 0.6],
      embeddingStatus: "embedded",
    },
  ]);

  assert.deepEqual(await documentTagNames({ db }, document.id), ["database", "react"]);

  const entityRows = await db
    .select({ name: entities.name, type: entities.type, embedding: entities.embedding })
    .from(entities);
  assert.deepEqual(sortBy(entityRows, "name"), [
    { name: "Postgres", type: "database", embedding: [0.8, 0.9] },
    { name: "React", type: "technology", embedding: [0.6, 0.7] },
  ]);

  const mentionRows = await db.select().from(entityMentions).where(eq(entityMentions.documentId, document.id));
  assert.equal(mentionRows.length, 4);

  const relationshipRows = await db
    .select({ relationType: relationships.relationType, description: relationships.description })
    .from(relationships)
    .where(eq(relationships.sourceDocumentId, document.id));
  assert.deepEqual(relationshipRows, [
    { relationType: "uses", description: "React uses Postgres." },
  ]);
});

test("persistDerivedDocumentData replacement removes prior Document-derived rows", async (t) => {
  const { db, close } = await createTestDatabase();
  t.after(close);

  const document = await createDocument({ db });
  await persistDerivedDocumentData(db, {
    documentId: document.id,
    source: noteSource({
      title: "React and Postgres",
      content: "React uses Postgres for this note.",
    }),
    derived: derivedData(),
    replaceExisting: false,
  });

  await persistDerivedDocumentData(db, {
    documentId: document.id,
    source: noteSource({
      title: "Next.js refresh",
      content: "Next.js replaced the prior Derived Document Data.",
    }),
    derived: derivedData({
      contentHash: "hash-next",
      chunks: [
        {
          content: "Next.js replaced the prior Derived Document Data.",
          contentHash: "chunk-next",
          index: 0,
          tokenCount: 8,
        },
      ],
      chunkEmbeddings: [[0.7, 0.8, 0.9]],
      summary: "Next.js replaced the previous graph.",
      tags: ["Next"],
      entities: [{ name: "Next.js", type: "technology", description: "A React framework." }],
      relationships: [],
      entityEmbeddingsByKey: entityEmbeddingsByKey([
        [{ name: "Next.js", type: "technology" }, [0.2, 0.3]],
      ]),
    }),
    replaceExisting: true,
  });

  const chunkRows = await db
    .select({ content: chunks.content })
    .from(chunks)
    .where(eq(chunks.documentId, document.id));
  assert.deepEqual(chunkRows, [
    { content: "Next.js replaced the prior Derived Document Data." },
  ]);
  assert.deepEqual(await documentTagNames({ db }, document.id), ["next"]);

  const mentionRows = await db.select().from(entityMentions).where(eq(entityMentions.documentId, document.id));
  assert.equal(mentionRows.length, 1);

  const relationshipRows = await db
    .select()
    .from(relationships)
    .where(eq(relationships.sourceDocumentId, document.id));
  assert.deepEqual(relationshipRows, []);
});

test("persistDerivedDocumentData reuses existing Entity name-type matches", async (t) => {
  const { db, close } = await createTestDatabase();
  t.after(close);

  const document = await createDocument({ db });
  const [existingEntity] = await db
    .insert(entities)
    .values({
      name: "React",
      type: "technology",
      description: "Existing graph Entity.",
      embedding: [0.4, 0.4],
    })
    .returning({ id: entities.id });

  await persistDerivedDocumentData(db, {
    documentId: document.id,
    source: noteSource({
      title: "Existing React",
      content: "React is already in the graph.",
    }),
    derived: derivedData({
      chunks: [
        {
          content: "React is already in the graph.",
          contentHash: "chunk-existing-react",
          index: 0,
          tokenCount: 7,
        },
      ],
      chunkEmbeddings: [[0.1, 0.1, 0.1]],
      tags: [],
      entities: [{ name: "React", type: "technology", description: "New extraction description." }],
      relationships: [],
      entityEmbeddingsByKey: entityEmbeddingsByKey([
        [{ name: "React", type: "technology" }, [0.9, 0.9]],
      ]),
    }),
    replaceExisting: false,
  });

  const reactEntities = await db
    .select({ id: entities.id, description: entities.description, embedding: entities.embedding })
    .from(entities)
    .where(eq(entities.name, "React"));
  assert.deepEqual(reactEntities, [
    { id: existingEntity.id, description: "Existing graph Entity.", embedding: [0.4, 0.4] },
  ]);

  const mentionRows = await db
    .select({ entityId: entityMentions.entityId })
    .from(entityMentions)
    .where(eq(entityMentions.documentId, document.id));
  assert.deepEqual(mentionRows, [{ entityId: existingEntity.id }]);
});

test("persistDerivedDocumentData drops and counts unresolvable Relationships", async (t) => {
  const { db, close } = await createTestDatabase();
  t.after(close);

  const document = await createDocument({ db });
  const result = await persistDerivedDocumentData(db, {
    documentId: document.id,
    source: noteSource({
      title: "Relationship drops",
      content: "React uses Postgres.",
    }),
    derived: derivedData({
      relationships: [
        { source: "React", target: "Postgres", type: "uses", description: "Valid relationship." },
        { source: "SQLite", target: "Postgres", type: "uses", description: null },
        { source: "React", target: "Missing", type: "mentions", description: null },
      ],
    }),
    replaceExisting: false,
  });

  assert.equal(result.droppedRelationshipCount, 2);

  const relationshipRows = await db
    .select({ relationType: relationships.relationType, description: relationships.description })
    .from(relationships)
    .where(eq(relationships.sourceDocumentId, document.id));
  assert.deepEqual(relationshipRows, [
    { relationType: "uses", description: "Valid relationship." },
  ]);
});

test("persistDerivedDocumentData rolls back prior writes when a mid-save failure occurs", async (t) => {
  const { db, close } = await createTestDatabase();
  t.after(close);

  await db.execute(sql`
    ALTER TABLE relationships
    ADD CONSTRAINT relationships_test_failure CHECK (relation_type <> 'boom')
  `);

  const document = await createDocument({ db });

  await assert.rejects(
    persistDerivedDocumentData(db, {
      documentId: document.id,
      source: noteSource({
        title: "Should roll back",
        content: "React uses Postgres.",
      }),
      derived: derivedData({
        relationships: [
          { source: "React", target: "Postgres", type: "boom", description: "Forces a late failure." },
        ],
      }),
      replaceExisting: false,
    })
  );

  const [savedDocument] = await db
    .select({
      title: documents.title,
      contentHash: documents.contentHash,
      processingStatus: documents.processingStatus,
    })
    .from(documents)
    .where(eq(documents.id, document.id));
  assert.deepEqual(savedDocument, {
    title: "Pending Document",
    contentHash: null,
    processingStatus: "processing",
  });

  assert.deepEqual(await db.select().from(chunks).where(eq(chunks.documentId, document.id)), []);
  assert.deepEqual(await db.select().from(documentTags).where(eq(documentTags.documentId, document.id)), []);
  assert.deepEqual(await db.select().from(entityMentions).where(eq(entityMentions.documentId, document.id)), []);
  assert.deepEqual(await db.select().from(relationships).where(eq(relationships.sourceDocumentId, document.id)), []);
  assert.deepEqual(await db.select().from(tags), []);
  assert.deepEqual(await db.select().from(entities), []);
});

test("persistDerivedDocumentData attaches Entity embeddings by Entity Key for mixed Entity state", async (t) => {
  const { db, close } = await createTestDatabase();
  t.after(close);

  const document = await createDocument({ db });
  await db.insert(entities).values([
    { name: "Alpha", type: "technology", description: "Existing Alpha.", embedding: [0.1, 0.1] },
    { name: "Gamma", type: "database", description: "Existing Gamma.", embedding: [0.3, 0.3] },
  ]);

  await persistDerivedDocumentData(db, {
    documentId: document.id,
    source: noteSource({
      title: "Mixed Entity embeddings",
      content: "Alpha, Beta, Gamma, and Delta are mentioned together.",
    }),
    derived: derivedData({
      chunks: [
        {
          content: "Alpha, Beta, Gamma, and Delta are mentioned together.",
          contentHash: "chunk-mixed-entities",
          index: 0,
          tokenCount: 8,
        },
      ],
      chunkEmbeddings: [[0.5, 0.5, 0.5]],
      tags: [],
      entities: [
        { name: "Alpha", type: "technology", description: "New Alpha description." },
        { name: "Beta", type: "technology", description: "New Beta description." },
        { name: "Gamma", type: "database", description: "New Gamma description." },
        { name: "Delta", type: "database", description: "New Delta description." },
      ],
      relationships: [],
      entityEmbeddingsByKey: entityEmbeddingsByKey([
        [{ name: "Delta", type: "database" }, [0.4, 0.4]],
        [{ name: "Beta", type: "technology" }, [0.2, 0.2]],
      ]),
    }),
    replaceExisting: false,
  });

  const entityRows = await db
    .select({ name: entities.name, type: entities.type, embedding: entities.embedding })
    .from(entities);

  assert.deepEqual(sortBy(entityRows, "name"), [
    { name: "Alpha", type: "technology", embedding: [0.1, 0.1] },
    { name: "Beta", type: "technology", embedding: [0.2, 0.2] },
    { name: "Delta", type: "database", embedding: [0.4, 0.4] },
    { name: "Gamma", type: "database", embedding: [0.3, 0.3] },
  ]);
});

test("persistDerivedDocumentData keeps keyed embeddings aligned after concurrent Entity insert fallback", async (t) => {
  const { db, close } = await createTestDatabase();
  t.after(close);

  const document = await createDocument({ db });
  const database = withConcurrentEntityInsert(db, {
    name: "Race",
    type: "technology",
    description: "Inserted by a concurrent persist.",
    embedding: [0.7, 0.7],
  });

  await persistDerivedDocumentData(database, {
    documentId: document.id,
    source: noteSource({
      title: "Concurrent fallback",
      content: "Race and Later are both mentioned.",
    }),
    derived: derivedData({
      chunks: [
        {
          content: "Race and Later are both mentioned.",
          contentHash: "chunk-concurrent-entities",
          index: 0,
          tokenCount: 7,
        },
      ],
      chunkEmbeddings: [[0.6, 0.6, 0.6]],
      tags: [],
      entities: [
        { name: "Race", type: "technology", description: "Derived Race." },
        { name: "Later", type: "technology", description: "Derived Later." },
      ],
      relationships: [],
      entityEmbeddingsByKey: entityEmbeddingsByKey([
        [{ name: "Race", type: "technology" }, [0.9, 0.9]],
        [{ name: "Later", type: "technology" }, [0.8, 0.8]],
      ]),
    }),
    replaceExisting: false,
  });

  const entityRows = await db
    .select({
      name: entities.name,
      description: entities.description,
      embedding: entities.embedding,
    })
    .from(entities);

  assert.deepEqual(sortBy(entityRows, "name"), [
    { name: "Later", description: "Derived Later.", embedding: [0.8, 0.8] },
    { name: "Race", description: "Inserted by a concurrent persist.", embedding: [0.7, 0.7] },
  ]);
});

async function createDocument({ db }: Pick<TestDatabase, "db">) {
  const [document] = await db
    .insert(documents)
    .values({
      title: "Pending Document",
      type: "note",
      content: "Original content",
      processingStatus: "processing",
    })
    .returning({ id: documents.id });

  return document;
}

function noteSource(input: { title: string; content: string }) {
  return {
    title: input.title,
    content: input.content,
    type: "note" as const,
    url: null,
  };
}

function derivedData(overrides: Record<string, unknown> = {}) {
  const base = {
    contentHash: "hash-react-postgres",
    embeddingModel: "test-embedding-model",
    chunks: [
      {
        content: "React uses Postgres.",
        contentHash: "chunk-react-postgres-1",
        index: 0,
        tokenCount: 3,
      },
      {
        content: "Postgres stores data for React apps.",
        contentHash: "chunk-react-postgres-2",
        index: 1,
        tokenCount: 6,
      },
    ],
    chunkEmbeddings: [
      [0.1, 0.2, 0.3],
      [0.4, 0.5, 0.6],
    ],
    summary: "React works with Postgres.",
    tags: ["React", "Database"],
    entities: [
      { name: "React", type: "technology", description: "A UI library." },
      { name: "Postgres", type: "database", description: "A relational database." },
    ],
    relationships: [
      { source: "React", target: "Postgres", type: "uses", description: "React uses Postgres." },
    ],
    entityEmbeddingsByKey: entityEmbeddingsByKey([
      [{ name: "React", type: "technology" }, [0.6, 0.7]],
      [{ name: "Postgres", type: "database" }, [0.8, 0.9]],
    ]),
  };

  return { ...base, ...overrides };
}

function entityEmbeddingsByKey(
  entries: Array<[{ name: string; type: string }, number[]]>
): ReadonlyMap<ReturnType<typeof makeEntityKey>, number[]> {
  return new Map(entries.map(([entity, embedding]) => [makeEntityKey(entity), embedding]));
}

function withConcurrentEntityInsert(
  db: TestDatabase["db"],
  entity: { name: string; type: string; description: string; embedding: number[] }
): Pick<TestDatabase["db"], "transaction"> {
  let inserted = false;

  return {
    transaction: (callback) =>
      db.transaction(async (tx) => {
        const wrappedTx = new Proxy(tx, {
          get(target, property, receiver) {
            if (property !== "insert") {
              return Reflect.get(target, property, receiver);
            }

            return (table: unknown) => {
              const insertBuilder = target.insert(table as never);
              if (table !== entities) {
                return insertBuilder;
              }

              return new Proxy(insertBuilder, {
                get(builderTarget, builderProperty, builderReceiver) {
                  if (builderProperty !== "values") {
                    return Reflect.get(builderTarget, builderProperty, builderReceiver);
                  }

                  return (values: unknown) => {
                    const rows = Array.isArray(values) ? values : [values];
                    const shouldInsert =
                      !inserted &&
                      rows.some((row) => {
                        if (!row || typeof row !== "object") return false;
                        const entityRow = row as { name?: unknown; type?: unknown };
                        return entityRow.name === entity.name && entityRow.type === entity.type;
                      });

                    const query = (builderTarget.values as (values: unknown) => unknown).call(
                      builderTarget,
                      values
                    );

                    if (!shouldInsert) {
                      return query;
                    }

                    inserted = true;

                    return new Proxy(query as object, {
                      get(queryTarget, queryProperty, queryReceiver) {
                        if (queryProperty !== "onConflictDoNothing") {
                          return Reflect.get(queryTarget, queryProperty, queryReceiver);
                        }

                        return (...args: unknown[]) => {
                          const onConflictQuery = (
                            queryTarget as {
                              onConflictDoNothing: (...args: unknown[]) => unknown;
                            }
                          ).onConflictDoNothing(...args);

                          return new Proxy(onConflictQuery as object, {
                            get(conflictTarget, conflictProperty, conflictReceiver) {
                              if (conflictProperty !== "returning") {
                                return Reflect.get(conflictTarget, conflictProperty, conflictReceiver);
                              }

                              return async (...returningArgs: unknown[]) => {
                                await target.insert(entities).values(entity).onConflictDoNothing();
                                return (
                                  conflictTarget as {
                                    returning: (...args: unknown[]) => Promise<unknown>;
                                  }
                                ).returning(...returningArgs);
                              };
                            },
                          });
                        };
                      },
                    });
                  };
                },
              });
            };
          },
        });

        return callback(wrappedTx);
      }),
  };
}

async function documentTagNames({ db }: Pick<TestDatabase, "db">, documentId: string): Promise<string[]> {
  const tagRows = await db
    .select({ name: tags.name })
    .from(documentTags)
    .innerJoin(tags, eq(documentTags.tagId, tags.id))
    .where(eq(documentTags.documentId, documentId));

  return tagRows.map((tag) => tag.name).sort();
}

function sortBy<T extends Record<TKey, string | number>, TKey extends keyof T>(rows: T[], key: TKey): T[] {
  return [...rows].sort((left, right) => {
    if (left[key] < right[key]) return -1;
    if (left[key] > right[key]) return 1;
    return 0;
  });
}
