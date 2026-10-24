import assert from "node:assert/strict";
import { test } from "node:test";
import { act, createElement, loadUi, renderUi, uiOverrides } from "./helpers/ui.ts";
import type { getDocuments as fetchDocuments } from "../src/actions/documents.ts";

const doc = (title: string, type = "note") => ({
  id: title, title, type, summary: "Original summary", url: "https://example.com/article",
  processingStatus: "completed", createdAt: new Date(), entityCount: 0, dueSrsCount: 0, imagePath: null,
});
type Row = ReturnType<typeof doc>;
const requests: { options: Parameters<typeof fetchDocuments>[0]; pending: ReturnType<typeof Promise.withResolvers<Row[]>> }[] = [];
export function getDocuments(options: Parameters<typeof fetchDocuments>[0]) {
  const pending = Promise.withResolvers<Row[]>();
  requests.push({ options, pending });
  return pending.promise;
}
let mutationFails = false;
let pendingMutation: ReturnType<typeof Promise.withResolvers<void>> | undefined;
export async function mutate() {
  if (mutationFails) throw new Error("Mutation rejected");
  await pendingMutation?.promise;
}
const reactUrl = JSON.stringify(new URL("../node_modules/react/index.js", import.meta.url).href);
loadUi({
  ...uiOverrides,
  "next/navigation": `export const useRouter = () => ({push(){}});`,
  "next/image": `export default () => null;`,
  "@/hooks/use-toast": `export const useToast = () => ({toast(){}});`,
  "@/components/ui/dropdown-menu": `import {createElement} from ${reactUrl};
    export const DropdownMenu = ({children})=>children;
    export const DropdownMenuContent = ({children})=>children;
    export const DropdownMenuItem = ({children,onClick,disabled})=>createElement('button',{onClick,disabled},children);
    export const DropdownMenuTrigger = ({children})=>children;`,
  "@/components/ui/alert-dialog": `import {createElement} from ${reactUrl};
    export const AlertDialog = ({open,children})=>open?children:null;
    export const AlertDialogAction = ({children,onClick,disabled})=>createElement('button',{'data-confirm':true,onClick,disabled},children);
    ${["AlertDialogCancel", "AlertDialogContent", "AlertDialogDescription", "AlertDialogFooter", "AlertDialogHeader", "AlertDialogTitle"].map(n => `export const ${n}=({children})=>children;`).join("\n")}`,
  "@/actions/documents": `export {getDocuments,mutate as deleteDocument} from ${JSON.stringify(import.meta.url)}; export const updateDocumentFromSource=async()=>({success:true});`,
  "@/actions/collections": `export {mutate as removeDocumentFromCollection} from ${JSON.stringify(import.meta.url)};
    export const getCollections=async()=>[{id:'collection',name:'Reading',documentCount:31}];
    ${["createCollection", "updateCollection", "deleteCollection", "bulkAddToCollection", "suggestAutoOrganize", "applyAutoOrganizeSuggestions", "getUnassignedDocumentCount"].map(n => `export const ${n}=async()=>${n === "getUnassignedDocumentCount" ? "0" : "[]"};`).join("\n")}`,
});

async function mount() {
  requests.length = 0;
  mutationFails = false;
  pendingMutation = undefined;
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: () => null, setItem() {} } });
  const { default: LibraryPage } = await import("../src/app/library/page.tsx");
  const ui = await renderUi(createElement(LibraryPage));
  return { ...ui, async close() {
    await ui.close();
    if (previous) Object.defineProperty(globalThis, "localStorage", previous);
    else Reflect.deleteProperty(globalThis, "localStorage");
  } };
}
async function resolve(index: number, rows: Row[]) { await act(async () => requests[index].pending.resolve(rows)); }
async function refresh(ui: Awaited<ReturnType<typeof mount>>) {
  const button = ui.document.querySelector("button svg.lucide-refresh-cw")?.closest("button");
  assert(button);
  await act(async () => button.click());
}
async function remove(ui: Awaited<ReturnType<typeof mount>>, collection: boolean) {
  if (collection) return ui.click("Remove from collection");
  const button = Array.from(ui.document.querySelectorAll<HTMLButtonElement>("section button")).find(b => b.textContent === "Delete");
  assert(button);
  await act(async () => button.click());
  const confirm = ui.document.querySelector<HTMLButtonElement>("button[data-confirm]");
  assert(confirm);
  await act(async () => confirm.click());
}

test("Refresh and Source Refresh reload an unchanged query and preserve filters", async () => {
  const ui = await mount();
  try {
    await resolve(0, []);
    await ui.click("text");
    await resolve(1, []);
    await ui.click("Reading31");
    await resolve(2, [doc("old title")]);
    await ui.change("input", "title");
    await act(async () => { await new Promise(r => setTimeout(r, 350)); });
    await resolve(3, [doc("old title")]);
    await refresh(ui);
    assert.equal(requests.length, 5);
    assert.deepEqual(requests[4].options, { search: "title", type: "note", collectionId: "collection", limit: 30, offset: 0 });
    await resolve(4, [doc("fresh title")]);
    assert.match(ui.document.body.textContent!, /fresh title/);
    await ui.click("Update from source");
    assert.equal(requests.length, 6);
    assert.deepEqual(requests[5].options, requests[4].options);
    await resolve(5, [{ ...doc("updated title"), summary: "Updated summary", entityCount: 9, dueSrsCount: 4, processingStatus: "processing" }]);
    assert.match(ui.document.body.textContent!, /updated title[\s\S]*Updated summary[\s\S]*Processing[\s\S]*4 due/);
    assert.equal(ui.document.querySelector("input")?.value, "title");
  } finally { await ui.close(); }
});

test("obsolete filter responses cannot replace rows, pagination or loading", async () => {
  const ui = await mount();
  try {
    await resolve(0, []);
    await ui.click("article");
    await ui.click("text");
    await resolve(1, [doc("stale article", "article")]);
    assert.match(ui.document.body.textContent!, /Loading\.\.\./);
    await resolve(2, Array.from({ length: 30 }, (_, i) => doc(`note-${i}`)));
    await ui.click("article");
    await ui.click("text");
    await resolve(4, [doc("current note")]);
    await resolve(3, Array.from({ length: 30 }, (_, i) => doc(`obsolete-${i}`, "article")));
    assert.match(ui.document.body.textContent!, /current note/);
    assert.doesNotMatch(ui.document.body.textContent!, /obsolete-|Load more/);
  } finally { await ui.close(); }
});

test("an obsolete Load more cannot append or clear a newer query's loading state", async () => {
  const ui = await mount();
  try {
    await resolve(0, Array.from({ length: 30 }, (_, i) => doc(`note-${i}`)));
    await ui.click("Load more");
    await ui.click("article");
    await resolve(1, [doc("stale page")]);
    assert.match(ui.document.body.textContent!, /Loading\.\.\./);
    await resolve(2, Array.from({ length: 30 }, (_, i) => doc(`article-${i}`, "article")));
    assert.doesNotMatch(ui.document.body.textContent!, /stale page/);
    await ui.click("Load more");
    assert.equal(requests[3].options?.offset, 30);
    await resolve(3, [doc("final article", "article")]);
    assert.match(ui.document.body.textContent!, /final article/);
  } finally { await ui.close(); }
});

test("search and collection requests resolving in reverse order keep the current query", async () => {
  const ui = await mount();
  try {
    await resolve(0, []);
    await ui.change("input", "older");
    await act(async () => { await new Promise(r => setTimeout(r, 350)); });
    await ui.change("input", "newer");
    await act(async () => { await new Promise(r => setTimeout(r, 350)); });
    await ui.click("Reading31");
    await resolve(3, [doc("current collection result")]);
    await resolve(2, [doc("wrong collection result")]);
    await resolve(1, [doc("old search result")]);
    assert.match(ui.document.body.textContent!, /current collection result/);
    assert.doesNotMatch(ui.document.body.textContent!, /wrong collection result|old search result/);
  } finally { await ui.close(); }
});

test("successful removal invalidates a pending page from the same query", async () => {
  const ui = await mount();
  try {
    const dataset = Array.from({ length: 31 }, (_, i) => doc(`doc-${i}`));
    await resolve(0, []);
    await ui.click("Reading31");
    await resolve(1, dataset.slice(0, 30));
    pendingMutation = Promise.withResolvers<void>();
    await ui.click("Remove from collection");
    await ui.click("Load more");
    await act(async () => pendingMutation!.resolve());
    assert.equal(requests[3].options?.offset, 0);
    await resolve(3, dataset.slice(1));
    await resolve(2, [dataset[30]]);
    assert.equal(ui.document.body.textContent!.match(/doc-30(?!\d)/g)?.length, 1);
    await ui.click("Load more");
    assert.equal(requests[4].options?.offset, 30);
    await resolve(4, []);
  } finally { await ui.close(); }
});

for (const collection of [false, true]) {
  test(`${collection ? "Collection removal" : "Deletion"} reloads pagination without skipping row 31; failed mutations preserve it`, async () => {
    const ui = await mount();
    try {
      const dataset = Array.from({ length: 31 }, (_, i) => doc(`doc-${i}`));
      await resolve(0, dataset.slice(0, 30));
      if (collection) {
        await ui.click("Reading31");
        await resolve(1, dataset.slice(0, 30));
      }
      mutationFails = true;
      const before = requests.length;
      await remove(ui, collection);
      assert.equal(requests.length, before);
      assert.match(ui.document.body.textContent!, /doc-0(?!\d)/);
      mutationFails = false;
      await remove(ui, collection);
      assert.equal(requests.length, before + 1);
      assert.equal(requests[before].options?.offset, 0);
      await resolve(before, dataset.slice(1));
      await ui.click("Load more");
      assert.equal(requests[before + 1].options?.offset, 30);
      await resolve(before + 1, []);
      assert.doesNotMatch(ui.document.body.textContent!, /doc-0(?!\d)/);
      assert.equal(ui.document.body.textContent!.match(/doc-30(?!\d)/g)?.length, 1);
    } finally { await ui.close(); }
  });
}
