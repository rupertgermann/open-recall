import assert from "node:assert/strict";
import test from "node:test";
import { act, createElement, loadUi, renderUi, uiOverrides } from "./helpers/ui.ts";
import type { getEntityDetails as entityDetails } from "../src/actions/graph.ts";

const react = new URL("../node_modules/react/index.js", import.meta.url).href;
export const graph = { nodes: ["a", "b"].map(id => ({ id, name: `Entity ${id}`, type: "concept", mentionCount: 1 })), links: [] };
export const pending = new Map<string, ReturnType<typeof Promise.withResolvers<Awaited<ReturnType<typeof entityDetails>>>>>();
export function getEntityDetails(id: string) {
  const request = Promise.withResolvers<Awaited<ReturnType<typeof entityDetails>>>();
  pending.set(id, request);
  return request.promise;
}
loadUi({
  ...uiOverrides,
  "next/navigation": `const params = new URLSearchParams(); export const useSearchParams = () => params; export const useRouter = () => ({push(){}});`,
  "next/link": `import {createElement} from ${JSON.stringify(react)}; export default ({children, href}) => createElement('a', {href}, children);`,
  "next/dynamic": `import {createElement, forwardRef, useImperativeHandle} from ${JSON.stringify(react)};
    export default () => forwardRef((props, ref) => {
      useImperativeHandle(ref, () => ({zoom: () => 1, centerAt(){}, zoomToFit(){}}));
      return createElement('div', null, props.graphData.nodes.map(node => createElement('button', {key: node.id, onClick: () => props.onNodeClick(node)}, 'Pick ' + node.name)));
    });`,
  "@/actions/graph": `import {graph, getEntityDetails} from ${JSON.stringify(import.meta.url)}; export {getEntityDetails}; export const getGraphData = async () => graph; export const getDocumentGraph = async () => graph;`,
  "@/components/related-chats": `export { RelatedChats } from ${JSON.stringify(new URL("../src/components/related-chats.tsx", import.meta.url).href)};`,
  "@/actions/documents": "export const getAllTags = async () => [];",
  "@/actions/collections": "export const getCollections = async () => [];",
  "@/actions/websearch": "export const aiWebSearchForEntity = async () => [];",
  "@/app/library/chat-about-button": "export const ChatAboutButton = () => null;",
  "@/hooks/use-toast": "export const useToast = () => ({toast(){}});",
});
const details = (id: string) => ({ id, name: `Entity ${id}`, type: "concept", description: `Description ${id}`, embedding: null, embeddingModel: null, createdAt: new Date(), updatedAt: new Date(), documents: [{ id: `doc-${id}`, title: `Document ${id}`, type: "note", createdAt: new Date() }], connectedEntities: [] });

test("Graph keeps selected Entity details, Document links and chats together through reordered requests", async (t) => {
  const previous = ["localStorage", "ResizeObserver"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: () => null, setItem() {} } });
  Object.defineProperty(globalThis, "ResizeObserver", { configurable: true, value: class { observe() {} disconnect() {} } });
  t.after(() => {
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  });
  t.mock.method(globalThis, "fetch", async (url: Parameters<typeof fetch>[0]) => {
    const id = String(url).split("/").at(-1)!.split("?")[0];
    return Response.json({ chats: [{ id: `chat-${id}`, title: `Chat ${id}`, category: "entity", lastMessageAt: "2026-01-01" }] });
  });
  const { default: GraphPage } = await import("../src/app/graph/page.tsx");
  const ui = await renderUi(createElement(GraphPage));
  t.after(ui.close);
  await ui.click("Pick Entity a");
  await ui.click("Pick Entity b");
  await act(async () => pending.get("b")!.resolve(details("b")));
  await act(async () => pending.get("a")!.resolve(details("a")));
  assert.match(ui.document.body.textContent ?? "", /Description b/);
  assert.match(ui.document.body.textContent ?? "", /Chat b/);
  assert.ok(ui.document.querySelector('a[href="/library/doc-b"]'));
  assert.doesNotMatch(ui.document.body.textContent ?? "", /Description a|Document a|Chat a/);

  await ui.click("Pick Entity a");
  assert.doesNotMatch(ui.document.body.textContent ?? "", /Description b|Document b|Chat b/);
  await ui.click("Pick Entity b");
  await act(async () => pending.get("a")!.resolve(details("a")));
  assert.doesNotMatch(ui.document.body.textContent ?? "", /Description a|Document a|Chat a/);
  await act(async () => pending.get("b")!.resolve(details("b")));
  assert.match(ui.document.body.textContent ?? "", /Description b/);

  await ui.click("Pick Entity a");
  await ui.click("Pick Entity b");
  await act(async () => pending.get("a")!.reject(new Error("Obsolete details")));
  assert.doesNotMatch(ui.document.body.textContent ?? "", /Description a|Description b|Chat b/);
  await ui.close();
  await act(async () => pending.get("b")!.resolve(details("b")));
});
