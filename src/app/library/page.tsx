"use client";

import { useState } from "react";
import Link from "next/link";
import { FileText, Video, Globe, Search, Filter, MoreVertical, Trash2, ExternalLink } from "lucide-react";
import { Header } from "@/components/layout/header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

// Mock data - will be replaced with real data from database
const mockDocuments = [
  {
    id: "1",
    title: "Introduction to GraphRAG",
    type: "article",
    url: "https://example.com/graphrag",
    summary: "GraphRAG combines knowledge graphs with retrieval-augmented generation for more accurate AI responses.",
    createdAt: new Date("2024-01-15"),
    processingStatus: "completed",
    entityCount: 12,
  },
  {
    id: "2",
    title: "Building Local-First Applications",
    type: "youtube",
    url: "https://youtube.com/watch?v=abc123",
    summary: "A comprehensive guide to building applications that work offline and sync when connected.",
    createdAt: new Date("2024-01-14"),
    processingStatus: "completed",
    entityCount: 8,
  },
  {
    id: "3",
    title: "Vector Databases Explained",
    type: "pdf",
    url: null,
    summary: "Understanding how vector databases store and query high-dimensional embeddings.",
    createdAt: new Date("2024-01-13"),
    processingStatus: "processing",
    entityCount: 0,
  },
];

const typeIcons = {
  article: Globe,
  youtube: Video,
  pdf: FileText,
  note: FileText,
};

const typeColors = {
  article: "bg-blue-500/10 text-blue-500",
  youtube: "bg-red-500/10 text-red-500",
  pdf: "bg-orange-500/10 text-orange-500",
  note: "bg-green-500/10 text-green-500",
};

export default function LibraryPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [filterType, setFilterType] = useState<string | null>(null);

  const filteredDocuments = mockDocuments.filter((doc) => {
    const matchesSearch = doc.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      doc.summary?.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesType = !filterType || doc.type === filterType;
    return matchesSearch && matchesType;
  });

  return (
    <div className="min-h-screen bg-background">
      <Header />
      
      <main className="container mx-auto px-4 py-8">
        <div className="flex flex-col gap-6">
          {/* Page Header */}
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold">Library</h1>
              <p className="text-muted-foreground">
                {mockDocuments.length} documents in your knowledge base
              </p>
            </div>
            <Link href="/add">
              <Button>Add Content</Button>
            </Link>
          </div>

          {/* Search and Filters */}
          <div className="flex gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search documents..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
            <div className="flex gap-2">
              {["article", "youtube", "pdf"].map((type) => (
                <Button
                  key={type}
                  variant={filterType === type ? "secondary" : "outline"}
                  size="sm"
                  onClick={() => setFilterType(filterType === type ? null : type)}
                  className="capitalize"
                >
                  {type}
                </Button>
              ))}
            </div>
          </div>

          {/* Document Grid */}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {filteredDocuments.map((doc) => {
              const Icon = typeIcons[doc.type as keyof typeof typeIcons] || FileText;
              const colorClass = typeColors[doc.type as keyof typeof typeColors] || typeColors.note;
              
              return (
                <Card key={doc.id} className="group hover:shadow-md transition-shadow">
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between">
                      <div className={`p-2 rounded-lg ${colorClass}`}>
                        <Icon className="h-5 w-5" />
                      </div>
                      <Button variant="ghost" size="icon" className="opacity-0 group-hover:opacity-100 transition-opacity">
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </div>
                    <CardTitle className="text-lg line-clamp-2 mt-2">
                      {doc.title}
                    </CardTitle>
                    <CardDescription className="line-clamp-2">
                      {doc.summary}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        {doc.processingStatus === "completed" ? (
                          <Badge variant="secondary">{doc.entityCount} entities</Badge>
                        ) : (
                          <Badge variant="outline">Processing...</Badge>
                        )}
                      </div>
                      <span className="text-muted-foreground">
                        {doc.createdAt.toLocaleDateString()}
                      </span>
                    </div>
                    {doc.url && (
                      <a
                        href={doc.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mt-2 truncate"
                      >
                        <ExternalLink className="h-3 w-3 flex-shrink-0" />
                        <span className="truncate">{doc.url}</span>
                      </a>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {filteredDocuments.length === 0 && (
            <div className="text-center py-12">
              <p className="text-muted-foreground">No documents found</p>
              <Link href="/add">
                <Button variant="link">Add your first document</Button>
              </Link>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
