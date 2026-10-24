import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout } from "node:timers/promises";
import { useState } from "react";
import { createTestDatabase } from "./helpers/db.ts";
import { useDatabase } from "./helpers/server.ts";
import { loadUi, renderUi, controls, act, createElement } from "./helpers/ui.ts";
import { chatThreads, chatMessages } from "../src/db/schema.ts";
import { chatStream, completion, embeddings } from "./helpers/provider.ts";

const currentThreadId = "00000000-0000-4000-8000-000000000055";
const common = `import {createElement} from ${JSON.stringify(new URL("../node_modules/react/index.js", import.meta.url).href)};`;
const wrappers = (names: string[]) => common + names.map(name => `export const ${name}=({children})=>children??null;`).join("");
loadUi({
  "next/navigation": `export const useParams=()=>({id:globalThis[Symbol.for('chat-test-thread-id')]??${JSON.stringify(currentThreadId)}});export const useRouter=()=>({push(){}});`,
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
const { default: ChatPage } = await import("../src/app/chat/page.tsx");

test("thread URL changes isolate an active stream and hydrate an empty thread", async (t) => {
  const { db, close } = await createTestDatabase();
  useDatabase(db);
  const [a, b] = await db.insert(chatThreads).values([{ id: currentThreadId, title: "Thread A" }, { title: "Empty thread B" }]).returning();
  await db.insert(chatMessages).values({ threadId: a.id, role: "assistant", content: "HISTORY_A" });
  const { saveAISettings } = await import("../src/actions/settings.ts");
  const config = { provider: "local", baseUrl: "http://provider.invalid/v1", model: "test" } as const;
  await saveAISettings({ chat: config, embedding: config });
  const { GET } = await import("../src/app/api/chats/[id]/route.ts");
  const { POST } = await import("../src/app/api/chat/route.ts");
  const answer = Promise.withResolvers<void>();
  const requests: Array<{ threadId: string; messages: Array<{ parts: Array<{ text?: string }> }> }> = [];
  t.mock.method(globalThis, "fetch", async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
    if (String(url).startsWith("/api/chats/")) return GET(new Request(`http://localhost${url}`), { params: Promise.resolve({ id: String(url).split("/").at(-1)! }) });
    if (String(url) === "/api/chat") {
      requests.push(JSON.parse(String(init?.body)));
      return POST(new Request("http://localhost/api/chat", init));
    }
    const body = JSON.parse(String(init?.body));
    if (String(url).endsWith("/embeddings")) return embeddings(body);
    if (!body.stream) return completion("Thread B");
    await answer.promise;
    return chatStream({ role: "assistant", content: "COMPLETED_ANSWER" }, "stop");
  });
  function Router() {
    const [, setVersion] = useState(0);
    return createElement("div", null,
      createElement("button", { onClick: () => {
        Reflect.set(globalThis, Symbol.for("chat-test-thread-id"), b.id);
        setVersion(version => version + 1);
      } }, "Navigate to B"),
      createElement(ThreadPage),
    );
  }
  const ui = await renderUi(createElement(Router));
  t.after(async () => {
    await act(async () => { answer.resolve(); await setTimeout(100); });
    await ui.close();
    Reflect.deleteProperty(globalThis, Symbol.for("chat-test-thread-id"));
    await close();
  });
  await act(async () => { await setTimeout(30); });
  await ui.change("input[data-chat-input]", "Question for A");
  await ui.click("Send");
  await ui.click("Navigate to B");
  await act(async () => { await setTimeout(30); });
  assert.doesNotMatch(ui.document.body.textContent ?? "", /HISTORY_A|Question for A/);
  await act(async () => { answer.resolve(); await setTimeout(100); });
  assert.doesNotMatch(ui.document.body.textContent ?? "", /COMPLETED_ANSWER/);
  await ui.change("input[data-chat-input]", "Question for B");
  await ui.click("Send");
  await act(async () => { await setTimeout(100); });
  assert.equal(requests[1].threadId, b.id);
  assert.equal(requests[1].messages.length, 1);
  assert.equal(requests[1].messages[0].parts[0].text, "Question for B");
});

for (const page of [ThreadPage, ChatPage]) {
  test(`${page.name} rejects a deleted thread without provider work and retains the draft`, async (t) => {
    const { db, close } = await createTestDatabase();
    t.after(close);
    useDatabase(db);
    const [thread] = await db.insert(chatThreads).values({ id: currentThreadId, title: "Deleted discussion" }).returning();
    const { GET, DELETE } = await import("../src/app/api/chats/[id]/route.ts");
    const { POST } = await import("../src/app/api/chat/route.ts");
    let providerCalls = 0;
    const statuses: number[] = [];
    t.mock.method(globalThis, "fetch", async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
      if (String(url) === "/api/chats") return Response.json({ threads: [thread] });
      if (String(url).startsWith("/api/chats/")) return GET(new Request(`http://localhost${url}`), { params: Promise.resolve({ id: thread.id }) });
      if (String(url) === "/api/chat") {
        const response = await POST(new Request("http://localhost/api/chat", init));
        statuses.push(response.status);
        return response;
      }
      providerCalls++;
      return Response.json({ error: { message: "Unexpected provider call" } }, { status: 400 });
    });
    const ui = await renderUi(createElement(page));
    t.after(ui.close);
    await act(async () => { await setTimeout(30); });
    await DELETE(new Request(`http://localhost/api/chats/${thread.id}`, { method: "DELETE" }), { params: Promise.resolve({ id: thread.id }) });
    await ui.change("input[data-chat-input]", "Keep this draft");
    for (let attempt = 0; attempt < 2; attempt++) {
      await ui.click("Send");
      await act(async () => { await setTimeout(100); });
      assert.match(ui.document.body.textContent ?? "", /This chat was deleted or could not be found/);
      assert.equal(ui.document.querySelector("input[data-chat-input]")?.getAttribute("value"), "Keep this draft");
      assert.equal(ui.document.querySelector("button[type=submit]")?.hasAttribute("disabled"), false);
    }
    assert.deepEqual(statuses, [404, 404]);
    assert.equal(providerCalls, 0);
    assert.deepEqual(await db.select().from(chatThreads), []);
    assert.deepEqual(await db.select().from(chatMessages), []);
  });
}

for (const newChat of [false, true]) {
  test(`${newChat ? "new" : "existing"} chat owns its messages through creation and streaming`, async (t) => {
    const { db, close } = await createTestDatabase();
    t.after(close);
    useDatabase(db);
    const [a, b] = await db.insert(chatThreads).values([{ title: "THREAD_A" }, { title: "THREAD_B" }]).returning();
    await db.insert(chatMessages).values([
      { threadId: a.id, role: "assistant", content: "HISTORY_A" },
      { threadId: b.id, role: "assistant", content: "HISTORY_B" },
    ]);
    const { saveAISettings } = await import("../src/actions/settings.ts");
    const config = { provider: "local", baseUrl: "http://provider.invalid/v1", model: "test" } as const;
    await saveAISettings({ chat: config, embedding: config });
    const { GET } = await import("../src/app/api/chats/[id]/route.ts");
    const { POST } = await import("../src/app/api/chat/route.ts");
    const creation = Promise.withResolvers<void>();
    const answer = Promise.withResolvers<void>();
    t.after(() => { creation.resolve(); answer.resolve(); });
    const requests: Array<{ threadId?: string; messages: Array<{ parts: Array<{ text?: string }> }> }> = [];
    const historyLoads: string[] = [];
    let deletions = 0;
    t.mock.method(globalThis, "fetch", async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
      if (String(url) === "/api/chats") return Response.json({ threads: await db.select().from(chatThreads) });
      if (String(url).startsWith("/api/chats/search")) return Response.json({ suggestions: [b] });
      if (String(url).startsWith("/api/chats/")) {
        if (init?.method === "DELETE") { deletions++; return Response.json({ success: true }); }
        const id = String(url).split("/").at(-1)!;
        historyLoads.push(id);
        return GET(new Request(`http://localhost${url}`), { params: Promise.resolve({ id }) });
      }
      if (String(url) === "/api/chat") {
        const request = JSON.parse(String(init?.body));
        requests.push(request);
        if (request.messages.length === 0) await creation.promise;
        return POST(new Request("http://localhost/api/chat", init));
      }
      const body = JSON.parse(String(init?.body));
      if (String(url).endsWith("/embeddings")) return embeddings(body);
      if (!body.stream) return completion("New discussion");
      if (body.messages.some((message: { content: string }) => message.content === "Question for A")) await answer.promise;
      return chatStream({ role: "assistant", content: body.messages.some((message: { content: string }) => message.content === "Question for B") ? "ANSWER_FOR_B" : "ANSWER_FOR_A" }, "stop");
    });
    const ui = await renderUi(createElement(ChatPage));
    t.after(ui.close);
    await act(async () => { await setTimeout(30); });
    if (newChat) await ui.click("New");
    await ui.change('input[placeholder="Search chats..."]', "THREAD_B");
    await act(async () => { await setTimeout(350); });
    await ui.change("input[data-chat-input]", "Question for A");
    const deleteButton = ui.document.querySelector<HTMLButtonElement>('button[aria-label="Delete"]');
    assert.ok(deleteButton);
    await act(async () => deleteButton.click());
    await ui.click("Send");
    const attemptSwitches = async () => {
      await ui.click("New");
      const bButton = Array.from(ui.document.querySelectorAll("button")).find(button => button.textContent?.startsWith("THREAD_B"));
      assert.ok(bButton);
      await act(async () => bButton.click());
      const suggestion = ui.document.querySelector<HTMLElement>('div[title="THREAD_B"]')?.parentElement?.parentElement;
      if (suggestion) await act(async () => suggestion.click());
      await ui.click("Delete");
      await ui.click("Send");
    };
    await attemptSwitches();
    assert.equal(requests.length, 1);
    assert.equal(ui.document.querySelector("input[data-chat-input]")?.getAttribute("value"), "Question for A");
    await act(async () => { creation.resolve(); await setTimeout(60); });
    await attemptSwitches();
    assert.equal(requests.length, newChat ? 2 : 1);
    assert.equal(deletions, 0);
    assert.ok(!historyLoads.includes(b.id));
    await act(async () => { answer.resolve(); await setTimeout(120); });
    assert.match(ui.document.body.textContent ?? "", /Question for A/);
    assert.match(ui.document.body.textContent ?? "", /ANSWER_FOR_A/);
    const bButton = Array.from(ui.document.querySelectorAll("button")).find(button => button.textContent?.startsWith("THREAD_B"))!;
    await act(async () => { bButton.click(); await setTimeout(30); });
    assert.match(ui.document.body.textContent ?? "", /HISTORY_B/);
    assert.doesNotMatch(ui.document.body.textContent ?? "", /ANSWER_FOR_A/);
    await ui.change("input[data-chat-input]", "Question for B");
    await ui.click("Send");
    await act(async () => { await setTimeout(100); });
    const lastRequest = requests.at(-1)!;
    assert.equal(lastRequest.threadId, b.id);
    assert.ok(!lastRequest.messages.some(message => message.parts.some(part => part.text === "ANSWER_FOR_A")));
    const saved = await db.select().from(chatMessages);
    assert.ok(saved.some(message => message.content === "Question for A"));
    assert.ok(saved.some(message => message.content === "ANSWER_FOR_A"));
  });
}

test("pending and obsolete histories cannot replace an active turn", async (t) => {
  const { db, close } = await createTestDatabase();
  useDatabase(db);
  const [a, b] = await db.insert(chatThreads).values([{ title: "THREAD_A" }, { title: "THREAD_B" }]).returning();
  await db.insert(chatMessages).values([
    { threadId: a.id, role: "assistant", content: "HISTORY_A" },
    { threadId: b.id, role: "assistant", content: "HISTORY_B" },
  ]);
  const { saveAISettings } = await import("../src/actions/settings.ts");
  const config = { provider: "local", baseUrl: "http://provider.invalid/v1", model: "test" } as const;
  await saveAISettings({ chat: config, embedding: config });
  const { GET } = await import("../src/app/api/chats/[id]/route.ts");
  const { POST } = await import("../src/app/api/chat/route.ts");
  const historyA = Promise.withResolvers<void>();
  const historyB = Promise.withResolvers<void>();
  const answer = Promise.withResolvers<void>();
  let requests = 0;
  t.mock.method(globalThis, "fetch", async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
    if (String(url) === "/api/chats") return Response.json({ threads: [a, b] });
    if (String(url).startsWith("/api/chats/")) {
      const id = String(url).split("/").at(-1)!;
      const response = await GET(new Request(`http://localhost${url}`), { params: Promise.resolve({ id }) });
      await (id === a.id ? historyA.promise : historyB.promise);
      return response;
    }
    if (String(url) === "/api/chat") { requests++; return POST(new Request("http://localhost/api/chat", init)); }
    const body = JSON.parse(String(init?.body));
    if (String(url).endsWith("/embeddings")) return embeddings(body);
    await answer.promise;
    return chatStream({ role: "assistant", content: "ANSWER_FOR_B" }, "stop");
  });
  const ui = await renderUi(createElement(ChatPage));
  t.after(async () => {
    await act(async () => { historyA.resolve(); historyB.resolve(); answer.resolve(); await setTimeout(100); });
    await ui.close();
    await close();
  });
  await act(async () => { await setTimeout(30); });
  const bButton = Array.from(ui.document.querySelectorAll("button")).find(button => button.textContent?.startsWith("THREAD_B"))!;
  await act(async () => bButton.click());
  await ui.change("input[data-chat-input]", "Question for B");
  await ui.click("Send");
  assert.equal(requests, 0);
  assert.equal(ui.document.querySelector("button[type=submit]")?.hasAttribute("disabled"), true);
  await act(async () => { historyB.resolve(); await setTimeout(30); });
  await ui.click("Send");
  assert.equal(requests, 1);
  await act(async () => { historyA.resolve(); await setTimeout(30); });
  assert.match(ui.document.body.textContent ?? "", /HISTORY_B/);
  assert.match(ui.document.body.textContent ?? "", /Question for B/);
  assert.doesNotMatch(ui.document.body.textContent ?? "", /HISTORY_A/);
  await act(async () => { answer.resolve(); await setTimeout(100); });
  assert.match(ui.document.body.textContent ?? "", /ANSWER_FOR_B/);
});

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
