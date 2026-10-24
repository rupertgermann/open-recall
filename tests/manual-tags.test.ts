import assert from "node:assert/strict";
import test from "node:test";
import { documents } from "../src/db/schema.ts";
import { createTestDatabase } from "./helpers/db.ts";
import { useDatabase } from "./helpers/server.ts";
import { act, createElement, loadUi, renderUi, uiOverrides } from "./helpers/ui.ts";

loadUi(uiOverrides);
const actions = await import("../src/actions/documents.ts");
const { TagsEditor } = await import("../src/app/library/[id]/tags-editor.tsx");

for (const change of ["add", "remove", "removed-elsewhere"] as const) {
  test(`manual tag ${change} preserves changes from another tab`, async (t) => {
    const database = await createTestDatabase();
    useDatabase(database.db);
    t.after(database.close);
    const [doc] = await database.db.insert(documents).values({ title: "Tags", type: "note" }).returning();
    await actions.updateDocumentTags(doc.id, ["baseline"]);
    const ui = await renderUi(createElement(TagsEditor, { documentId: doc.id, initialTags: ["baseline"] }));
    t.after(() => ui.close());
    await actions.updateDocumentTags(doc.id, change === "removed-elsewhere" ? [] : ["baseline", "other-tab"]);
    if (change === "remove") {
      const remove = ui.document.querySelector("button svg.lucide-x")?.closest("button");
      assert(remove);
      await act(async () => remove.click());
    } else {
      await ui.change('input[placeholder="Add tag…"]', " Current-Tab ");
      await ui.click("Add");
    }
    const expected = change === "remove" ? ["other-tab"]
      : change === "removed-elsewhere" ? ["current-tab"] : ["baseline", "current-tab", "other-tab"];
    assert.deepEqual((await actions.getDocument(doc.id))?.tags.sort(), expected);
  });
}

test("failed manual tag addition preserves the input and can be retried", async (t) => {
  const database = await createTestDatabase();
  useDatabase(database.db);
  t.after(database.close);
  const [doc] = await database.db.insert(documents).values({ title: "Tags", type: "note" }).returning();
  await actions.updateDocumentTags(doc.id, ["baseline"]);
  const ui = await renderUi(createElement(TagsEditor, { documentId: doc.id, initialTags: ["baseline"] }));
  t.after(() => ui.close());
  await database.pglite.exec(`CREATE FUNCTION reject_manual_tag() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Tag unavailable'; END; $$;
    CREATE TRIGGER reject_manual_tag BEFORE INSERT ON document_tags FOR EACH ROW EXECUTE FUNCTION reject_manual_tag();`);
  await ui.change('input[placeholder="Add tag…"]', "retry-me");
  await ui.click("Add");
  assert.equal(ui.document.querySelector("input")?.value, "retry-me");
  assert.ok(ui.document.querySelector('[role="alert"]'));
  assert.deepEqual((await actions.getDocument(doc.id))?.tags, ["baseline"]);
  await database.pglite.exec("DROP TRIGGER reject_manual_tag ON document_tags");
  await ui.click("Add");
  assert.deepEqual((await actions.getDocument(doc.id))?.tags.sort(), ["baseline", "retry-me"]);
  assert.equal(ui.document.querySelector("input")?.value, "");
});
