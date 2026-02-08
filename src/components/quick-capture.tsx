"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, X, Send, Link2, StickyNote, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

type CaptureMode = "url" | "note";

export function QuickCapture() {
  const [isOpen, setIsOpen] = useState(false);
  const [mode, setMode] = useState<CaptureMode>("note");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [url, setUrl] = useState("");
  const [isPending, startTransition] = useTransition();
  const { toast } = useToast();
  const router = useRouter();

  const reset = () => {
    setTitle("");
    setContent("");
    setUrl("");
  };

  const handleSubmit = () => {
    if (mode === "url") {
      if (!url.trim()) return;
      // Navigate to the add page with the URL pre-filled
      const qs = new URLSearchParams({ url: url.trim() });
      router.push(`/add?${qs.toString()}`);
      setIsOpen(false);
      reset();
      return;
    }

    // Note mode - submit directly via API
    if (!content.trim()) return;

    startTransition(async () => {
      try {
        const noteTitle = title.trim() || `Quick note - ${new Date().toLocaleString()}`;
        const res = await fetch("/api/ingest", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "text",
            title: noteTitle,
            content: content.trim(),
          }),
        });

        if (!res.ok) throw new Error("Failed to save note");

        toast({ title: "Note saved", description: `"${noteTitle}" added to your knowledge base.` });
        setIsOpen(false);
        reset();
      } catch (error) {
        toast({
          title: "Error",
          description: "Failed to save note. Please try again.",
          variant: "destructive",
        });
      }
    });
  };

  return (
    <>
      {/* Floating Action Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          "fixed bottom-6 right-6 z-50 h-14 w-14 rounded-full shadow-lg flex items-center justify-center transition-all duration-200",
          "bg-primary text-primary-foreground hover:scale-110 hover:shadow-xl",
          isOpen && "rotate-45"
        )}
        aria-label="Quick capture"
      >
        {isOpen ? <X className="h-6 w-6" /> : <Plus className="h-6 w-6" />}
      </button>

      {/* Capture Panel */}
      {isOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40 bg-black/20 backdrop-blur-sm"
            onClick={() => {
              setIsOpen(false);
              reset();
            }}
          />

          {/* Panel */}
          <div className="fixed bottom-24 right-6 z-50 w-96 rounded-xl border bg-card shadow-2xl animate-in slide-in-from-bottom-4 fade-in duration-200">
            <div className="p-4">
              {/* Mode Tabs */}
              <div className="flex gap-1 mb-4 p-1 bg-muted rounded-lg">
                <button
                  onClick={() => setMode("note")}
                  className={cn(
                    "flex-1 flex items-center justify-center gap-2 py-2 rounded-md text-sm font-medium transition-colors",
                    mode === "note"
                      ? "bg-background shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <StickyNote className="h-4 w-4" />
                  Quick Note
                </button>
                <button
                  onClick={() => setMode("url")}
                  className={cn(
                    "flex-1 flex items-center justify-center gap-2 py-2 rounded-md text-sm font-medium transition-colors",
                    mode === "url"
                      ? "bg-background shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <Link2 className="h-4 w-4" />
                  Save URL
                </button>
              </div>

              {mode === "note" ? (
                <div className="space-y-3">
                  <Input
                    placeholder="Title (optional)"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    autoFocus
                  />
                  <Textarea
                    placeholder="What's on your mind?"
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    rows={4}
                    className="resize-none"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                        handleSubmit();
                      }
                    }}
                  />
                </div>
              ) : (
                <div className="space-y-3">
                  <Input
                    placeholder="Paste a URL..."
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleSubmit();
                    }}
                  />
                  <p className="text-xs text-muted-foreground">
                    Articles, YouTube videos, and PDFs are supported.
                  </p>
                </div>
              )}

              {/* Submit */}
              <div className="flex items-center justify-between mt-4">
                <span className="text-xs text-muted-foreground">
                  {mode === "note" ? "⌘+Enter to save" : "Enter to add"}
                </span>
                <Button
                  size="sm"
                  onClick={handleSubmit}
                  disabled={
                    isPending ||
                    (mode === "note" && !content.trim()) ||
                    (mode === "url" && !url.trim())
                  }
                  className="gap-2"
                >
                  {isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                  {mode === "note" ? "Save Note" : "Add URL"}
                </Button>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}
