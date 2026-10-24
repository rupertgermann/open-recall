import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout } from "node:timers/promises";
import { createTestDatabase } from "./helpers/db.ts";
import { useDatabase } from "./helpers/server.ts";
import { loadUi, renderUi, controls, act, createElement } from "./helpers/ui.ts";
import { chatThreads, chatMessages } from "../src/db/schema.ts";

const currentThreadId = "00000000-0000-4000-8000-000000000055";
const common = `import {createElement} from ${JSON.stringify(new URL("../node_modules/react/index.js", import.meta.url).href)};`;
const wrappers = (names: string[]) => common + names.map(name => `export const ${name}=({children})=>children??null;`).join("");
loadUi({
  "next/navigation": `export const useParams=()=>({id:globalThis[Symbol.for('chat-test-thread-id')]??${JSON.stringify(currentThreadId)}});export const useRouter=()=>({push(url){globalThis[Symbol.for('delete-test-navigation')]=url;}});`,
  "@/components/chat/chat-sources": "export const ChatSources=()=>null;",
  "@/components/ui/button": common + `export const Button=({children,onClick,disabled,...props})=>createElement('button',{'aria-label':props['aria-label'],onClick,disabled},children);`,
  "@/components/ui/input": controls,
  "@/components/ui/select": controls,
  "@/components/ui/scroll-area": wrappers(["ScrollArea"]),
  "@/components/ui/dropdown-menu": wrappers(["DropdownMenu", "DropdownMenuContent", "DropdownMenuItem", "DropdownMenuTrigger"]),
  "@/components/ui/alert": wrappers(["Alert", "AlertDescription", "AlertTitle"]),
  "@/components/ui/alert-dialog": wrappers(["AlertDialog", "AlertDialogCancel", "AlertDialogContent", "AlertDialogDescription", "AlertDialogFooter", "AlertDialogHeader", "AlertDialogTitle"]) + `export const AlertDialogAction=({children,onClick,disabled})=>createElement('button',{onClick,disabled},children);`,
  "@/components/ai-elements/conversation": wrappers(["Conversation", "ConversationContent", "ConversationEmptyState", "ConversationScrollButton"]),
  "@/components/ai-elements/message": wrappers(["Message", "MessageContent", "MessageResponse"]),
  "@/components/ai-elements/prompt-input": common + `export const PromptInput=({children,onSubmit})=>createElement('form',{onSubmit:e=>{e.preventDefault();onSubmit();}},children);export const PromptInputBody=({children})=>children;export const PromptInputFooter=({children})=>children;export const PromptInputTextarea=props=>createElement('input',{'data-chat-input':true,...props});export const PromptInputSubmit=({disabled})=>createElement('button',{type:'submit',disabled},'Send');`,
});
const { default: ThreadPage } = await import("../src/app/chat/[id]/page.tsx");

test("failed thread deletion preserves messages and draft, then permits a successful retry", async (t) => {
  const database = await createTestDatabase();
  useDatabase(database.db);
  t.after(database.close);
  t.after(() => { Reflect.deleteProperty(globalThis, Symbol.for("delete-test-navigation")); });
  await database.db.insert(chatThreads).values({ id: currentThreadId, title: "Preserved conversation" });
  await database.db.insert(chatMessages).values({ threadId: currentThreadId, role: "assistant", content: "Saved answer" });
  const { GET, DELETE } = await import("../src/app/api/chats/[id]/route.ts");
  let attempt = 0;
  t.mock.method(globalThis, "fetch", async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const context = { params: Promise.resolve({ id: currentThreadId }) };
    const request = new Request(`http://localhost${url}`, init);
    if (init?.method !== "DELETE") return GET(request, context);
    attempt++;
    if (attempt === 1) return Response.json({ error: "Database unavailable" }, { status: 500 });
    if (attempt === 2) throw new Error("Network unavailable");
    return DELETE(request, context);
  });
  const ui = await renderUi(createElement(ThreadPage));
  t.after(ui.close);
  await act(async () => { await setTimeout(30); });
  await ui.change("input[data-chat-input]", "Keep my draft");
  const confirmDelete = () => act(async () => {
    Array.from(ui.document.querySelectorAll("button")).filter(button => button.textContent === "Delete").at(-1)!.click();
  });
  await confirmDelete();
  assert.match(ui.document.body.textContent ?? "", /Failed to delete chat \(500\)/);
  await confirmDelete();
  assert.match(ui.document.body.textContent ?? "", /Network unavailable/);
  assert.match(ui.document.body.textContent ?? "", /Preserved conversation/);
  assert.match(ui.document.body.textContent ?? "", /Saved answer/);
  assert.equal(ui.document.querySelector<HTMLInputElement>("input[data-chat-input]")?.value, "Keep my draft");
  assert.equal(Reflect.get(globalThis, Symbol.for("delete-test-navigation")), undefined);
  assert.equal((await database.db.select().from(chatMessages)).length, 1);
  await confirmDelete();
  assert.equal(Reflect.get(globalThis, Symbol.for("delete-test-navigation")), "/chat");
  assert.equal((await database.db.select().from(chatThreads)).length, 0);
  assert.equal((await database.db.select().from(chatMessages)).length, 0);
});
