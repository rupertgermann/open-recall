"use client";

import Link from "next/link";
import {
  FileText,
  Video,
  Globe,
  Network,
  MessageSquare,
  Plus,
  BookOpen,
  Brain,
  Layers,
  FolderOpen,
  ArrowRight,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import { Header } from "@/components/layout/header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { DashboardData } from "@/actions/dashboard";
import { cn } from "@/lib/utils";

const typeIcons: Record<string, typeof Globe> = {
  article: Globe,
  youtube: Video,
  pdf: FileText,
  note: FileText,
};

const typeColors: Record<string, string> = {
  article: "text-blue-500",
  youtube: "text-red-500",
  pdf: "text-orange-500",
  note: "text-green-500",
};

function StatCard({
  label,
  value,
  icon: Icon,
  href,
  color,
}: {
  label: string;
  value: number;
  icon: typeof Brain;
  href: string;
  color: string;
}) {
  return (
    <Link href={href}>
      <Card className="hover:shadow-md transition-shadow cursor-pointer group">
        <CardContent className="p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">{label}</p>
              <p className="text-3xl font-bold mt-1">{value.toLocaleString("en-US")}</p>
            </div>
            <div className={cn("p-3 rounded-xl bg-muted group-hover:scale-110 transition-transform", color)}>
              <Icon className="h-6 w-6" />
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

function ActivityBar({ data }: { data: { date: string; count: number }[] }) {
  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-24 text-sm text-muted-foreground">
        No activity in the last 30 days
      </div>
    );
  }

  const max = Math.max(...data.map((d) => d.count), 1);

  // Fill in missing days for last 30 days
  const today = new Date();
  const days: { date: string; count: number }[] = [];
  const dataMap = new Map(data.map((d) => [d.date, d.count]));
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().split("T")[0];
    days.push({ date: key, count: dataMap.get(key) || 0 });
  }

  return (
    <div className="flex items-end gap-[3px] h-20">
      {days.map((d) => {
        const height = d.count > 0 ? Math.max(8, (d.count / max) * 100) : 4;
        return (
          <div
            key={d.date}
            className={cn(
              "flex-1 rounded-sm transition-colors",
              d.count > 0
                ? "bg-primary/70 hover:bg-primary"
                : "bg-muted"
            )}
            style={{ height: `${height}%` }}
            title={`${d.date}: ${d.count} doc${d.count !== 1 ? "s" : ""}`}
          />
        );
      })}
    </div>
  );
}

export function DashboardClient({ data }: { data: DashboardData }) {
  const isEmpty = data.stats.documents === 0;

  return (
    <div className="min-h-screen">
      <Header />

      <main className="container mx-auto px-4 py-8">
        <div className="flex flex-col gap-8">
          {/* Hero Section */}
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold tracking-tight">
                Welcome to <span className="text-primary">open-recall</span>
              </h1>
              <p className="text-muted-foreground mt-1">
                {isEmpty
                  ? "Get started by adding your first content"
                  : "Your personal knowledge base at a glance"}
              </p>
            </div>
            <div className="flex gap-2">
              <Link href="/add">
                <Button className="gap-2">
                  <Plus className="h-4 w-4" />
                  Add Content
                </Button>
              </Link>
              <Link href="/chat">
                <Button variant="outline" className="gap-2">
                  <MessageSquare className="h-4 w-4" />
                  Chat
                </Button>
              </Link>
            </div>
          </div>

          {/* Empty State */}
          {isEmpty && (
            <Card className="border-dashed">
              <CardContent className="p-12 text-center">
                <Brain className="h-16 w-16 mx-auto text-muted-foreground/40 mb-4" />
                <h2 className="text-2xl font-semibold mb-2">Build Your Knowledge Base</h2>
                <p className="text-muted-foreground max-w-md mx-auto mb-6">
                  Add articles, videos, PDFs, or notes. open-recall will automatically extract entities,
                  build a knowledge graph, and let you chat with your data.
                </p>
                <div className="flex justify-center gap-3">
                  <Link href="/add">
                    <Button size="lg" className="gap-2">
                      <Plus className="h-5 w-5" />
                      Add Your First Content
                    </Button>
                  </Link>
                </div>
                <div className="grid md:grid-cols-3 gap-6 mt-12 text-left">
                  <div className="p-4 rounded-lg border">
                    <Network className="h-8 w-8 text-primary mb-3" />
                    <h3 className="font-semibold mb-1">GraphRAG</h3>
                    <p className="text-sm text-muted-foreground">
                      Auto-extract entities and relationships into a semantic knowledge graph.
                    </p>
                  </div>
                  <div className="p-4 rounded-lg border">
                    <Brain className="h-8 w-8 text-primary mb-3" />
                    <h3 className="font-semibold mb-1">Local AI</h3>
                    <p className="text-sm text-muted-foreground">
                      Run everything with Ollama. Your data never leaves your machine.
                    </p>
                  </div>
                  <div className="p-4 rounded-lg border">
                    <Sparkles className="h-8 w-8 text-primary mb-3" />
                    <h3 className="font-semibold mb-1">Chat with Context</h3>
                    <p className="text-sm text-muted-foreground">
                      Ask questions and get answers grounded in your knowledge base.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Stats Grid */}
          {!isEmpty && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
                <StatCard label="Documents" value={data.stats.documents} icon={BookOpen} href="/library" color="text-blue-500" />
                <StatCard label="Entities" value={data.stats.entities} icon={Network} href="/graph" color="text-emerald-500" />
                <StatCard label="Relations" value={data.stats.relationships} icon={TrendingUp} href="/graph" color="text-purple-500" />
                <StatCard label="Chunks" value={data.stats.chunks} icon={Layers} href="/library" color="text-amber-500" />
                <StatCard label="Chats" value={data.stats.chats} icon={MessageSquare} href="/chat" color="text-pink-500" />
                <StatCard label="Collections" value={data.stats.collections} icon={FolderOpen} href="/library" color="text-indigo-500" />
              </div>

              <div className="grid md:grid-cols-3 gap-6">
                {/* Activity Chart */}
                <Card className="md:col-span-2">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">Activity (Last 30 Days)</CardTitle>
                    <CardDescription>Documents added over time</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ActivityBar data={data.activityByDay} />
                    {data.typeBreakdown.length > 0 && (
                      <div className="flex gap-3 mt-4 pt-3 border-t">
                        {data.typeBreakdown.map((t) => {
                          const Icon = typeIcons[t.type] || FileText;
                          return (
                            <div key={t.type} className="flex items-center gap-1.5 text-sm">
                              <Icon className={cn("h-3.5 w-3.5", typeColors[t.type] || "text-muted-foreground")} />
                              <span className="capitalize">{t.type === "note" ? "text" : t.type}</span>
                              <span className="text-muted-foreground font-medium">{t.count}</span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Quick Actions */}
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">Quick Actions</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <Link href="/add" className="block">
                      <Button variant="outline" className="w-full justify-start gap-2">
                        <Plus className="h-4 w-4" />
                        Add Content
                      </Button>
                    </Link>
                    <Link href="/chat" className="block">
                      <Button variant="outline" className="w-full justify-start gap-2">
                        <MessageSquare className="h-4 w-4" />
                        New Chat
                      </Button>
                    </Link>
                    <Link href="/graph" className="block">
                      <Button variant="outline" className="w-full justify-start gap-2">
                        <Network className="h-4 w-4" />
                        Explore Graph
                      </Button>
                    </Link>
                    <Link href="/library" className="block">
                      <Button variant="outline" className="w-full justify-start gap-2">
                        <BookOpen className="h-4 w-4" />
                        Browse Library
                      </Button>
                    </Link>
                  </CardContent>
                </Card>
              </div>

              <div className="grid md:grid-cols-2 gap-6">
                {/* Recent Documents */}
                <Card>
                  <CardHeader className="pb-2 flex flex-row items-center justify-between">
                    <div>
                      <CardTitle className="text-base">Recent Documents</CardTitle>
                      <CardDescription>Latest additions to your library</CardDescription>
                    </div>
                    <Link href="/library">
                      <Button variant="ghost" size="sm" className="gap-1">
                        View all
                        <ArrowRight className="h-3.5 w-3.5" />
                      </Button>
                    </Link>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {data.recentDocuments.map((doc) => {
                        const Icon = typeIcons[doc.type] || FileText;
                        return (
                          <Link
                            key={doc.id}
                            href={`/library/${doc.id}`}
                            className="flex items-center gap-3 p-2 -mx-2 rounded-lg hover:bg-muted transition-colors"
                          >
                            <div className={cn("p-1.5 rounded-md bg-muted", typeColors[doc.type])}>
                              <Icon className="h-4 w-4" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium truncate">{doc.title}</p>
                              <span className="text-xs text-muted-foreground">
                                {doc.createdAt.toLocaleDateString("en-US")}
                                {doc.processingStatus !== "completed" && (
                                  <Badge variant="outline" className="ml-2 text-[10px]">
                                    Processing
                                  </Badge>
                                )}
                              </span>
                            </div>
                          </Link>
                        );
                      })}
                      {data.recentDocuments.length === 0 && (
                        <p className="text-sm text-muted-foreground py-4 text-center">No documents yet</p>
                      )}
                    </div>
                  </CardContent>
                </Card>

                {/* Recent Chats */}
                <Card>
                  <CardHeader className="pb-2 flex flex-row items-center justify-between">
                    <div>
                      <CardTitle className="text-base">Recent Chats</CardTitle>
                      <CardDescription>Continue a conversation</CardDescription>
                    </div>
                    <Link href="/chat">
                      <Button variant="ghost" size="sm" className="gap-1">
                        View all
                        <ArrowRight className="h-3.5 w-3.5" />
                      </Button>
                    </Link>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {data.recentChats.map((chat) => (
                        <Link
                          key={chat.id}
                          href={`/chat/${chat.id}`}
                          className="flex items-center gap-3 p-2 -mx-2 rounded-lg hover:bg-muted transition-colors"
                        >
                          <div className="p-1.5 rounded-md bg-muted text-pink-500">
                            <MessageSquare className="h-4 w-4" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium truncate">{chat.title}</p>
                            <span className="text-xs text-muted-foreground">
                              {chat.lastMessageAt.toLocaleDateString("en-US")}
                              <Badge
                                variant="outline"
                                className={cn(
                                  "ml-2 text-[10px]",
                                  chat.category === "entity" && "border-green-500/30 text-green-600",
                                  chat.category === "document" && "border-orange-500/30 text-orange-600"
                                )}
                              >
                                {chat.category}
                              </Badge>
                            </span>
                          </div>
                        </Link>
                      ))}
                      {data.recentChats.length === 0 && (
                        <p className="text-sm text-muted-foreground py-4 text-center">No chats yet</p>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
