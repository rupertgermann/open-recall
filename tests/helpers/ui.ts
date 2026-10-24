import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { act, createElement, type ReactNode } from "react";
import ts from "typescript";
import "./server.ts";

export function loadUi(overrides: Record<string, string> = {}) {
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      const source = overrides[specifier];
      if (source) return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true };
      if (specifier === "@/components/layout/header") {
        return { url: "data:text/javascript,export const Header = () => null", shortCircuit: true };
      }
      if (specifier === "next/link") {
        return { url: "data:text/javascript,export default ({children}) => children", shortCircuit: true };
      }
      return nextResolve(specifier, context);
    },
    load(url, context, nextLoad) {
      if (url.endsWith(".tsx")) {
        return {
          format: "module",
          shortCircuit: true,
          source: ts.transpileModule(readFileSync(fileURLToPath(url), "utf8"), {
            compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
          }).outputText,
        };
      }
      return nextLoad(url, context);
    },
  });
  return hooks;
}

export async function renderUi(element: ReactNode) {
  const dom = new JSDOM("<!doctype html><html><body><div id='app'></div></body></html>", { url: "http://localhost" });
  const previous = { window: Object.getOwnPropertyDescriptor(globalThis, "window"), document: Object.getOwnPropertyDescriptor(globalThis, "document"), IS_REACT_ACT_ENVIRONMENT: Object.getOwnPropertyDescriptor(globalThis, "IS_REACT_ACT_ENVIRONMENT") };
  let closed = false;
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const { createRoot } = await import("react-dom/client");
  const root = createRoot(dom.window.document.getElementById("app")!);
  await act(async () => root.render(element));
  return {
    document: dom.window.document,
    async click(label: string) {
      const button = Array.from(dom.window.document.querySelectorAll("button")).find((button) => button.textContent === label);
      if (!button) throw new Error(`Missing button: ${label}`);
      await act(async () => button.click());
    },
    async change(selector: string, value: string) {
      const input = dom.window.document.querySelector(selector);
      if (!(input instanceof dom.window.HTMLInputElement)) throw new Error(`Missing input: ${selector}`);
      await act(async () => {
        Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!.call(input, value);
        input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
      });
    },
    async close() {
      if (closed) return;
      closed = true;
      await act(async () => root.unmount());
      dom.window.close();
      for (const [key, descriptor] of Object.entries(previous)) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
      }
    },
  };
}

// Keep button and input events real while leaving Radix layout outside these lifecycle tests.
export const controls = `
import { createElement } from ${JSON.stringify(new URL("../../node_modules/react/index.js", import.meta.url).href)};
export const Button = ({children, onClick, disabled}) => createElement('button', {onClick, disabled}, children);
export const Input = ({children, ...props}) => createElement('input', props);
export const Card = ({children}) => createElement('section', null, children);
export const CardContent = ({children}) => children;
export const CardDescription = ({children}) => children;
export const CardHeader = ({children}) => children;
export const CardTitle = ({children}) => children;
export const Badge = ({children}) => children;
export const Select = ({children}) => children;
export const SelectContent = ({children}) => children;
export const SelectItem = () => null;
export const SelectTrigger = () => null;
export const SelectValue = () => null;
`;

export const uiOverrides = Object.fromEntries(
  ["button", "input", "card", "badge", "select"].map((name) => [`@/components/ui/${name}`, controls])
);

export { act, createElement };
