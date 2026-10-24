import assert from "node:assert/strict";
import test from "node:test";
import { act, createElement, loadUi, renderUi, uiOverrides, controls } from "./helpers/ui.ts";

export const captureEffects: { routes: string[]; notices: { title: string }[] } = { routes: [], notices: [] };
loadUi({
  ...uiOverrides,
  "@/components/ui/textarea": controls + "\nexport const Textarea = (props) => createElement('textarea', props);",
  "next/navigation": `import {captureEffects} from ${JSON.stringify(import.meta.url)}; export const useRouter=()=>({push:(url)=>captureEffects.routes.push(url)});`,
  "@/hooks/use-toast": `import {captureEffects} from ${JSON.stringify(import.meta.url)}; export const useToast=()=>({toast:(notice)=>captureEffects.notices.push(notice)});`,
});

async function openCapture(ui: Awaited<ReturnType<typeof renderUi>>) {
  const button = ui.document.querySelector<HTMLButtonElement>('[aria-label="Quick capture"]');
  assert.ok(button);
  await act(async () => button.click());
}

async function changeNote(ui: Awaited<ReturnType<typeof renderUi>>, value: string) {
  const input = ui.document.querySelector("textarea");
  assert.ok(input);
  const view = ui.document.defaultView;
  assert.ok(view);
  const setter = Object.getOwnPropertyDescriptor(view.HTMLTextAreaElement.prototype, "value")?.set;
  assert.ok(setter);
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new view.Event("input", { bubbles: true }));
  });
}

test("Quick capture freezes a pending note and blocks repeated button and keyboard submissions", async (t) => {
  const { QuickCapture } = await import("../src/components/quick-capture.tsx");
  const pending = Promise.withResolvers<Response>();
  const payloads: unknown[] = [];
  t.mock.method(globalThis, "fetch", async (_url: string, options: RequestInit) => {
    payloads.push(JSON.parse(String(options.body)));
    return pending.promise;
  });
  const ui = await renderUi(createElement(QuickCapture));
  t.after(() => ui.close());
  await openCapture(ui);
  await ui.change('input[placeholder="Title (optional)"]', "My note");
  await changeNote(ui, "Original note");
  await ui.click("Save Note");
  const textarea = ui.document.querySelector("textarea");
  assert.ok(textarea);
  assert.equal(textarea.disabled, true, "the pending draft cannot be edited");
  assert.equal(ui.document.querySelector<HTMLInputElement>('input[placeholder="Title (optional)"]')?.disabled, true);
  const view = ui.document.defaultView;
  assert.ok(view);
  await act(async () => {
    for (const modifier of [{ ctrlKey: true }, { metaKey: true }]) {
      textarea.dispatchEvent(new view.KeyboardEvent("keydown", { key: "Enter", bubbles: true, ...modifier }));
    }
  });
  await ui.click("Save Note");
  await ui.click("Save URL");
  await openCapture(ui);
  const backdrop = ui.document.querySelector<HTMLElement>(".backdrop-blur-sm");
  assert.ok(backdrop);
  await act(async () => backdrop.click());
  assert.equal(ui.document.querySelector("textarea"), textarea, "pending capture stays open in note mode");
  assert.deepEqual(payloads, [{ type: "text", title: "My note", content: "Original note" }]);
  await act(async () => pending.resolve(new Response('data: {"step":"done"}\n\n')));
  assert.equal(ui.document.querySelector("textarea"), null);
  assert.equal(captureEffects.notices.at(-1)?.title, "Note saved");
  await openCapture(ui);
  assert.equal(ui.document.querySelector("textarea")?.value, "");
});

test("Quick capture preserves a failed note for retry and routes URL captures", async (t) => {
  const { QuickCapture } = await import("../src/components/quick-capture.tsx");
  let requests = 0;
  t.mock.method(globalThis, "fetch", async () => {
    requests++;
    if (requests === 1) throw new Error("Unavailable");
    return new Response('data: {"step":"done"}\n\n');
  });
  const ui = await renderUi(createElement(QuickCapture));
  t.after(() => ui.close());
  await openCapture(ui);
  await ui.change('input[placeholder="Title (optional)"]', "Retry note");
  await changeNote(ui, "Keep this draft");
  await ui.click("Save Note");
  assert.equal(ui.document.querySelector("textarea")?.value, "Keep this draft");
  assert.equal(ui.document.querySelector("textarea")?.disabled, false);
  assert.equal(ui.document.querySelector<HTMLInputElement>('input[placeholder="Title (optional)"]')?.value, "Retry note");
  assert.equal(captureEffects.notices.at(-1)?.title, "Error");
  await ui.click("Save Note");
  assert.equal(requests, 2);
  assert.equal(ui.document.querySelector("textarea"), null);
  await openCapture(ui);
  await ui.click("Save URL");
  await ui.change('input[placeholder="Paste a URL..."]', "https://example.com/article?q=search");
  await ui.click("Add URL");
  assert.equal(captureEffects.routes.at(-1), "/add?url=https%3A%2F%2Fexample.com%2Farticle%3Fq%3Dsearch");
  assert.equal(requests, 2);
});
