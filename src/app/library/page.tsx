"use client";

import { useState, useEffect, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileText, Video, Globe, Search, MoreVertical, Trash2, ExternalLink, Loader2, RefreshCw, X, Grid, List } from "lucide-react";
import { Header } from "@/components/layout/header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { useToast } from "@/hooks/use-toast";
import { getDocuments, deleteDocument, updateDocumentFromSource, type DocumentWithStats } from "@/actions/documents";

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

// Document List Item Component
function DocumentListItem({ 
  doc, 
  onUpdateFromSource, 
  onDeleteClick, 
  isPending, 
  documentToUpdate 
}: { 
  doc: DocumentWithStats;
  onUpdateFromSource: (id: string) => void;
  onDeleteClick: (id: string) => void;
  isPending: boolean;
  documentToUpdate: string | null;
}) {
  const router = useRouter();
  const Icon = typeIcons[doc.type as keyof typeof typeIcons] || FileText;
  const colorClass = typeColors[doc.type as keyof typeof typeColors] || typeColors.note;

  return (
    <div
      className="group border rounded-lg p-4 hover:bg-muted/50 transition-colors cursor-pointer"
      onClick={() => router.push(`/library/${doc.id}`)}
    >
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <div className={`p-2 rounded-lg ${colorClass} flex-shrink-0`}>
            <Icon className="h-5 w-5" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-lg line-clamp-1 mb-1">{doc.title}</h3>
            {doc.summary && (
              <div className="text-sm text-muted-foreground line-clamp-2 mb-2 prose prose-sm max-w-none dark:prose-invert">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {doc.summary}
                </ReactMarkdown>
              </div>
            )}
            <div className="flex items-center gap-4 text-sm text-muted-foreground">
              <Badge variant="outline" className="capitalize">
                {doc.type}
              </Badge>
              {doc.processingStatus === "completed" ? (
                <Badge variant="secondary">{doc.entityCount} entities</Badge>
              ) : (
                <Badge variant="outline">Processing...</Badge>
              )}
              <span>{doc.createdAt.toLocaleDateString()}</span>
            </div>
            {doc.url && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground mt-2 truncate">
                <ExternalLink className="h-3 w-3 flex-shrink-0" />
                <span className="truncate">{doc.url}</span>
              </span>
            )}
          </div>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button 
              variant="ghost" 
              size="icon" 
              className="opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
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
            {doc.url && (
              <DropdownMenuItem
                onClick={() => onUpdateFromSource(doc.id)}
                disabled={isPending || documentToUpdate === doc.id}
              >
                <RefreshCw className={`h-4 w-4 mr-2 ${documentToUpdate === doc.id ? "animate-spin" : ""}`} />
                Update from source
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              className="text-destructive"
              onClick={() => onDeleteClick(doc.id)}
              disabled={isPending}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

export default function LibraryPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [documents, setDocuments] = useState<DocumentWithStats[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isPending, startTransition] = useTransition();
  const [searchQuery, setSearchQuery] = useState("");
  const [filterType, setFilterType] = useState<string | null>(null);
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [documentToDelete, setDocumentToDelete] = useState<string | null>(null);
  const [documentToUpdate, setDocumentToUpdate] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"card" | "list">("card");
  const [pageSize] = useState(30);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);

  // Load view mode from localStorage on mount
  useEffect(() => {
    const savedViewMode = localStorage.getItem("library-view-mode");
    if (savedViewMode === "list" || savedViewMode === "card") {
      setViewMode(savedViewMode);
    }
  }, []);

  // Save view mode to localStorage when it changes
  useEffect(() => {
    localStorage.setItem("library-view-mode", viewMode);
  }, [viewMode]);

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
          limit: pageSize,
          offset: 0,
        });
        setDocuments(docs);
        setOffset(docs.length);
        setHasMore(docs.length === pageSize);
      } catch (error) {
        console.error("Failed to fetch documents:", error);
      } finally {
        setIsLoading(false);
      }
    }
    fetchDocuments();
  }, [debouncedSearch, filterType, pageSize]);

  const loadMore = async () => {
    if (isLoading || !hasMore) return;
    setIsLoading(true);
    try {
      const more = await getDocuments({
        search: debouncedSearch || undefined,
        type: filterType || undefined,
        limit: pageSize,
        offset,
      });
      setDocuments((prev) => [...prev, ...more]);
      setOffset((prev) => prev + more.length);
      setHasMore(more.length === pageSize);
    } catch (error) {
      console.error("Failed to fetch more documents:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleUpdateFromSource = async (id: string) => {
    setDocumentToUpdate(id);
    try {
      const res = await updateDocumentFromSource(id);
      if (!res.success) {
        throw new Error(res.error || "Failed to update document");
      }
      toast({
        title: "Updated from source",
        description: "The document was refreshed.",
      });
      setDebouncedSearch(searchQuery);
    } catch (error) {
      toast({
        title: "Update failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setDocumentToUpdate(null);
    }
  };

  const handleDeleteClick = (id: string) => {
    setDocumentToDelete(id);
  };

  const confirmDelete = async () => {
    if (!documentToDelete) return;

    startTransition(async () => {
      try {
        await deleteDocument(documentToDelete);
        setDocuments((prev) => prev.filter((d) => d.id !== documentToDelete));
        setDocumentToDelete(null);
        toast({
          title: "Document deleted",
          description: "The document has been successfully deleted.",
        });
      } catch (error) {
        console.error("Failed to delete document:", error);
        toast({
          title: "Error",
          description: "Failed to delete document. Please try again.",
          variant: "destructive",
        });
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
              <Button
                variant="outline"
                size="icon"
                onClick={handleRefresh}
                disabled={isLoading}
              >
                <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
              </Button>
              <div className="flex border rounded-md">
                <Button
                  variant={viewMode === "card" ? "secondary" : "ghost"}
                  size="sm"
                  onClick={() => setViewMode("card")}
                  className="rounded-r-none"
                >
                  <Grid className="h-4 w-4" />
                </Button>
                <Button
                  variant={viewMode === "list" ? "secondary" : "ghost"}
                  size="sm"
                  onClick={() => setViewMode("list")}
                  className="rounded-l-none"
                >
                  <List className="h-4 w-4" />
                </Button>
              </div>
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
                className="pl-10 pr-10"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery("");
                    setDebouncedSearch("");
                  }}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  aria-label="Clear search"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
            <div className="flex gap-2">
              {["article", "youtube", "pdf", "note"].map((type) => (
                <Button
                  key={type}
                  variant={filterType === type ? "secondary" : "outline"}
                  size="sm"
                  onClick={() => setFilterType(filterType === type ? null : type)}
                  className="capitalize"
                >
                  {type === "note" ? "text" : type}
                </Button>
              ))}
            </div>
          </div>

          {/* Document Grid/List */}
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : viewMode === "card" ? (
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
                            {doc.url && (
                              <DropdownMenuItem
                                onClick={() => handleUpdateFromSource(doc.id)}
                                disabled={isPending || documentToUpdate === doc.id}
                              >
                                <RefreshCw className={`h-4 w-4 mr-2 ${documentToUpdate === doc.id ? "animate-spin" : ""}`} />
                                Update from source
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem
                              className="text-destructive"
                              onClick={() => handleDeleteClick(doc.id)}
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
                      <CardDescription className="line-clamp-2 prose prose-sm max-w-none dark:prose-invert">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {doc.summary}
                        </ReactMarkdown>
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
          ) : (
            <div className="space-y-3">
              {documents.map((doc) => (
                <DocumentListItem 
                  key={doc.id} 
                  doc={doc}
                  onUpdateFromSource={handleUpdateFromSource}
                  onDeleteClick={handleDeleteClick}
                  isPending={isPending}
                  documentToUpdate={documentToUpdate}
                />
              ))}
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

          {!isLoading && documents.length > 0 && hasMore && (
            <div className="flex justify-center pt-4">
              <Button variant="outline" onClick={loadMore}>
                Load more
              </Button>
            </div>
          )}
        </div>

        <AlertDialog open={!!documentToDelete} onOpenChange={(open) => !open && setDocumentToDelete(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Are you sure?</AlertDialogTitle>
              <AlertDialogDescription>
                This action cannot be undone. This will permanently delete the document
                and all associated data (chunks, entities, relationships).
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={(e) => {
                  e.preventDefault();
                  confirmDelete();
                }}
                disabled={isPending}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {isPending ? "Deleting..." : "Delete"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </main>
    </div>
  );
}
