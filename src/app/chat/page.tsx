"use client";

import { useRef, useEffect, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { Send, Loader2, Bot, User, Sparkles, Network, Trash2 } from "lucide-react";
import { Header } from "@/components/layout/header";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";


export default function ChatPage() {
  const [input, setInput] = useState("");
  const { messages, status, sendMessage, setMessages } = useChat({
    transport: new DefaultChatTransport({
      api: "/api/chat",
    }),
    messages: [
      {
        id: "welcome",
        role: "assistant",
        parts: [
          {
            type: "text",
            text: "Hello! I'm your knowledge assistant. Ask me anything about your saved content, and I'll use both semantic search and your knowledge graph to find relevant information.",
          },
        ],
      },
    ],
  });
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const clearChat = () => {
    setMessages([
      {
        id: "welcome",
        role: "assistant",
        parts: [
          {
            type: "text",
            text: "Hello! I'm your knowledge assistant. Ask me anything about your saved content, and I'll use both semantic search and your knowledge graph to find relevant information.",
          },
        ],
      },
    ]);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSubmit(e as unknown as React.FormEvent<HTMLFormElement>);
    }
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || status !== "ready") return;
    await sendMessage({ text });
    setInput("");
  };

  return (
    <div className="min-h-screen flex flex-col">
      <Header />

      <main className="flex-1 container mx-auto px-4 py-6 flex flex-col max-w-4xl">
        {/* Header with clear button */}
        <div className="flex justify-between items-center mb-4">
          <div>
            <h1 className="text-2xl font-bold">Chat</h1>
            <p className="text-sm text-muted-foreground">Ask questions about your knowledge base</p>
          </div>
          <Button variant="outline" size="sm" onClick={clearChat}>
            <Trash2 className="h-4 w-4 mr-2" />
            Clear
          </Button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto space-y-4 pb-4">
          {messages.map((message) => (
            <div
              key={message.id}
              className={cn(
                "flex gap-3",
                String(message.role) === "user" ? "justify-end" : "justify-start"
              )}
            >
              {String(message.role) === "assistant" && (
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                  <Bot className="h-5 w-5 text-primary" />
                </div>
              )}

              <div
                className={cn(
                  "max-w-[80%] rounded-lg px-4 py-3",
                  String(message.role) === "user"
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted"
                )}
              >
                <div className="whitespace-pre-wrap">
                  {message.parts.map((part, i) => {
                    if (part.type === "text") {
                      return <p key={`${message.id}-text-${i}`}>{part.text}</p>;
                    }
                    return null;
                  })}
                </div>
              </div>

              {String(message.role) === "user" && (
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary flex items-center justify-center">
                  <User className="h-5 w-5 text-primary-foreground" />
                </div>
              )}
            </div>
          ))}

          {status !== "ready" && (
            <div className="flex gap-3">
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                <Bot className="h-5 w-5 text-primary" />
              </div>
              <div className="bg-muted rounded-lg px-4 py-3">
                <div className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span className="text-sm text-muted-foreground">
                    Searching knowledge base...
                  </span>
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <Card className="mt-4">
          <CardContent className="p-3">
            <form onSubmit={handleSubmit} className="flex gap-2">
              <Textarea
                placeholder="Ask about your knowledge base..."
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={status !== "ready"}
                rows={1}
                className="min-h-[44px] max-h-32 resize-none"
              />
              <Button
                type="submit"
                size="icon"
                disabled={!input.trim() || status !== "ready"}
              >
                {status !== "ready" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </Button>
            </form>
            <p className="text-xs text-muted-foreground mt-2 text-center">
              Uses hybrid retrieval: Vector Search + Knowledge Graph traversal
            </p>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
