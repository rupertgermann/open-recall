"use client";

import Link from "next/link";
import { FileText, Tag } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ChatSourceReference, ChatEntityReference } from "@/lib/chat/types";

type ChatSourcesProps = {
  sources?: ChatSourceReference[];
  entities?: ChatEntityReference[];
  className?: string;
};

export function ChatSources({ sources, entities, className }: ChatSourcesProps) {
  const hasSources = sources && sources.length > 0;
  const hasEntities = entities && entities.length > 0;

  if (!hasSources && !hasEntities) return null;

  return (
    <div className={cn("flex flex-wrap gap-2 mt-2", className)}>
      {hasSources &&
        sources.map((source) => (
          <Link
            key={source.documentId}
            href={`/library/${source.documentId}`}
            className="inline-flex items-center gap-1.5 rounded-md border bg-background px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          >
            <FileText className="h-3 w-3 shrink-0" />
            <span className="truncate max-w-[180px]">{source.title}</span>
          </Link>
        ))}
      {hasEntities &&
        entities.map((entity) => (
          <Link
            key={entity.id}
            href={`/graph?entity=${entity.id}`}
            className="inline-flex items-center gap-1.5 rounded-md border bg-background px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          >
            <Tag className="h-3 w-3 shrink-0" />
            <span className="truncate max-w-[180px]">{entity.name}</span>
            <span className="text-[10px] opacity-60">({entity.type})</span>
          </Link>
        ))}
    </div>
  );
}
