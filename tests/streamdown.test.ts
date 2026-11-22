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

async function waitFor(check: () => boolean, message: string) {
  for (let attempt = 0; attempt < 100 && !check(); attempt++) {
    await act(async () => { await setTimeout(50); });
  }
  assert.ok(check(), message);
}

test("chat messages render math and offer diagram controls for Mermaid fences", async (t) => {
  // JSDOM has no viewport. Leave the diagram offscreen while testing its controls.
  if (!("IntersectionObserver" in globalThis)) {
    Object.defineProperty(globalThis, "IntersectionObserver", {
      configurable: true,
      value: class { observe() {} disconnect() {} },
    });
    t.after(() => { Reflect.deleteProperty(globalThis, "IntersectionObserver"); });
  }
  const children = "$$\nx^2\n$$\n\n```mermaid\nflowchart LR\n  A --> B\n```";
  const ui = await renderUi(createElement(MessageResponse, { children }));
  t.after(ui.close);
  assert.equal(ui.document.querySelector("math msup")?.textContent, "x2");
  await waitFor(
    () => ui.document.querySelector('button[aria-label="Download diagram"]') !== null,
    "Mermaid diagram controls did not appear"
  );
});

test("chat footnote links point to the note and back to its reference", async (t) => {
  const children = "A fact[^source].\n\n[^source]: A source.";
  const ui = await renderUi(createElement(MessageResponse, { children }));
  t.after(ui.close);

  const reference = ui.document.querySelector("a[data-footnote-ref]");
  const backlink = ui.document.querySelector("a[data-footnote-backref]");
  assert.ok(reference?.id && backlink);
  assert.equal(backlink.getAttribute("href"), `#${reference.id}`);
  const note = backlink.closest("li");
  assert.ok(note?.id);
  assert.equal(reference.getAttribute("href"), `#${note.id}`);
});

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
    await waitFor(hasHighlight, "code block was not syntax-highlighted");
    assert.match(ui.document.body.textContent ?? "", /const answer = 42;/);
  });
}
