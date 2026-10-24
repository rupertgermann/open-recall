import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";

test("Entity model migration preserves existing vectors, IDs, and mentions with unknown provenance", async (t) => {
  const database = new PGlite({ extensions: { vector } });
  t.after(() => database.close());
  await database.exec(await readFile(new URL("../drizzle/0000_nappy_major_mapleleaf.sql", import.meta.url), "utf8"));
  await database.exec(`
    INSERT INTO documents (id, title, type, content) VALUES ('00000000-0000-0000-0000-000000000001', 'Legacy', 'note', 'Postgres');
    INSERT INTO chunks (id, document_id, content, chunk_index) VALUES ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'Postgres', 0);
    INSERT INTO entities (id, name, type, description, embedding) VALUES ('00000000-0000-0000-0000-000000000003', 'Postgres', 'technology', 'Existing description', '[1,0,0]');
    INSERT INTO entity_mentions (entity_id, chunk_id, document_id) VALUES ('00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001');
  `);
  const before = await database.query("SELECT id, name, type, description, embedding::text FROM entities");
  const mentions = await database.query("SELECT * FROM entity_mentions");
  await database.exec(await readFile(new URL("../drizzle/0003_entity_embedding_model.sql", import.meta.url), "utf8"));
  assert.deepEqual((await database.query("SELECT id, name, type, description, embedding::text FROM entities")).rows, before.rows);
  assert.deepEqual((await database.query("SELECT * FROM entity_mentions")).rows, mentions.rows);
  assert.deepEqual((await database.query("SELECT embedding_model FROM entities")).rows, [{ embedding_model: null }]);
});
