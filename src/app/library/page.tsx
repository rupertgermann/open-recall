"use client";

import { useState, useEffect, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileText, Video, Globe, Search, MoreVertical, Trash2, ExternalLink, Loader2, RefreshCw, X, Grid, List, FolderOpen, Plus, Pencil, Library, Sparkles, CheckSquare, Square } from "lucide-react";
import Image from "next/image";
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
import { getCollections, createCollection, updateCollection, deleteCollection, bulkAddToCollection, autoOrganizeDocuments, getUnassignedDocumentCount, type CollectionWithCount, type AutoOrganizeResult } from "@/actions/collections";
import { cn } from "@/lib/utils";

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
  documentToUpdate,
  bulkSelectMode = false,
  isSelected = false,
  onToggleSelect,
}: { 
  doc: DocumentWithStats;
  onUpdateFromSource: (id: string) => void;
  onDeleteClick: (id: string) => void;
  isPending: boolean;
  documentToUpdate: string | null;
  bulkSelectMode?: boolean;
  isSelected?: boolean;
  onToggleSelect?: (id: string) => void;
}) {
  const router = useRouter();
  const Icon = typeIcons[doc.type as keyof typeof typeIcons] || FileText;
  const colorClass = typeColors[doc.type as keyof typeof typeColors] || typeColors.note;

  return (
    <div
      className={cn(
        "group border rounded-lg p-4 hover:bg-muted/50 transition-colors cursor-pointer",
        bulkSelectMode && isSelected && "ring-2 ring-primary"
      )}
      onClick={() => bulkSelectMode && onToggleSelect ? onToggleSelect(doc.id) : router.push(`/library/${doc.id}`)}
    >
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-3 flex-1 min-w-0">
          {bulkSelectMode && (
            <div className="flex-shrink-0 mt-1">
              {isSelected ? (
                <CheckSquare className="h-5 w-5 text-primary" />
              ) : (
                <Square className="h-5 w-5 text-muted-foreground" />
              )}
            </div>
          )}
          {doc.imagePath ? (
            <div className="relative h-16 w-16 flex-shrink-0 overflow-hidden rounded-lg border">
              <Image
                src={doc.imagePath}
                alt={doc.title}
                fill
                className="object-cover"
                sizes="64px"
              />
            </div>
          ) : (
            <div className={`p-2 rounded-lg ${colorClass} flex-shrink-0`}>
              <Icon className="h-5 w-5" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-lg line-clamp-1 mt-1">{doc.title}</h3>
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

  // Collection state
  const [collectionsList, setCollectionsList] = useState<CollectionWithCount[]>([]);
  const [selectedCollectionId, setSelectedCollectionId] = useState<string | null>(null);
  const [collectionDialogOpen, setCollectionDialogOpen] = useState(false);
  const [collectionToEdit, setCollectionToEdit] = useState<CollectionWithCount | null>(null);
  const [collectionToDelete, setCollectionToDelete] = useState<string | null>(null);
  const [collectionName, setCollectionName] = useState("");
  const [collectionDescription, setCollectionDescription] = useState("");

  // Bulk select state
  const [bulkSelectMode, setBulkSelectMode] = useState(false);
  const [selectedDocIds, setSelectedDocIds] = useState<Set<string>>(new Set());

  // Auto-organize state
  const [isAutoOrganizing, setIsAutoOrganizing] = useState(false);
  const [unassignedCount, setUnassignedCount] = useState(0);
  const [organizeResults, setOrganizeResults] = useState<AutoOrganizeResult[] | null>(null);

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

  // Fetch collections on mount
  useEffect(() => {
    async function fetchCollections() {
      try {
        const cols = await getCollections();
        setCollectionsList(cols);
      } catch (error) {
        console.error("Failed to fetch collections:", error);
      }
    }
    fetchCollections();
  }, []);

  // Fetch unassigned doc count when collections change
  useEffect(() => {
    async function fetchUnassigned() {
      try {
        const count = await getUnassignedDocumentCount();
        setUnassignedCount(count);
      } catch (error) {
        console.error("Failed to fetch unassigned count:", error);
      }
    }
    if (collectionsList.length > 0) {
      fetchUnassigned();
    }
  }, [collectionsList]);

  const refreshCollections = async () => {
    try {
      const cols = await getCollections();
      setCollectionsList(cols);
    } catch (error) {
      console.error("Failed to refresh collections:", error);
    }
  };

  const handleCreateOrUpdateCollection = async () => {
    const name = collectionName.trim();
    if (!name) return;

    try {
      if (collectionToEdit) {
        await updateCollection(collectionToEdit.id, {
          name,
          description: collectionDescription.trim() || undefined,
        });
        toast({ title: "Collection updated" });
      } else {
        const created = await createCollection({
          name,
          description: collectionDescription.trim() || undefined,
        });
        setSelectedCollectionId(created.id);
        toast({ title: "Collection created" });
      }
      await refreshCollections();
    } catch (error) {
      toast({
        title: collectionToEdit ? "Update failed" : "Creation failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setCollectionDialogOpen(false);
      setCollectionToEdit(null);
      setCollectionName("");
      setCollectionDescription("");
    }
  };

  const handleDeleteCollection = async () => {
    if (!collectionToDelete) return;
    try {
      await deleteCollection(collectionToDelete);
      if (selectedCollectionId === collectionToDelete) {
        setSelectedCollectionId(null);
      }
      await refreshCollections();
      toast({ title: "Collection deleted" });
    } catch (error) {
      toast({ title: "Delete failed", variant: "destructive" });
    } finally {
      setCollectionToDelete(null);
    }
  };

  const openEditDialog = (col: CollectionWithCount) => {
    setCollectionToEdit(col);
    setCollectionName(col.name);
    setCollectionDescription(col.description || "");
    setCollectionDialogOpen(true);
  };

  const openCreateDialog = () => {
    setCollectionToEdit(null);
    setCollectionName("");
    setCollectionDescription("");
    setCollectionDialogOpen(true);
  };

  // Bulk select handlers
  const toggleBulkSelect = () => {
    setBulkSelectMode((prev) => !prev);
    setSelectedDocIds(new Set());
  };

  const toggleDocSelection = (docId: string) => {
    setSelectedDocIds((prev) => {
      const next = new Set(prev);
      if (next.has(docId)) {
        next.delete(docId);
      } else {
        next.add(docId);
      }
      return next;
    });
  };

  const selectAll = () => {
    setSelectedDocIds(new Set(documents.map((d) => d.id)));
  };

  const deselectAll = () => {
    setSelectedDocIds(new Set());
  };

  const handleBulkAssign = async (collectionId: string) => {
    const ids = Array.from(selectedDocIds);
    if (ids.length === 0) return;
    try {
      await bulkAddToCollection(ids, collectionId);
      toast({
        title: "Documents assigned",
        description: `${ids.length} document(s) added to collection.`,
      });
      await refreshCollections();
      setBulkSelectMode(false);
      setSelectedDocIds(new Set());
    } catch (error) {
      toast({ title: "Assignment failed", variant: "destructive" });
    }
  };

  const handleAutoOrganize = async () => {
    setIsAutoOrganizing(true);
    setOrganizeResults(null);
    try {
      const results = await autoOrganizeDocuments();
      setOrganizeResults(results);
      await refreshCollections();
      if (results.length > 0) {
        toast({
          title: "Auto-organize complete",
          description: `${results.length} document(s) organized into collections.`,
        });
      } else {
        toast({
          title: "No changes",
          description: "No documents matched any existing collection.",
        });
      }
    } catch (error) {
      console.error("Auto-organize failed:", error);
      toast({ title: "Auto-organize failed", variant: "destructive" });
    } finally {
      setIsAutoOrganizing(false);
    }
  };

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
          collectionId: selectedCollectionId || undefined,
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
  }, [debouncedSearch, filterType, selectedCollectionId, pageSize]);

  const loadMore = async () => {
    if (isLoading || !hasMore) return;
    setIsLoading(true);
    try {
      const more = await getDocuments({
        search: debouncedSearch || undefined,
        type: filterType || undefined,
        collectionId: selectedCollectionId || undefined,
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
              <Button
                variant={bulkSelectMode ? "secondary" : "outline"}
                size="sm"
                onClick={toggleBulkSelect}
                className="gap-1.5"
              >
                <CheckSquare className="h-4 w-4" />
                Select
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

          {/* Collection Filter */}
          {collectionsList.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap">
              <Library className="h-4 w-4 text-muted-foreground shrink-0" />
              <Button
                variant={selectedCollectionId === null ? "secondary" : "outline"}
                size="sm"
                onClick={() => setSelectedCollectionId(null)}
              >
                All
              </Button>
              {collectionsList.map((col) => (
                <div key={col.id} className="relative group">
                  <Button
                    variant={selectedCollectionId === col.id ? "secondary" : "outline"}
                    size="sm"
                    onClick={() => setSelectedCollectionId(selectedCollectionId === col.id ? null : col.id)}
                    className="gap-1.5 pr-2"
                  >
                    <FolderOpen className="h-3.5 w-3.5" />
                    {col.name}
                    <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-[10px]">
                      {col.documentCount}
                    </Badge>
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-muted border flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <MoreVertical className="h-2.5 w-2.5" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => openEditDialog(col)}>
                        <Pencil className="h-4 w-4 mr-2" />
                        Rename
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="text-destructive"
                        onClick={() => setCollectionToDelete(col.id)}
                      >
                        <Trash2 className="h-4 w-4 mr-2" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              ))}
              <Button
                variant="ghost"
                size="sm"
                onClick={openCreateDialog}
                className="gap-1.5 text-muted-foreground"
              >
                <Plus className="h-3.5 w-3.5" />
                New Collection
              </Button>
            </div>
          )}

          {collectionsList.length === 0 && (
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={openCreateDialog}
                className="gap-1.5"
              >
                <FolderOpen className="h-3.5 w-3.5" />
                Create your first collection
              </Button>
            </div>
          )}

          {/* Bulk Select Toolbar */}
          {bulkSelectMode && (
            <div className="flex items-center gap-3 rounded-lg border bg-muted/50 px-4 py-2">
              <span className="text-sm font-medium">
                {selectedDocIds.size} selected
              </span>
              <Button variant="ghost" size="sm" onClick={selectAll}>
                Select all
              </Button>
              <Button variant="ghost" size="sm" onClick={deselectAll} disabled={selectedDocIds.size === 0}>
                Clear
              </Button>
              <div className="flex-1" />
              {selectedDocIds.size > 0 && collectionsList.length > 0 && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="sm" className="gap-1.5">
                      <FolderOpen className="h-4 w-4" />
                      Move to collection
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {collectionsList.map((col) => (
                      <DropdownMenuItem
                        key={col.id}
                        onClick={() => handleBulkAssign(col.id)}
                      >
                        <FolderOpen className="h-4 w-4 mr-2" />
                        {col.name}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              <Button variant="ghost" size="sm" onClick={toggleBulkSelect}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          )}

          {/* Auto-organize */}
          {!bulkSelectMode && collectionsList.length > 0 && unassignedCount > 0 && (
            <div className="flex items-center gap-3 rounded-lg border border-dashed px-4 py-2">
              <Sparkles className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">
                {unassignedCount} document(s) not in any collection
              </span>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 ml-auto"
                onClick={handleAutoOrganize}
                disabled={isAutoOrganizing}
              >
                {isAutoOrganizing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4" />
                )}
                {isAutoOrganizing ? "Organizing..." : "Auto-organize with AI"}
              </Button>
            </div>
          )}

          {/* Auto-organize results */}
          {organizeResults && organizeResults.length > 0 && (
            <div className="rounded-lg border bg-muted/30 px-4 py-3 space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium flex items-center gap-1.5">
                  <Sparkles className="h-3.5 w-3.5" />
                  Auto-organize results
                </span>
                <Button variant="ghost" size="sm" onClick={() => setOrganizeResults(null)}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
              {organizeResults.map((r) => (
                <p key={r.documentId} className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">{r.documentTitle}</span>
                  {" → "}
                  {r.assignedCollections.join(", ")}
                </p>
              ))}
            </div>
          )}

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
                    className={cn(
                      "group hover:shadow-md transition-shadow cursor-pointer",
                      bulkSelectMode && selectedDocIds.has(doc.id) && "ring-2 ring-primary"
                    )}
                    onClick={() => bulkSelectMode ? toggleDocSelection(doc.id) : router.push(`/library/${doc.id}`)}
                  >
                    <CardHeader className="pb-3">
                      <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        {bulkSelectMode && (
                          <div className="flex-shrink-0">
                            {selectedDocIds.has(doc.id) ? (
                              <CheckSquare className="h-5 w-5 text-primary" />
                            ) : (
                              <Square className="h-5 w-5 text-muted-foreground" />
                            )}
                          </div>
                        )}
                        {doc.imagePath ? (
                          <div className="relative h-12 w-12 flex-shrink-0 overflow-hidden rounded-lg border">
                            <Image
                              src={doc.imagePath}
                              alt={doc.title}
                              fill
                              className="object-cover"
                              sizes="48px"
                            />
                          </div>
                        ) : (
                          <div className={`p-2 rounded-lg ${colorClass} flex-shrink-0`}>
                            <Icon className="h-5 w-5" />
                          </div>
                        )}
                        <CardTitle className="text-lg line-clamp-1 m-0">
                          {doc.title}
                        </CardTitle>
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
                      <CardDescription className="line-clamp-2 prose prose-sm max-w-none dark:prose-invert mt-3">
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
                  bulkSelectMode={bulkSelectMode}
                  isSelected={selectedDocIds.has(doc.id)}
                  onToggleSelect={toggleDocSelection}
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

        {/* Delete Document Dialog */}
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

        {/* Create/Edit Collection Dialog */}
        <AlertDialog open={collectionDialogOpen} onOpenChange={(open) => {
          if (!open) {
            setCollectionDialogOpen(false);
            setCollectionToEdit(null);
            setCollectionName("");
            setCollectionDescription("");
          }
        }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {collectionToEdit ? "Rename Collection" : "New Collection"}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {collectionToEdit
                  ? "Update the collection name and description."
                  : "Create a new collection to organize your documents."}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="space-y-3 py-2">
              <Input
                placeholder="Collection name"
                value={collectionName}
                onChange={(e) => setCollectionName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCreateOrUpdateCollection()}
                autoFocus
              />
              <Input
                placeholder="Description (optional)"
                value={collectionDescription}
                onChange={(e) => setCollectionDescription(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCreateOrUpdateCollection()}
              />
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={(e) => {
                  e.preventDefault();
                  handleCreateOrUpdateCollection();
                }}
                disabled={!collectionName.trim()}
              >
                {collectionToEdit ? "Save" : "Create"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Delete Collection Dialog */}
        <AlertDialog open={!!collectionToDelete} onOpenChange={(open) => !open && setCollectionToDelete(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete collection?</AlertDialogTitle>
              <AlertDialogDescription>
                This will delete the collection. Documents in this collection will not be deleted.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={(e) => {
                  e.preventDefault();
                  handleDeleteCollection();
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
