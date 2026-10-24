import assert from "node:assert/strict";
import test from "node:test";
import { collections } from "../src/db/schema.ts";
import { createTestDatabase } from "./helpers/db.ts";
import { useDatabase } from "./helpers/server.ts";
import { createElement, loadUi, renderUi, uiOverrides } from "./helpers/ui.ts";

const reactUrl = JSON.stringify(new URL("../node_modules/react/index.js", import.meta.url).href);
loadUi({
  ...uiOverrides,
  "next/navigation": "export const useRouter = () => ({push(){}});",
  "next/image": "export default () => null;",
  "@/hooks/use-toast": "export const useToast = () => ({toast(){}});",
  "@/components/ui/dropdown-menu": `import {createElement} from ${reactUrl};
    export const DropdownMenu = ({children}) => children;
    export const DropdownMenuContent = ({children}) => children;
    export const DropdownMenuItem = ({children,onClick,disabled}) => createElement('button',{onClick,disabled},children);
    export const DropdownMenuTrigger = ({children}) => children;`,
  "@/components/ui/alert-dialog": `import {createElement} from ${reactUrl};
    export const AlertDialog = ({open,children}) => open ? children : null;
    export const AlertDialogAction = ({children,onClick,disabled}) => createElement('button',{onClick,disabled},children);
    ${["AlertDialogCancel", "AlertDialogContent", "AlertDialogDescription", "AlertDialogFooter", "AlertDialogHeader", "AlertDialogTitle"].map(name => `export const ${name} = ({children}) => children;`).join("\n")}`,
  "@/actions/documents": `export const getDocuments = async () => [];
    export const deleteDocument = async () => ({success:true});
    export const updateDocumentFromSource = async () => ({success:true});`,
});

test("clearing a collection description persists through reopening and preserves its other fields", async (t) => {
  const { db, close } = await createTestDatabase();
  useDatabase(db);
  t.after(close);
  const [before] = await db.insert(collections).values({ name: "Reading", description: "Clear me", color: "#123456" }).returning();
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: () => null, setItem() {} } });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, "localStorage", previous);
    else Reflect.deleteProperty(globalThis, "localStorage");
  });
  const { default: LibraryPage } = await import("../src/app/library/page.tsx");
  const ui = await renderUi(createElement(LibraryPage));
  t.after(() => ui.close());
  await ui.click("Rename");
  await ui.change('input[placeholder="Description (optional)"]', "");
  await ui.click("Save");
  const [after] = await db.select().from(collections);
  assert.equal(after.description, "");
  assert.equal(after.name, before.name);
  assert.equal(after.color, before.color);
  await ui.click("Rename");
  assert.equal(ui.document.querySelector<HTMLInputElement>('input[placeholder="Description (optional)"]')?.value, "");
  await ui.change('input[placeholder="Description (optional)"]', "A new description");
  await ui.click("Save");
  assert.equal((await db.select().from(collections))[0].description, "A new description");
});
