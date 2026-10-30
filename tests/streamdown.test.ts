import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout } from "node:timers/promises";
import { act, createElement, loadUi, renderUi } from "./helpers/ui.ts";

const react = `import { createElement } from ${JSON.stringify(new URL("../node_modules/react/index.js", import.meta.url).href)};`;
loadUi({
  "@/components/ui/button": "export const Button = () => null;",
  "@/components/ui/button-group": "export const ButtonGroup = () => null; export const ButtonGroupText = () => null;",
  "@/components/ui/tooltip": "export const Tooltip = () => null; export const TooltipContent = () => null; export const TooltipProvider = () => null; export const TooltipTrigger = () => null;",
  "@/components/ui/collapsible": react + "export const Collapsible = ({children}) => children; export const CollapsibleContent = ({children}) => createElement('div', null, children); export const CollapsibleTrigger = () => null;",
  "./shimmer": "export const Shimmer = () => null;",
});

const { MessageResponse } = await import("../src/components/ai-elements/message.tsx");
const { ReasoningContent } = await import("../src/components/ai-elements/reasoning.tsx");
const markdown = "```js\nconst answer = 42;\n```";

for (const [name, element] of [
  ["message", createElement(MessageResponse, { children: markdown })],
  ["reasoning", createElement(ReasoningContent, { children: markdown })],
] as const) {
  test(`${name} renders syntax-highlighted code`, async (t) => {
    const ui = await renderUi(element);
    t.after(ui.close);
    const hasHighlight = () => Array.from(
      ui.document.querySelectorAll<HTMLElement>('[data-streamdown="code-block-body"] span[style]')
    ).some((span) => {
      const color = span.style.getPropertyValue("--sdm-c");
      return color !== "" && color !== "inherit";
    });
    for (let attempt = 0; attempt < 100 && !hasHighlight(); attempt++) {
      await act(async () => { await setTimeout(50); });
    }
    assert.match(ui.document.body.textContent ?? "", /const answer = 42;/);
    assert.ok(hasHighlight(), "code block was not syntax-highlighted");
  });
}
