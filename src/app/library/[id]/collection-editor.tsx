"use client";

import { useState, useEffect, useTransition } from "react";
import { FolderOpen, Plus, X, Sparkles, Loader2, Check } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  getCollections,
  getDocumentCollections,
  addDocumentToCollection,
  removeDocumentFromCollection,
  suggestCollectionsForDocument,
  type CollectionWithCount,
  type CollectionSuggestion,
} from "@/actions/collections";

type CollectionEditorProps = {
  documentId: string;
};

const confidenceColors = {
  high: "bg-green-500/10 text-green-600 border-green-500/30",
  medium: "bg-yellow-500/10 text-yellow-600 border-yellow-500/30",
  low: "bg-gray-500/10 text-gray-500 border-gray-500/30",
};

export function CollectionEditor({ documentId }: CollectionEditorProps) {
  const [allCollections, setAllCollections] = useState<CollectionWithCount[]>([]);
  const [assignedIds, setAssignedIds] = useState<string[]>([]);
  const [isPending, startTransition] = useTransition();
  const [suggestions, setSuggestions] = useState<CollectionSuggestion[]>([]);
  const [isSuggesting, setIsSuggesting] = useState(false);
  const [hasSuggested, setHasSuggested] = useState(false);

  useEffect(() => {
    async function load() {
      const [cols, assigned] = await Promise.all([
        getCollections(),
        getDocumentCollections(documentId),
      ]);
      setAllCollections(cols);
      setAssignedIds(assigned);
    }
    load();
  }, [documentId]);

  const assignedCollections = allCollections.filter((c) =>
    assignedIds.includes(c.id)
  );
  const unassignedCollections = allCollections.filter(
    (c) => !assignedIds.includes(c.id)
  );

  const handleAdd = (collectionId: string) => {
    startTransition(async () => {
      await addDocumentToCollection(documentId, collectionId);
      setAssignedIds((prev) => [...prev, collectionId]);
      setSuggestions((prev) => prev.filter((s) => s.collectionId !== collectionId));
    });
  };

  const handleSuggest = async () => {
    setIsSuggesting(true);
    try {
      const result = await suggestCollectionsForDocument(documentId);
      setSuggestions(result);
      setHasSuggested(true);
    } catch (error) {
      console.error("Failed to get suggestions:", error);
    } finally {
      setIsSuggesting(false);
    }
  };

  const handleRemove = (collectionId: string) => {
    startTransition(async () => {
      await removeDocumentFromCollection(documentId, collectionId);
      setAssignedIds((prev) => prev.filter((id) => id !== collectionId));
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {assignedCollections.map((col) => (
        <Badge
          key={col.id}
          variant="secondary"
          className="gap-1.5 pr-1"
        >
          <FolderOpen className="h-3 w-3" />
          {col.name}
          <button
            type="button"
            onClick={() => handleRemove(col.id)}
            disabled={isPending}
            className="ml-0.5 rounded-full p-0.5 hover:bg-muted-foreground/20 transition-colors"
            aria-label={`Remove from ${col.name}`}
          >
            <X className="h-3 w-3" />
          </button>
        </Badge>
      ))}

      {unassignedCollections.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 gap-1 text-xs text-muted-foreground"
              disabled={isPending}
            >
              <Plus className="h-3 w-3" />
              Add to collection
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {unassignedCollections.map((col) => (
              <DropdownMenuItem
                key={col.id}
                onClick={() => handleAdd(col.id)}
              >
                <FolderOpen className="h-4 w-4 mr-2" />
                {col.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {allCollections.length > 0 && unassignedCollections.length > 0 && (
        <Button
          variant="ghost"
          size="sm"
          className="h-6 gap-1 text-xs text-muted-foreground"
          disabled={isSuggesting || isPending}
          onClick={handleSuggest}
        >
          {isSuggesting ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Sparkles className="h-3 w-3" />
          )}
          {isSuggesting ? "Suggesting..." : "AI Suggest"}
        </Button>
      )}

      {allCollections.length === 0 && (
        <span className="text-xs text-muted-foreground">
          No collections yet. Create one in the library.
        </span>
      )}

      {suggestions.length > 0 && (
        <div className="w-full mt-2 space-y-1.5">
          <span className="text-xs font-medium text-muted-foreground flex items-center gap-1">
            <Sparkles className="h-3 w-3" />
            AI Suggestions
          </span>
          {suggestions.map((s) => (
            <TooltipProvider key={s.collectionId}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => handleAdd(s.collectionId)}
                    disabled={isPending}
                    className="flex items-center gap-2 w-full rounded-md border px-3 py-1.5 text-sm hover:bg-muted/50 transition-colors"
                  >
                    <FolderOpen className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="flex-1 text-left">{s.collectionName}</span>
                    <Badge
                      variant="outline"
                      className={`text-[10px] px-1.5 h-5 ${confidenceColors[s.confidence]}`}
                    >
                      {s.confidence}
                    </Badge>
                    <Check className="h-3.5 w-3.5 text-muted-foreground" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top">
                  <p className="max-w-xs text-xs">{s.reason}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ))}
        </div>
      )}

      {hasSuggested && suggestions.length === 0 && !isSuggesting && (
        <span className="text-xs text-muted-foreground">
          No collection suggestions — this document doesn&apos;t clearly match any existing collection.
        </span>
      )}
    </div>
  );
}
