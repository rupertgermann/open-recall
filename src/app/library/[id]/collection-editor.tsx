"use client";

import { useState, useEffect, useTransition } from "react";
import { FolderOpen, Plus, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  type CollectionWithCount,
} from "@/actions/collections";

type CollectionEditorProps = {
  documentId: string;
};

export function CollectionEditor({ documentId }: CollectionEditorProps) {
  const [allCollections, setAllCollections] = useState<CollectionWithCount[]>([]);
  const [assignedIds, setAssignedIds] = useState<string[]>([]);
  const [isPending, startTransition] = useTransition();

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
    });
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

      {allCollections.length === 0 && (
        <span className="text-xs text-muted-foreground">
          No collections yet. Create one in the library.
        </span>
      )}
    </div>
  );
}
