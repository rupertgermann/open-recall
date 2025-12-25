"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { Header } from "@/components/layout/header";
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
import { Button } from "@/components/ui/button";
import { Loader2, MessageSquareIcon, Trash2, ArrowLeft } from "lucide-react";
import Link from "next/link";

type LoadedChat = {
  thread: {
    id: string;
    title: string;
    category: string;
    entityId: string | null;
    documentId: string | null;
    createdAt: string;
    updatedAt: string;
    lastMessageAt: string;
  };
  messages: Array<{
    id: string;
    role: string;
    content: string;
    createdAt: string;
    metadata: unknown;
  }>;
};

function toUIMessages(rows: LoadedChat["messages"]): UIMessage[] {
  return rows.map((m) => ({
    id: m.id,
    role: m.role === "assistant" ? "assistant" : "user",
    parts: [{ type: "text", text: m.content }],
  }));
}

export default function ChatThreadPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const threadId = params.id;

  const [loaded, setLoaded] = useState<LoadedChat | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        setError(null);
        const res = await fetch(`/api/chats/${threadId}`);
        if (!res.ok) {
          throw new Error(`Failed to load chat (${res.status})`);
        }
        const data = (await res.json()) as LoadedChat;
        if (!cancelled) setLoaded(data);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    if (threadId) void load();

    return () => {
      cancelled = true;
    };
  }, [threadId]);

  const initialMessages = useMemo(() => {
    if (!loaded) return [];
    return toUIMessages(loaded.messages);
  }, [loaded]);

  const { messages, status, sendMessage, setMessages } = useChat({
    transport: new DefaultChatTransport({
      api: "/api/chat",
    }),
    messages: initialMessages,
  });

  useEffect(() => {
    if (initialMessages.length > 0) {
      setMessages(initialMessages);
    }
  }, [initialMessages, setMessages]);

  const [text, setText] = useState("");

  const handleSubmit = async () => {
    const trimmed = text.trim();
    if (!trimmed || status !== "ready") return;

    await sendMessage(
      { text: trimmed },
      {
        body: {
          threadId,
        },
      }
    );
    setText("");
  };

  const handleDelete = async () => {
    await fetch(`/api/chats/${threadId}`, { method: "DELETE" });
    router.push("/chat");
  };

  return (
    <div className="min-h-screen flex flex-col">
      <Header />

      <main className="flex-1 container mx-auto px-4 py-6 max-w-5xl">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2">
              {loaded?.thread.category !== "general" && (
                <Link href={loaded?.thread.category === "entity" ? "/graph" : "/library"}>
                  <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground">
                    <ArrowLeft className="h-4 w-4 mr-1" />
                    Back to {loaded?.thread.category === "entity" ? "graph" : "library"}
                  </Button>
                </Link>
              )}
            </div>
            <h1 className="text-2xl font-bold">{loaded?.thread.title ?? "Chat"}</h1>
            <p className="text-sm text-muted-foreground">Saved conversation</p>
          </div>
          <Button variant="outline" size="sm" onClick={handleDelete}>
            <Trash2 className="h-4 w-4 mr-2" />
            Delete
          </Button>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading chat...
          </div>
        ) : error ? (
          <div className="text-sm text-destructive">{error}</div>
        ) : (
          <div className="flex flex-col gap-4">
            <Conversation className="rounded-lg border h-[60vh]">
              <ConversationContent>
                {messages.length === 0 ? (
                  <ConversationEmptyState
                    title="No messages"
                    description="Start chatting to see messages here"
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
                <PromptInputTextarea value={text} onChange={(e) => setText(e.target.value)} />
              </PromptInputBody>
              <PromptInputFooter>
                <PromptInputSubmit disabled={!text.trim() || status !== "ready"} />
              </PromptInputFooter>
            </PromptInput>
          </div>
        )}
      </main>
    </div>
  );
}
