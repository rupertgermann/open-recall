"use client";

import { useState, useEffect, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileText, Video, Globe, Search, MoreVertical, Trash2, ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { Header } from "@/components/layout/header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { getDocuments, deleteDocument, type DocumentWithStats } from "@/actions/documents";

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
  const router = useRouter();
  const [documents, setDocuments] = useState<DocumentWithStats[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isPending, startTransition] = useTransition();
  const [searchQuery, setSearchQuery] = useState("");
  const [filterType, setFilterType] = useState<string | null>(null);
  const [debouncedSearch, setDebouncedSearch] = useState("");

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Fetch documents
  useEffect(() => {
    async function fetchDocuments() {
      setIsLoading(true);
      try {
        const docs = await getDocuments({
          search: debouncedSearch || undefined,
          type: filterType || undefined,
        });
        setDocuments(docs);
      } catch (error) {
        console.error("Failed to fetch documents:", error);
      } finally {
        setIsLoading(false);
      }
    }
    fetchDocuments();
  }, [debouncedSearch, filterType]);

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this document?")) return;

    startTransition(async () => {
      try {
        await deleteDocument(id);
        setDocuments((prev) => prev.filter((d) => d.id !== id));
      } catch (error) {
        console.error("Failed to delete document:", error);
      }
    });
  };

  const handleRefresh = () => {
    setDebouncedSearch(searchQuery);
  };

  return (
    <div className="min-h-screen">
      <Header />

      <main className="container mx-auto px-4 py-8">
        <div className="flex flex-col gap-6">
          {/* Page Header */}
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold">Library</h1>
              <p className="text-muted-foreground">
                {isLoading ? "Loading..." : `${documents.length} documents in your knowledge base`}
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="icon" onClick={handleRefresh} disabled={isLoading}>
                <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
              </Button>
              <Link href="/add">
                <Button>Add Content</Button>
              </Link>
            </div>
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
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {documents.map((doc) => {
                const Icon = typeIcons[doc.type as keyof typeof typeIcons] || FileText;
                const colorClass = typeColors[doc.type as keyof typeof typeColors] || typeColors.note;

                return (
                  <Card 
                    key={doc.id} 
                    className="group hover:shadow-md transition-shadow cursor-pointer"
                    onClick={() => router.push(`/library/${doc.id}`)}
                  >
                    <CardHeader className="pb-3">
                      <div className="flex items-start justify-between">
                        <div className={`p-2 rounded-lg ${colorClass}`}>
                          <Icon className="h-5 w-5" />
                        </div>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button 
                              variant="ghost" 
                              size="icon" 
                              className="opacity-0 group-hover:opacity-100 transition-opacity"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                            {doc.url && (
                              <DropdownMenuItem asChild>
                                <a href={doc.url} target="_blank" rel="noopener noreferrer">
                                  <ExternalLink className="h-4 w-4 mr-2" />
                                  Open Original
                                </a>
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem
                              className="text-destructive"
                              onClick={() => handleDelete(doc.id)}
                              disabled={isPending}
                            >
                              <Trash2 className="h-4 w-4 mr-2" />
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
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
                        <span
                          className="flex items-center gap-1 text-xs text-muted-foreground mt-2 truncate"
                        >
                          <ExternalLink className="h-3 w-3 flex-shrink-0" />
                          <span className="truncate">{doc.url}</span>
                        </span>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}

          {!isLoading && documents.length === 0 && (
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
