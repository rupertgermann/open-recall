import assert from "node:assert/strict";
import test from "node:test";
import { useState } from "react";
import { act, createElement, loadUi, renderUi, uiOverrides } from "./helpers/ui.ts";

loadUi(uiOverrides);
const { RelatedChats } = await import("../src/components/related-chats.tsx");
const response = (id: string) => Response.json({ chats: [{ id, title: `Chat ${id}`, category: "general", lastMessageAt: "2026-01-01" }] });

for (const scope of ["entityId", "documentId"] as const) {
  test(`RelatedChats owns results and loading state for the current ${scope}`, async (t) => {
    const pending = new Map<string, ReturnType<typeof Promise.withResolvers<Response>>>();
    t.mock.method(globalThis, "fetch", (url: Parameters<typeof fetch>[0]) => {
      const request = Promise.withResolvers<Response>();
      pending.set(String(url).split("/").at(-1)!.split("?")[0], request);
      return request.promise;
    });
    function Selection() {
      const [id, setId] = useState<string | undefined>("A");
      return createElement("div", null,
        ["A", "B", "C", "D", "E"].map(value => createElement("button", { key: value, onClick: () => setId(value) }, value)),
        createElement("button", { onClick: () => setId(undefined) }, "Clear"),
        createElement(RelatedChats, { [scope]: id }));
    }
    const ui = await renderUi(createElement(Selection));
    t.after(ui.close);
    await ui.click("B");
    await act(async () => pending.get("A")!.resolve(response("A")));
    assert.doesNotMatch(ui.document.body.textContent ?? "", /Chat A|No previous conversations/);
    await act(async () => pending.get("B")!.resolve(response("B")));
    assert.match(ui.document.body.textContent ?? "", /Chat B/);
    await ui.click("C");
    assert.doesNotMatch(ui.document.body.textContent ?? "", /Chat B/);
    await ui.click("D");
    await act(async () => pending.get("D")!.resolve(response("D")));
    await act(async () => pending.get("C")!.resolve(response("C")));
    assert.match(ui.document.body.textContent ?? "", /Chat D/);
    assert.doesNotMatch(ui.document.body.textContent ?? "", /Chat C/);
    await ui.click("E");
    assert.doesNotMatch(ui.document.body.textContent ?? "", /Chat D/);
    await act(async () => pending.get("E")!.resolve(new Response(null, { status: 500 })));
    assert.match(ui.document.body.textContent ?? "", /No previous conversations/);
    await ui.click("A");
    await ui.click("B");
    await act(async () => pending.get("A")!.reject(new Error("Obsolete request")));
    assert.doesNotMatch(ui.document.body.textContent ?? "", /No previous conversations/);
    await ui.click("Clear");
    await act(async () => pending.get("B")!.resolve(response("B")));
    assert.doesNotMatch(ui.document.body.textContent ?? "", /Chat B/);
    assert.match(ui.document.body.textContent ?? "", /No previous conversations/);
  });
}
