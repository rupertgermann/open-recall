"use client";

import { useMemo, useState, useTransition } from "react";
import { X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { generateDocumentTags, updateDocumentTags } from "@/actions/documents";

export function TagsEditor({ documentId, initialTags }: { documentId: string; initialTags: string[] }) {
  const [tags, setTags] = useState<string[]>(initialTags);
  const [input, setInput] = useState("");
  const [isPending, startTransition] = useTransition();

  const normalized = useMemo(() => tags.map((t) => t.trim().toLowerCase()).filter(Boolean), [tags]);

  const persist = (next: string[]) => {
    startTransition(async () => {
      const res = await updateDocumentTags(documentId, next);
      setTags(res.tags);
    });
  };

  const add = () => {
    const v = input.trim().toLowerCase();
    if (!v) return;
    if (normalized.includes(v)) {
      setInput("");
      return;
    }
    setInput("");
    persist([...tags, v]);
  };

  const remove = (name: string) => {
    persist(tags.filter((t) => t !== name));
  };

  const generate = () => {
    startTransition(async () => {
      const res = await generateDocumentTags(documentId);
      if (res.tags) setTags(res.tags);
    });
  };

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          placeholder="Add tag…"
          disabled={isPending}
        />
        <Button type="button" variant="outline" onClick={add} disabled={isPending || input.trim().length === 0}>
          Add
        </Button>
        <Button type="button" variant="outline" onClick={generate} disabled={isPending}>
          Generate tags with AI
        </Button>
      </div>

      {tags.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {tags.map((t) => (
            <Badge key={t} variant="secondary" className="gap-1">
              {t}
              <button type="button" onClick={() => remove(t)} disabled={isPending}>
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      ) : (
        <div className="text-sm text-muted-foreground">No tags</div>
      )}
    </div>
  );
}
