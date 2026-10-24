import assert from "node:assert/strict";
import { test } from "node:test";
import { eq } from "drizzle-orm";
import { createTestDatabase } from "./helpers/db.ts";
import { useDatabase } from "./helpers/server.ts";
import { act, createElement, loadUi, renderUi, uiOverrides } from "./helpers/ui.ts";
import { documents, srsItems } from "../src/db/schema.ts";

const actions = await import("../src/actions/srs.ts");
export const reviewActions = { list: actions.listDueSrsItems };
loadUi({
  ...uiOverrides,
  "@/actions/srs": `
    export {reviewSrsItem} from ${JSON.stringify(new URL("../src/actions/srs.ts", import.meta.url).href)};
    import {reviewActions} from ${JSON.stringify(import.meta.url)};
    export const listDueSrsItems = (limit) => reviewActions.list(limit);
  `,
});

test("Review loads bounded next batches and retries loading errors before declaring completion", async (t) => {
  const { ReviewClient } = await import("../src/app/review/review-client.tsx");
  const db = await createTestDatabase();
  useDatabase(db.db);
  t.after(() => db.close());
  const [document] = await db.db.insert(documents).values({ title: "Review test", type: "note" }).returning();
  await db.db.insert(srsItems).values(Array.from({ length: 51 }, (_, i) => ({ documentId: document.id, question: `Question ${i}`, answer: `Answer ${i}`, dueDate: new Date("2020-01-01") })));
  const initialCards = await actions.listDueSrsItems(50);
  const limits: number[] = [];
  reviewActions.list = async (limit = 20) => { limits.push(limit); return actions.listDueSrsItems(limit); };
  const ui = await renderUi(createElement(ReviewClient, { initialCards }));
  t.after(() => ui.close());
  for (let i = 0; i < 50; i++) {
    await ui.click("Show answer");
    await ui.click("Good");
  }
  assert.equal((await actions.listDueSrsItems(50)).length, 1);
  assert.doesNotMatch(ui.document.body.textContent ?? "", /No cards due/);
  assert.match(ui.document.body.textContent ?? "", /1 due card/);
  assert.deepEqual(limits, [50]);

  const load = Promise.withResolvers<Awaited<ReturnType<typeof actions.listDueSrsItems>>>();
  reviewActions.list = () => load.promise;
  await ui.click("Show answer");
  await ui.click("Good");
  assert.doesNotMatch(ui.document.body.textContent ?? "", /No cards due/);
  await act(async () => load.reject(new Error("Loading unavailable")));
  assert.match(ui.document.body.textContent ?? "", /Loading unavailable/);
  assert.doesNotMatch(ui.document.body.textContent ?? "", /No cards due/);
  reviewActions.list = async (limit = 20) => { limits.push(limit); return actions.listDueSrsItems(limit); };
  await ui.click("Retry");
  assert.match(ui.document.body.textContent ?? "", /No cards due/);
  assert.deepEqual(limits, [50, 50]);
  const persisted = await db.db.select().from(srsItems);
  assert.ok(persisted.every((item) => item.reps === 1), "retry must not rate the final card twice");
});


test("Review discards missing SRS Items but retains a failed rating for retry", async (t) => {
  const { ReviewClient } = await import("../src/app/review/review-client.tsx");
  const database = await createTestDatabase();
  useDatabase(database.db);
  t.after(() => database.close());
  reviewActions.list = actions.listDueSrsItems;
  const [document] = await database.db.insert(documents).values({ title: "Missing review", type: "note" }).returning();
  await database.db.insert(srsItems).values([
    { documentId: document.id, question: "Deleted first", answer: "A", dueDate: new Date(0) },
    { documentId: document.id, question: "Surviving second", answer: "B", dueDate: new Date(1000) },
  ]);
  const initialCards = await actions.listDueSrsItems(50);
  const ui = await renderUi(createElement(ReviewClient, { initialCards }));
  t.after(() => ui.close());
  await actions.deleteSrsItem(initialCards[0].id);
  await ui.click("Show answer");
  await ui.click("Good");
  assert.doesNotMatch(ui.document.body.textContent ?? "", /Deleted first/);
  assert.match(ui.document.body.textContent ?? "", /Surviving second/);
  assert.equal((await actions.listDueSrsItems(50))[0].reps, 0);

  await database.pglite.exec(`CREATE FUNCTION reject_ui_review() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Review unavailable'; END; $$;
    CREATE TRIGGER reject_ui_review BEFORE UPDATE ON srs_items FOR EACH ROW EXECUTE FUNCTION reject_ui_review();`);
  await ui.click("Show answer");
  await ui.click("Good");
  assert.match(ui.document.body.textContent ?? "", /Surviving second/);
  assert.equal((await actions.listDueSrsItems(50))[0].reps, 0);
  await database.pglite.exec("DROP TRIGGER reject_ui_review ON srs_items");
  await ui.click("Good");
  assert.match(ui.document.body.textContent ?? "", /No cards due/);
  assert.equal((await database.db.select().from(srsItems))[0].reps, 1);
});


test("Review refills after its final queued Document is deleted", async (t) => {
  const { ReviewClient } = await import("../src/app/review/review-client.tsx");
  const database = await createTestDatabase();
  useDatabase(database.db);
  t.after(database.close);
  reviewActions.list = actions.listDueSrsItems;
  const [document] = await database.db.insert(documents).values({ title: "Deleted Document", type: "note" }).returning();
  await database.db.insert(srsItems).values({ documentId: document.id, question: "Stale question", answer: "Answer", dueDate: new Date(0) });
  const ui = await renderUi(createElement(ReviewClient, { initialCards: await actions.listDueSrsItems(50) }));
  t.after(ui.close);
  await database.db.delete(documents).where(eq(documents.id, document.id));
  await ui.click("Show answer");
  await ui.click("Good");
  assert.match(ui.document.body.textContent ?? "", /No cards due/);
  assert.deepEqual(await database.db.select().from(srsItems), []);
});
