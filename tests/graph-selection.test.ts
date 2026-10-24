import assert from "node:assert/strict";
import test from "node:test";
import { act, createElement, loadUi, renderUi, uiOverrides } from "./helpers/ui.ts";
import type { getEntityDetails as entityDetails } from "../src/actions/graph.ts";
import type { ForceGraphProps } from "react-force-graph-2d";

const react = new URL("../node_modules/react/index.js", import.meta.url).href;
export const graph = { nodes: ["a", "b"].map(id => ({ id, name: `Entity ${id}`, type: "concept", mentionCount: 1 })), links: [] };
export const params = new URLSearchParams();
export const engine: {
  ready: boolean;
  mount: () => void;
  props: ForceGraphProps<{ id: string }>;
  centers: number[][];
  zooms: number[];
} = { ready: true, mount() {}, props: {}, centers: [], zooms: [] };
export const pending = new Map<string, ReturnType<typeof Promise.withResolvers<Awaited<ReturnType<typeof entityDetails>>>>>();
export function getEntityDetails(id: string) {
  const request = Promise.withResolvers<Awaited<ReturnType<typeof entityDetails>>>();
  pending.set(id, request);
  return request.promise;
}
loadUi({
  ...uiOverrides,
  "next/navigation": `import {params} from ${JSON.stringify(import.meta.url)}; export const useSearchParams = () => params; export const useRouter = () => ({push(){}});`,
  "next/link": `import {createElement} from ${JSON.stringify(react)}; export default ({children, href}) => createElement('a', {href}, children);`,
  "next/dynamic": `import {createElement, forwardRef, useImperativeHandle, useState} from ${JSON.stringify(react)};
    import {engine} from ${JSON.stringify(import.meta.url)};
    export default () => forwardRef((props, ref) => {
      const [ready, setReady] = useState(engine.ready);
      engine.props = props;
      engine.mount = () => setReady(true);
      useImperativeHandle(ref, () => ready ? {
        zoom: (scale) => scale === undefined ? 1 : engine.zooms.push(scale),
        centerAt: (x, y, duration) => engine.centers.push([x, y, duration]),
        zoomToFit(){}
      } : null, [ready]);
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

for (const selectionSource of ["saved", "url"]) {
  test(`Graph centers ${selectionSource} selection after readiness and subsequent clicks without restarting layout`, async (t) => {
    const previous = ["localStorage", "ResizeObserver"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
    let saved = JSON.stringify({ selectedNodeId: "a", camera: null, focusDocumentId: null });
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
      getItem: () => saved,
      setItem: (_key: string, value: string) => { saved = value; },
    } });
    Object.defineProperty(globalThis, "ResizeObserver", { configurable: true, value: class { observe() {} disconnect() {} } });
    if (selectionSource === "url") params.set("entity", "b");
    engine.ready = false;
    engine.centers = [];
    engine.zooms = [];
    t.after(() => {
      params.delete("entity");
      engine.ready = true;
      for (const [key, descriptor] of previous) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
      }
    });
    const { default: GraphPage } = await import("../src/app/graph/page.tsx");
    const ui = await renderUi(createElement(GraphPage));
    t.after(ui.close);
    const data = engine.props.graphData;
    assert.ok(data);
    const first = data.nodes.find(node => node.id === (selectionSource === "url" ? "b" : "a"));
    const second = data.nodes.find(node => node !== first);
    assert.ok(first && second);
    assert.equal(engine.centers.length, 0);
    await act(async () => engine.mount());
    engine.props.onEngineTick?.();
    assert.equal(engine.centers.length, 0, "wait for simulation coordinates");
    Object.assign(first, { x: 10, y: 20 });
    Object.assign(second, { x: 30, y: 40 });
    engine.props.onEngineTick?.();
    assert.deepEqual(engine.centers.at(-1), [10, 20, 0]);
    assert.deepEqual(engine.zooms, [5]);
    first.x = 15;
    engine.props.onEngineTick?.();
    assert.deepEqual(engine.centers.at(-1), [15, 20, 0]);
    assert.deepEqual(engine.zooms, [5], "following only changes the center");
    engine.props.onEngineStop?.();
    const settledCalls = engine.centers.length;
    engine.props.onEngineTick?.();
    assert.equal(engine.centers.length, settledCalls);

    await ui.click(`Pick Entity ${second.id}`);
    assert.equal(engine.props.graphData, data, "selection preserves simulation nodes and coordinates");
    assert.deepEqual(engine.centers.at(-1), [30, 40, 0]);
    for (const eventType of ["pointerdown", "wheel"]) {
      ui.document.querySelector("main")!.dispatchEvent(new window.Event(eventType, { bubbles: true }));
      const calls: number = engine.centers.length;
      engine.props.onEngineTick?.();
      engine.props.onEngineStop?.();
      assert.equal(engine.centers.length, calls, `${eventType} leaves the camera under user control`);
      await ui.click(`Pick Entity ${second.id}`);
      assert.equal(engine.centers.length, calls + 1, "clicking the selected node focuses it again");
      assert.deepEqual(engine.centers.at(-1), [30, 40, 0]);
    }
  });
}
