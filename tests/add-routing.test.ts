import assert from "node:assert/strict";
import test from "node:test";
import { act, controls, createElement, loadUi, renderUi, uiOverrides } from "./helpers/ui.ts";

export let params = new URLSearchParams();
export const observers = new Set<() => void>();
function navigate(query: string) {
  params = new URLSearchParams(query);
  for (const observer of observers) observer();
}
loadUi({
  ...uiOverrides,
  "@/components/ui/textarea": controls + `export const Textarea = (props) => createElement('textarea', props);`,
  "next/navigation": `
    import {useSyncExternalStore} from ${JSON.stringify(new URL("../node_modules/react/index.js", import.meta.url).href)};
    import {observers, params} from ${JSON.stringify(import.meta.url)};
    export const useSearchParams = () => useSyncExternalStore(f => {observers.add(f); return () => observers.delete(f)}, () => params);
    export const useRouter = () => ({push(){}});
  `,
});

test("Add follows the current refresh target and URL without automatically submitting", async (t) => {
  const { default: AddPage } = await import("../src/app/add/page.tsx");
  const requests: Array<{ url: string; body: { documentId?: string; url?: string } }> = [];
  t.mock.method(globalThis, "fetch", async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
    requests.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    return Response.json({ error: "Controlled failure" }, { status: 500 });
  });
  navigate("update=original-document&start=1");
  const ui = await renderUi(createElement(AddPage));
  t.after(ui.close);
  assert.match(ui.document.body.textContent ?? "", /Updating Document/);
  await act(async () => navigate(""));
  assert.doesNotMatch(ui.document.body.textContent ?? "", /Updating Document/);
  assert.ok(ui.document.querySelector('input[type="url"]'));
  await act(async () => navigate("update=original-document"));
  await act(async () => navigate("url=https%3A%2F%2Fexample.com%2Fnew&start=1"));
  assert.equal(ui.document.querySelector<HTMLInputElement>('input[type="url"]')?.value, "https://example.com/new");
  assert.equal(requests.length, 0);
  const submit = () => act(async () => {
    ui.document.querySelector("form")!.dispatchEvent(new ui.document.defaultView!.Event("submit", { bubbles: true, cancelable: true }));
  });
  await submit();
  assert.equal(requests[0].url, "/api/ingest");
  assert.equal(requests[0].body.url, "https://example.com/new");
  assert.equal(requests[0].body.documentId, undefined);
  await act(async () => navigate("update=original-document"));
  await act(async () => navigate("update=replacement-document&start=1"));
  assert.equal(requests.length, 1);
  await submit();
  assert.equal(requests[1].url, "/api/update-document");
  assert.equal(requests[1].body.documentId, "replacement-document");
});
