"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Hash, Maximize2 } from "lucide-react";

interface Chunk {
  id: string;
  content: string;
  contentHash: string | null;
  chunkIndex: number;
  tokenCount: number | null;
  embedding: number[] | null;
  embeddingCacheId: string | null;
  embeddingStatus: string;
  embeddingPurpose: string | null;
  createdAt: Date;
  documentId: string;
}

interface ChunksModalProps {
  document: {
    title: string;
    chunks: Chunk[];
  };
}

export function ChunksModal({ document }: ChunksModalProps) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <Maximize2 className="h-4 w-4" />
          View All Chunks
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Hash className="h-5 w-5" />
            All Content Chunks
          </DialogTitle>
          <DialogDescription>
            {document.chunks.length} chunks from "{document.title}"
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-[60vh] pr-4">
          <div className="space-y-4">
            {document.chunks.map((chunk: Chunk, index: number) => (
              <div
                key={chunk.id}
                className="p-4 rounded-lg bg-muted/50 border"
              >
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-medium text-muted-foreground">
                    Chunk {index + 1}
                  </span>
                  {chunk.tokenCount && (
                    <span className="text-sm text-muted-foreground">
                      ~{chunk.tokenCount} tokens
                    </span>
                  )}
                </div>
                <div className="prose prose-sm max-w-none dark:prose-invert">
                  <p className="whitespace-pre-wrap text-sm leading-relaxed">
                    {chunk.content}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
