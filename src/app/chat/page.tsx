"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import Link from "next/link";
import { Loader2, MessageSquareIcon, Plus, Trash2 } from "lucide-react";
import { Header } from "@/components/layout/header";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
} from "@/components/ai-elements/prompt-input";
import { cn } from "@/lib/utils";


export default function ChatPage() {
  const [threads, setThreads] = useState<
    Array<{
      id: string;
      title: string;
      createdAt: string;
      updatedAt: string;
      lastMessageAt: string;
    }>
  >([]);
  const [threadsLoading, setThreadsLoading] = useState(true);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);

  const [loadedMessages, setLoadedMessages] = useState<
    Array<{ id: string; role: "user" | "assistant"; content: string }>
  >([]);
  const [loadingThread, setLoadingThread] = useState(false);

  const [input, setInput] = useState("");

  const { messages, status, sendMessage, setMessages } = useChat({
    transport: new DefaultChatTransport({
      api: "/api/chat",
    }),
  });

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    let cancelled = false;
    async function loadThreads() {
      try {
        setThreadsLoading(true);
        const res = await fetch("/api/chats");
        if (!res.ok) throw new Error("Failed to load chats");
        const data = (await res.json()) as { threads: typeof threads };
        if (!cancelled) {
          setThreads(data.threads);
          setSelectedThreadId((prev) => prev ?? data.threads[0]?.id ?? null);
        }
      } finally {
        if (!cancelled) setThreadsLoading(false);
      }
    }
    void loadThreads();
    return () => {
      cancelled = true;
    };
  }, []);

  const refreshThreads = async (): Promise<Array<{ id: string; title: string; createdAt: string; updatedAt: string; lastMessageAt: string }>> => {
    const res = await fetch("/api/chats");
    if (!res.ok) throw new Error("Failed to load chats");
    const data = (await res.json()) as { threads: typeof threads };
    setThreads(data.threads);
    return data.threads;
  };

  useEffect(() => {
    let cancelled = false;
    async function loadThread(threadId: string) {
      try {
        setLoadingThread(true);
        const res = await fetch(`/api/chats/${threadId}`);
        if (!res.ok) throw new Error("Failed to load chat");
        const data = (await res.json()) as {
          thread: { id: string; title: string };
          messages: Array<{ id: string; role: string; content: string }>;
        };
        if (cancelled) return;

        const mapped = data.messages.map((m) => ({
          id: m.id,
          role: (m.role === "assistant" ? "assistant" : "user") as "assistant" | "user",
          content: m.content,
        }));
        setLoadedMessages(mapped);
        setMessages(
          mapped.map((m) => ({
            id: m.id,
            role: m.role,
            parts: [{ type: "text", text: m.content }],
          }))
        );
      } finally {
        if (!cancelled) setLoadingThread(false);
      }
    }

    if (selectedThreadId) {
      void loadThread(selectedThreadId);
    } else {
      setLoadedMessages([]);
      setMessages([]);
    }

    return () => {
      cancelled = true;
    };
  }, [selectedThreadId, setMessages]);

  const handleSubmit = async () => {
    const text = input.trim();
    if (!text || status !== "ready") return;
    const currentThreadId = selectedThreadId;

    // If we are starting a brand new chat, create an empty thread first so we can
    // immediately select it in the sidebar.
    let effectiveThreadId = currentThreadId;
    if (!effectiveThreadId) {
      try {
        const createRes = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: [] }),
        });

        const createdId = createRes.headers.get("X-Chat-Thread-Id");
        if (createdId) {
          effectiveThreadId = createdId;
          setSelectedThreadId(createdId);
          await refreshThreads();
        }
      } catch {
        // ignore; fallback to server-side creation during sendMessage
      }
    }

    await sendMessage(
      { text },
      {
        body: effectiveThreadId ? { threadId: effectiveThreadId } : undefined,
      }
    );

    setInput("");
  };

  const selectedThread = useMemo(
    () => threads.find((t) => t.id === selectedThreadId) ?? null,
    [threads, selectedThreadId]
  );

  const startNewChat = () => {
    setSelectedThreadId(null);
    setLoadedMessages([]);
    setMessages([]);
  };

  const deleteThread = async (id: string) => {
    await fetch(`/api/chats/${id}`, { method: "DELETE" });
    const nextThreads = threads.filter((t) => t.id !== id);
    setThreads(nextThreads);
    if (selectedThreadId === id) {
      setSelectedThreadId(nextThreads[0]?.id ?? null);
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      <Header />

      <main className="flex-1 container mx-auto px-4 py-6">
        <div className="grid grid-cols-1 md:grid-cols-[280px_1fr] gap-4">
          <aside className="rounded-lg border bg-card">
            <div className="p-3 border-b flex items-center justify-between">
              <div className="text-sm font-semibold">Chats</div>
              <Button size="sm" variant="secondary" onClick={startNewChat}>
                <Plus className="h-4 w-4 mr-2" />
                New
              </Button>
            </div>

            <ScrollArea className="h-[60vh]">
              <div className="p-2">
                {threadsLoading ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground p-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading...
                  </div>
                ) : threads.length === 0 ? (
                  <div className="text-sm text-muted-foreground p-2">No chats yet</div>
                ) : (
                  <div className="flex flex-col gap-1">
                    {threads.map((t) => (
                      <div
                        key={t.id}
                        className={cn(
                          "flex items-center gap-2 rounded-md px-2 py-2",
                          t.id === selectedThreadId ? "bg-secondary" : "hover:bg-accent"
                        )}
                      >
                        <button
                          className="flex-1 text-left min-w-0"
                          onClick={() => setSelectedThreadId(t.id)}
                          type="button"
                        >
                          <div className="text-sm font-medium truncate">{t.title}</div>
                        </button>
                        <Link href={`/chat/${t.id}`} className="shrink-0">
                          <Button size="icon-sm" variant="ghost" aria-label="Open">
                            <MessageSquareIcon className="h-4 w-4" />
                          </Button>
                        </Link>
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          onClick={() => void deleteThread(t.id)}
                          aria-label="Delete"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </ScrollArea>
          </aside>

          <section className="rounded-lg border bg-card p-3 flex flex-col gap-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h1 className="text-lg font-semibold">{selectedThread?.title ?? "New chat"}</h1>
                <p className="text-xs text-muted-foreground">
                  {selectedThreadId ? "Saved conversation" : "Start a new conversation"}
                </p>
              </div>
            </div>

            <Conversation className="rounded-lg border h-[60vh]">
              <ConversationContent>
                {loadingThread ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground p-4">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading chat...
                  </div>
                ) : messages.length === 0 ? (
                  <ConversationEmptyState
                    title="No messages yet"
                    description="Ask something to start a conversation"
                    icon={<MessageSquareIcon className="size-6" />}
                  />
                ) : (
                  messages.map((m) => (
                    <Message from={m.role} key={m.id}>
                      <MessageContent>
                        {m.parts.map((part, i) => {
                          if (part.type === "text") {
                            return (
                              <MessageResponse key={`${m.id}-text-${i}`}>
                                {part.text}
                              </MessageResponse>
                            );
                          }
                          return null;
                        })}
                      </MessageContent>
                    </Message>
                  ))
                )}
              </ConversationContent>
              <ConversationScrollButton />
            </Conversation>

            <PromptInput
              onSubmit={async () => {
                await handleSubmit();
              }}
              className="w-full"
            >
              <PromptInputBody>
                <PromptInputTextarea value={input} onChange={(e) => setInput(e.target.value)} />
              </PromptInputBody>
              <PromptInputFooter>
                <PromptInputSubmit disabled={!input.trim() || status !== "ready"} />
              </PromptInputFooter>
            </PromptInput>
          </section>
        </div>
      </main>
    </div>
  );
}
