import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout } from "node:timers/promises";
import { createTestDatabase } from "./helpers/db.ts";
import { useDatabase } from "./helpers/server.ts";
import { loadUi, renderUi, controls, act, createElement } from "./helpers/ui.ts";
import { chatThreads, chatMessages } from "../src/db/schema.ts";
import { embeddings } from "./helpers/provider.ts";

const currentThreadId = "00000000-0000-4000-8000-000000000055";
const common = `import {createElement} from ${JSON.stringify(new URL("../node_modules/react/index.js", import.meta.url).href)};`;
const wrappers = (names: string[]) => common + names.map(name => `export const ${name}=({children})=>children??null;`).join("");
loadUi({
  "next/navigation": `export const useParams=()=>({id:${JSON.stringify(currentThreadId)}});export const useRouter=()=>({push(){}});`,
  "@/components/chat/chat-sources": "export const ChatSources=()=>null;",
  "@/components/ui/button": controls,
  "@/components/ui/input": controls,
  "@/components/ui/select": controls,
  "@/components/ui/scroll-area": wrappers(["ScrollArea"]),
  "@/components/ui/dropdown-menu": wrappers(["DropdownMenu", "DropdownMenuContent", "DropdownMenuItem", "DropdownMenuTrigger"]),
  "@/components/ui/alert": wrappers(["Alert", "AlertDescription", "AlertTitle"]),
  "@/components/ui/alert-dialog": wrappers(["AlertDialog", "AlertDialogAction", "AlertDialogCancel", "AlertDialogContent", "AlertDialogDescription", "AlertDialogFooter", "AlertDialogHeader", "AlertDialogTitle"]),
  "@/components/ai-elements/conversation": wrappers(["Conversation", "ConversationContent", "ConversationEmptyState", "ConversationScrollButton"]),
  "@/components/ai-elements/message": wrappers(["Message", "MessageContent", "MessageResponse"]),
  "@/components/ai-elements/prompt-input": common + `export const PromptInput=({children,onSubmit})=>createElement('form',{onSubmit:e=>{e.preventDefault();onSubmit();}},children);export const PromptInputBody=({children})=>children;export const PromptInputFooter=({children})=>children;export const PromptInputTextarea=props=>createElement('input',{'data-chat-input':true,...props});export const PromptInputSubmit=({disabled})=>createElement('button',{type:'submit',disabled},'Send');`,
});
const { default: ThreadPage } = await import("../src/app/chat/[id]/page.tsx");
const { default: ChatPage } = await import("../src/app/chat/page.tsx");

for (const page of [ThreadPage, ChatPage]) {
  for (const failure of ["provider", "transport", "starter"]) {
    if (failure === "starter" && page !== ThreadPage) continue;
    test(`${page.name} retains failed draft and permits retry after ${failure} error`, async (t) => {
      const { db, close } = await createTestDatabase();
      t.after(close);
      useDatabase(db);
      const [thread] = await db.insert(chatThreads).values({ id: currentThreadId, title: "Retry discussion", category: failure === "starter" ? "document" : "general" }).returning();
      if (failure === "starter") await db.insert(chatMessages).values({ threadId: thread.id, role: "assistant", content: "Welcome" });
      const { saveAISettings } = await import("../src/actions/settings.ts");
      const config = { provider: "local", baseUrl: "http://provider.invalid/v1", model: "test" } as const;
      await saveAISettings({ chat: config, embedding: config });
      const { GET } = await import("../src/app/api/chats/[id]/route.ts");
      const { POST } = await import("../src/app/api/chat/route.ts");
      let chatRequests = 0;
      const retry = Promise.withResolvers<void>();
      const finishRetry = Promise.withResolvers<void>();
      t.after(() => { retry.resolve(); finishRetry.resolve(); });
      t.mock.method(globalThis, "fetch", async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
        if (String(url) === "/api/chats") return Response.json({ threads: [thread] });
        if (String(url).startsWith("/api/chats/")) return GET(new Request(`http://localhost${url}`), { params: Promise.resolve({ id: thread.id }) });
        if (String(url) === "/api/chat") {
          chatRequests++;
          if (failure === "transport" && chatRequests === 1) throw new TypeError("Network fetch failed");
          return POST(new Request("http://localhost/api/chat", init));
        }
        const body = JSON.parse(String(init?.body));
        if (String(url).endsWith("/embeddings")) return embeddings(body);
        if (chatRequests === 1) return Response.json({ error: { message: "Provider temporarily unavailable", type: "server_error" } }, { status: 400 });
        await retry.promise;
        return new Response(new ReadableStream({ async start(controller) {
          const emit = (content: string | null, finishReason: string | null = null) => controller.enqueue(new TextEncoder().encode(
            `data: ${JSON.stringify({ id: "test", model: "test", created: 0, choices: [{ index: 0, delta: { content }, finish_reason: finishReason }] })}\n\n`
          ));
          emit("Recovered answer.");
          await finishRetry.promise;
          emit(null, "stop");
          controller.close();
        } }), { headers: { "Content-Type": "text/event-stream" } });
      });
      const ui = await renderUi(createElement(page));
      t.after(ui.close);
      await act(async () => { await setTimeout(30); });
      const starterButton = Array.from(ui.document.querySelectorAll("button")).find(button => button.textContent?.startsWith("Summarize the key points"));
      const initialDraft = failure === "starter" ? "Summarize the key points from Retry discussion" : "Hello";
      await ui.change("input[data-chat-input]", initialDraft);
      if (failure === "starter") {
        assert.ok(starterButton);
        await act(async () => starterButton.click());
      } else await ui.click("Send");
      await act(async () => { await setTimeout(100); });
      assert.match(ui.document.body.textContent ?? "", failure !== "transport" ? /Provider temporarily unavailable/ : /provider could not be reached/);
      assert.equal(ui.document.querySelector("input[data-chat-input]")?.getAttribute("value"), initialDraft);
      await ui.change("input[data-chat-input]", "Try again");
      assert.match(ui.document.body.textContent ?? "", failure !== "transport" ? /Provider temporarily unavailable/ : /provider could not be reached/);
      assert.equal(ui.document.querySelector("button[type=submit]")?.hasAttribute("disabled"), false);
      if (failure === "starter" && starterButton) await act(async () => starterButton.click());
      else await ui.click("Send");
      assert.equal(chatRequests, 2);
      assert.equal(ui.document.querySelector("button[type=submit]")?.hasAttribute("disabled"), true);
      assert.equal(ui.document.querySelector("input[data-chat-input]")?.hasAttribute("disabled"), true);
      await ui.click("Send");
      assert.equal(chatRequests, 2);
      await act(async () => { retry.resolve(); await setTimeout(100); });
      assert.match(ui.document.body.textContent ?? "", /Recovered answer/);
      assert.equal(ui.document.querySelector("button[type=submit]")?.hasAttribute("disabled"), true);
      assert.equal(ui.document.querySelector("input[data-chat-input]")?.hasAttribute("disabled"), true);
      if (starterButton) {
        assert.equal(starterButton.disabled, true);
        await act(async () => starterButton.click());
      }
      await ui.click("Send");
      assert.equal(chatRequests, 2);
      await act(async () => { finishRetry.resolve(); await setTimeout(100); });
      assert.equal(ui.document.querySelector("input[data-chat-input]")?.getAttribute("value"), "");
      assert.equal(ui.document.querySelector("input[data-chat-input]")?.hasAttribute("disabled"), false);
    });
  }
}
