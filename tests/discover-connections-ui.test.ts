import assert from "node:assert/strict";
import test from "node:test";
import { createElement, loadUi, renderUi, uiOverrides } from "./helpers/ui.ts";
import type { DiscoverData } from "../src/lib/discover/types.ts";

loadUi({
  ...uiOverrides,
  "@/actions/discover": "export const getDiscoverSnapshot = async () => { throw new Error('Unexpected refresh'); };",
  "@/components/ui/tooltip": `
    export const Tooltip = ({children}) => children;
    export const TooltipProvider = ({children}) => children;
    export const TooltipTrigger = ({children}) => children;
    export const TooltipContent = () => null;
  `,
});

test("Discover hidden paths display neutral connectors without claiming relationship direction", async (t) => {
  const { DiscoverClient } = await import("../src/components/discover/discover-client.tsx");
  const entity = (name: string) => ({ id: name, name, type: "technology", description: null });
  const data: DiscoverData = {
    stats: { totalEntities: 9, totalRelationships: 6, clustersFound: 0, potentialInsights: 3 },
    connections: ["forward", "converging", "diverging"].map((key) => ({
      key, entityA: entity(`${key} App A`), bridge: entity(`${key} Library`), entityB: entity(`${key} App C`),
      relationABridge: "depends_on", relationBridgeB: "depends_on", sourceDocuments: [],
    })),
    bridges: [], clusters: [], savedInsights: {},
  };
  const ui = await renderUi(createElement(DiscoverClient, { initialData: data }));
  t.after(() => ui.close());
  assert.equal(ui.document.querySelectorAll('[role="img"][aria-label="Undirected relationship"]').length, 6);
  assert.equal(ui.document.querySelectorAll(".lucide-arrow-right").length, 0);
  assert.match(ui.document.body.textContent ?? "", /converging Library/);
});
