"use client";

import { useState, useRef, useEffect } from "react";
import { Send, Loader2, Bot, User, Sparkles, Network } from "lucide-react";
import { Header } from "@/components/layout/header";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: { title: string; type: string }[];
  entities?: string[];
}

// Mock messages for demo
const initialMessages: Message[] = [
  {
    id: "1",
    role: "assistant",
    content: "Hello! I'm your knowledge assistant. Ask me anything about your saved content, and I'll use both semantic search and your knowledge graph to find relevant information.",
  },
];

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content: input,
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsLoading(true);

    // Simulate AI response with GraphRAG context
    await new Promise((r) => setTimeout(r, 1500));

    const assistantMessage: Message = {
      id: (Date.now() + 1).toString(),
      role: "assistant",
      content: `Based on your knowledge base, here's what I found about "${input}":\n\nGraphRAG combines the power of knowledge graphs with retrieval-augmented generation. This approach allows for more contextual and accurate responses by understanding the relationships between concepts in your documents.\n\nThe key benefits include:\n- Better context understanding through entity relationships\n- More accurate retrieval by traversing related concepts\n- Reduced hallucination by grounding responses in your actual content`,
      sources: [
        { title: "Introduction to GraphRAG", type: "article" },
        { title: "Building Local-First Applications", type: "youtube" },
      ],
      entities: ["GraphRAG", "Knowledge Graph", "RAG", "Vector Search"],
    };

    setMessages((prev) => [...prev, assistantMessage]);
    setIsLoading(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Header />

      <main className="flex-1 container mx-auto px-4 py-6 flex flex-col max-w-4xl">
        {/* Messages */}
        <div className="flex-1 overflow-y-auto space-y-4 pb-4">
          {messages.map((message) => (
            <div
              key={message.id}
              className={cn(
                "flex gap-3",
                message.role === "user" ? "justify-end" : "justify-start"
              )}
            >
              {message.role === "assistant" && (
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                  <Bot className="h-5 w-5 text-primary" />
                </div>
              )}

              <div
                className={cn(
                  "max-w-[80%] rounded-lg px-4 py-3",
                  message.role === "user"
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted"
                )}
              >
                <p className="whitespace-pre-wrap">{message.content}</p>

                {/* Sources */}
                {message.sources && message.sources.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-border/50">
                    <p className="text-xs font-medium mb-2 flex items-center gap-1">
                      <Sparkles className="h-3 w-3" />
                      Sources
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {message.sources.map((source, i) => (
                        <Badge key={i} variant="secondary" className="text-xs">
                          {source.title}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                {/* Entities */}
                {message.entities && message.entities.length > 0 && (
                  <div className="mt-2">
                    <p className="text-xs font-medium mb-2 flex items-center gap-1">
                      <Network className="h-3 w-3" />
                      Related Entities
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {message.entities.map((entity, i) => (
                        <Badge key={i} variant="outline" className="text-xs">
                          {entity}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {message.role === "user" && (
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary flex items-center justify-center">
                  <User className="h-5 w-5 text-primary-foreground" />
                </div>
              )}
            </div>
          ))}

          {isLoading && (
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
                disabled={isLoading}
                rows={1}
                className="min-h-[44px] max-h-32 resize-none"
              />
              <Button
                type="submit"
                size="icon"
                disabled={!input.trim() || isLoading}
              >
                {isLoading ? (
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
