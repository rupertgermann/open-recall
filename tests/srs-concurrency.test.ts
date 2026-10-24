import assert from "node:assert/strict";
import test from "node:test";
import { drizzle } from "drizzle-orm/pglite";

import * as schema from "../src/db/schema.ts";
import { scheduleSrsReview, SRS_RATINGS } from "../src/lib/srs/scheduler.ts";
import { createTestDatabase } from "./helpers/db.ts";
import { useDatabase } from "./helpers/server.ts";

const { getDocumentFlashcards, reviewSrsItem } = await import("../src/actions/srs.ts");

test("concurrent reviews use successive committed SRS states", async (t) => {
  const database = await createTestDatabase();
  t.after(() => database.close());
  const queries: string[] = [];
  const db = drizzle(database.pglite, {
    schema,
    logger: { logQuery: (query) => queries.push(query) },
  });
  useDatabase(db);
  const [document] = await db.insert(schema.documents).values({ title: "Reviews", type: "note" }).returning();
  const [item] = await db.insert(schema.srsItems).values({
    documentId: document.id, question: "Question", answer: "Answer", dueDate: new Date(0),
  }).returning();
  queries.length = 0;

  const results = await Promise.all(
    [SRS_RATINGS.good, SRS_RATINGS.again].map(async (rating) => ({
      rating, result: await reviewSrsItem(item.id, rating),
    }))
  );
  const reviews = results.map(({ rating, result }) => {
    assert.equal(result.success, true);
    assert.ok(result.item);
    return { rating, item: result.item };
  }).sort((a, b) => a.item.reps - b.item.reps);
  assert.deepEqual(reviews.map((review) => review.item.reps), [1, 2]);

  let previous = item;
  for (const review of reviews) {
    assert.ok(review.item.lastReviewDate);
    const next = scheduleSrsReview(previous, review.rating, new Date(review.item.lastReviewDate));
    assert.deepEqual(review.item, {
      ...review.item, ...next,
      dueDate: next.dueDate.toISOString(), lastReviewDate: next.lastReviewDate.toISOString(),
    });
    previous = { ...previous, ...next };
  }
  assert.deepEqual(await getDocumentFlashcards(document.id), [reviews[1].item]);
  // PGlite serializes transactions, so also verify the row lock needed by PostgreSQL sessions.
  assert.equal(queries.filter((query) => /select .* from "srs_items" .* for update$/i.test(query)).length, 2);
});

test("failed review writes preserve state and allow a normal retry", async (t) => {
  const { db, pglite, close } = await createTestDatabase();
  t.after(close);
  useDatabase(db);
  const [document] = await db.insert(schema.documents).values({ title: "Retry", type: "note" }).returning();
  const [item] = await db.insert(schema.srsItems).values({
    documentId: document.id, question: "Question", answer: "Answer", dueDate: new Date(0),
  }).returning();
  await pglite.exec(`CREATE FUNCTION reject_review() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Review failed'; END; $$;
    CREATE TRIGGER reject_review BEFORE UPDATE ON srs_items FOR EACH ROW EXECUTE FUNCTION reject_review();`);

  await assert.rejects(reviewSrsItem(item.id, "good"));
  assert.deepEqual(await db.select().from(schema.srsItems), [item]);
  await pglite.exec("DROP TRIGGER reject_review ON srs_items");

  for (const rating of Object.values(SRS_RATINGS)) {
    const [before] = await db.select().from(schema.srsItems);
    const result = await reviewSrsItem(item.id, rating);
    assert.equal(result.success, true);
    assert.ok(result.item?.lastReviewDate);
    const next = scheduleSrsReview(before, rating, new Date(result.item.lastReviewDate));
    assert.deepEqual(await db.select().from(schema.srsItems), [{ ...before, ...next }]);
    assert.deepEqual(await getDocumentFlashcards(document.id), [result.item]);
  }
  assert.deepEqual(await reviewSrsItem("00000000-0000-0000-0000-000000000000", "good"), {
    success: false, error: "Flashcard not found",
  });
  assert.deepEqual(await Reflect.apply(reviewSrsItem, undefined, [item.id, "invalid"]), {
    success: false, error: "Invalid review rating",
  });
});
