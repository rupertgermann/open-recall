"use client";

import { useState, useTransition } from "react";
import { X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { changeDocumentTag, generateDocumentTags } from "@/actions/documents";

export function TagsEditor({ documentId, initialTags }: { documentId: string; initialTags: string[] }) {
  const [tags, setTags] = useState<string[]>(initialTags);
  const [input, setInput] = useState("");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const persist = (operation: "add" | "remove", name: string) => {
    setError(null);
    startTransition(async () => {
      try {
        const res = await changeDocumentTag({ documentId, name, operation });
        setTags(res.tags);
        if (operation === "add") setInput("");
      } catch {
        setError("Failed to save tag. Try again.");
      }
    });
  };

  const add = () => {
    const v = input.trim().toLowerCase();
    if (!v) return;
    persist("add", v);
  };

  const remove = (name: string) => {
    persist("remove", name);
  };

  const generate = () => {
    setError(null);
    startTransition(async () => {
      try {
        const res = await generateDocumentTags(documentId);
        setTags(res.tags);
      } catch {
        setError("Failed to generate tags. Try again.");
      }
    });
  };

  return (
    <div className="space-y-2">
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
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
