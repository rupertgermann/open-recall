"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import Link from "next/link";
import { Loader2, MessageSquareIcon, Plus, Trash2, Filter, Search } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { ChatUIMessage, ChatMessageMetadata } from "@/lib/chat/types";
import { ChatSources } from "@/components/chat/chat-sources";
import { Header } from "@/components/layout/header";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
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

const chatTransport = new DefaultChatTransport({ api: "/api/chat" });

export default function ChatPage() {
  const [threads, setThreads] = useState<
    Array<{
      id: string;
      title: string;
      category: string;
      entityId?: string;
      documentId?: string;
      createdAt: string;
      updatedAt: string;
      lastMessageAt: string;
    }>
  >([]);
  const [threadsLoading, setThreadsLoading] = useState(true);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [searchSuggestions, setSearchSuggestions] = useState<typeof threads>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);

  const [loadedMessages, setLoadedMessages] = useState<
    Array<{ id: string; role: "user" | "assistant"; content: string }>
  >([]);
  const [loadingThread, setLoadingThread] = useState(false);

  const [input, setInput] = useState("");

  const { messages, status, sendMessage, setMessages } = useChat<ChatUIMessage>({
    transport: chatTransport,
  });

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Debounced search function
  const searchTimeoutRef = useRef<NodeJS.Timeout>();
  
  const fetchSearchSuggestions = async (query: string) => {
    if (query.length < 2) {
      setSearchSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    try {
      const url = categoryFilter === "all" 
        ? `/api/chats/search?q=${encodeURIComponent(query)}`
        : `/api/chats/search?q=${encodeURIComponent(query)}&category=${categoryFilter}`;
      
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        setSearchSuggestions(data.suggestions);
        setShowSuggestions(true);
      }
    } catch (error) {
      console.error("Failed to fetch search suggestions:", error);
      setSearchSuggestions([]);
      setShowSuggestions(false);
    }
  };

  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
    
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }
    
    searchTimeoutRef.current = setTimeout(() => {
      fetchSearchSuggestions(value);
    }, 300);
  };

  const selectSuggestion = (thread: typeof threads[0]) => {
    setSelectedThreadId(thread.id);
    setSearchQuery("");
    setShowSuggestions(false);
    setSearchSuggestions([]);
  };

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
        const url = categoryFilter === "all" ? "/api/chats" : `/api/chats?category=${categoryFilter}`;
        const res = await fetch(url);
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
  }, [categoryFilter]);

  const refreshThreads = async (): Promise<Array<{ id: string; title: string; category: string; entityId?: string; documentId?: string; createdAt: string; updatedAt: string; lastMessageAt: string }>> => {
    const url = categoryFilter === "all" ? "/api/chats" : `/api/chats?category=${categoryFilter}`;
    const res = await fetch(url);
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
          messages: Array<{ id: string; role: string; content: string; metadata?: unknown }>;
        };
        if (cancelled) return;

        const mapped = data.messages.map((m) => ({
          id: m.id,
          role: (m.role === "assistant" ? "assistant" : "user") as "assistant" | "user",
          content: m.content,
        }));
        setLoadedMessages(mapped);
        setMessages(
          data.messages.map((m) => ({
            id: m.id,
            role: (m.role === "assistant" ? "assistant" : "user") as "assistant" | "user",
            parts: [{ type: "text" as const, text: m.content }],
            metadata: (m.metadata as ChatMessageMetadata) ?? undefined,
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

  const startNewChat = async (category?: string, entityId?: string, documentId?: string) => {
    if (category && (entityId || documentId)) {
      // Create a context-specific chat
      try {
        const res = await fetch("/api/chats/context", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ category, entityId, documentId }),
        });
        
        if (res.ok) {
          const { thread } = await res.json();
          setSelectedThreadId(thread.id);
          await refreshThreads();
          return;
        }
      } catch (error) {
        console.error("Failed to create context-specific chat:", error);
      }
    }
    
    // Fallback to general chat
    setSelectedThreadId(null);
    setLoadedMessages([]);
    setMessages([]);
  };

  const [threadToDelete, setThreadToDelete] = useState<string | null>(null);

  const confirmDeleteThread = async () => {
    if (!threadToDelete) return;
    await fetch(`/api/chats/${threadToDelete}`, { method: "DELETE" });
    const nextThreads = threads.filter((t) => t.id !== threadToDelete);
    setThreads(nextThreads);
    if (selectedThreadId === threadToDelete) {
      setSelectedThreadId(nextThreads[0]?.id ?? null);
    }
    setThreadToDelete(null);
  };

  return (
    <div className="min-h-screen flex flex-col">
      <Header />

      <main className="flex-1 container mx-auto px-4 py-6">
        <div className="grid grid-cols-1 md:grid-cols-[380px_1fr] gap-4">
          <aside className="rounded-lg border bg-card">
            <div className="p-3 border-b flex items-center justify-between">
              <div className="text-sm font-semibold">Chats</div>
              <Button size="sm" variant="secondary" onClick={() => startNewChat()}>
                <Plus className="h-4 w-4 mr-2" />
                New
              </Button>
            </div>

            <div className="p-3 border-b">
              <div className="flex items-center gap-2">
                <Filter className="h-4 w-4 text-muted-foreground" />
                <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                  <SelectTrigger className="flex-1">
                    <SelectValue placeholder="Filter by category" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Chats</SelectItem>
                    <SelectItem value="general">General</SelectItem>
                    <SelectItem value="entity">Entity-specific</SelectItem>
                    <SelectItem value="document">Doc-specific</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="p-3 border-b relative">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search chats..."
                  value={searchQuery}
                  onChange={(e) => handleSearchChange(e.target.value)}
                  onFocus={() => searchQuery.length >= 2 && setShowSuggestions(true)}
                  onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                  className="pl-10"
                />
              </div>
              
              {showSuggestions && searchSuggestions.length > 0 && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-background border rounded-md shadow-lg z-10 max-h-60 overflow-y-auto">
                  {searchSuggestions.map((suggestion) => (
                    <div
                      key={suggestion.id}
                      className="p-2 hover:bg-accent cursor-pointer border-b last:border-b-0"
                      onClick={() => selectSuggestion(suggestion)}
                    >
                      <div className="flex items-center gap-2">
                        <div className="text-sm font-medium truncate max-w-[180px]" title={suggestion.title}>
                          {suggestion.title.length > 25 ? `${suggestion.title.slice(0, 25)}...` : suggestion.title}
                        </div>
                        <div className={cn(
                          "text-xs px-1.5 py-0.5 rounded flex-shrink-0",
                          suggestion.category === "general" && "bg-blue-100 text-blue-700",
                          suggestion.category === "entity" && "bg-green-100 text-green-700", 
                          suggestion.category === "document" && "bg-orange-100 text-orange-700"
                        )}>
                          {suggestion.category === "general" && "General"}
                          {suggestion.category === "entity" && "Entity"}
                          {suggestion.category === "document" && "Doc"}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <ScrollArea className="h-[75vh]">
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
                          <div className="flex items-center gap-2">
                            <div className="text-sm font-medium truncate max-w-[180px]" title={t.title}>
                              {t.title.length > 25 ? `${t.title.slice(0, 25)}...` : t.title}
                            </div>
                            <div className={cn(
                              "text-xs px-1.5 py-0.5 rounded flex-shrink-0",
                              t.category === "general" && "bg-blue-100 text-blue-700",
                              t.category === "entity" && "bg-green-100 text-green-700", 
                              t.category === "document" && "bg-orange-100 text-orange-700"
                            )}>
                              {t.category === "general" && "General"}
                              {t.category === "entity" && "Entity"}
                              {t.category === "document" && "Doc"}
                            </div>
                          </div>
                        </button>
                        <Link href={`/chat/${t.id}`} className="shrink-0">
                          <Button size="icon-sm" variant="ghost" aria-label="Open">
                            <MessageSquareIcon className="h-4 w-4" />
                          </Button>
                        </Link>
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          onClick={() => setThreadToDelete(t.id)}
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
                      {m.role === "assistant" && m.metadata && (
                        <ChatSources
                          sources={(m.metadata as ChatMessageMetadata).sources}
                          entities={(m.metadata as ChatMessageMetadata).entities}
                        />
                      )}
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
        {/* Delete Thread Confirm Dialog */}
        <AlertDialog open={!!threadToDelete} onOpenChange={(open) => !open && setThreadToDelete(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete chat?</AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently delete this chat thread and all its messages.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={(e) => {
                  e.preventDefault();
                  confirmDeleteThread();
                }}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </main>
    </div>
  );
}
