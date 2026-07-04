import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";

import * as schema from "../../src/db/schema.ts";

const migrationsFolder = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../drizzle"
);

export type TestDatabase = {
  db: PgliteDatabase<typeof schema>;
  pglite: PGlite;
  close: () => Promise<void>;
};

export async function createTestDatabase(): Promise<TestDatabase> {
  const pglite = new PGlite({
    extensions: {
      vector,
    },
  });
  const db = drizzle(pglite, { schema });

  await migrate(db, { migrationsFolder });

  return {
    db,
    pglite,
    close: () => pglite.close(),
  };
}
