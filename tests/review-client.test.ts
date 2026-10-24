import assert from "node:assert/strict";
import { test } from "node:test";
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
