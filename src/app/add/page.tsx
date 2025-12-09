"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Globe, FileText, Link as LinkIcon, Loader2, CheckCircle, AlertCircle } from "lucide-react";
import { ingestUrl, ingestText } from "@/actions/ingest";
import { Header } from "@/components/layout/header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type ContentType = "url" | "text" | "file";
type ProcessingStep = "idle" | "fetching" | "chunking" | "summarizing" | "extracting" | "embedding" | "saving" | "complete" | "error";

const processingSteps = [
  { key: "fetching", label: "Fetching content..." },
  { key: "chunking", label: "Splitting into chunks..." },
  { key: "summarizing", label: "Generating summary..." },
  { key: "extracting", label: "Extracting entities..." },
  { key: "embedding", label: "Generating embeddings..." },
  { key: "saving", label: "Saving to database..." },
  { key: "complete", label: "Complete!" },
];

export default function AddPage() {
  const router = useRouter();
  const [contentType, setContentType] = useState<ContentType>("url");
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [title, setTitle] = useState("");
  const [processingStep, setProcessingStep] = useState<ProcessingStep>("idle");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    startTransition(async () => {
      try {
        // Show progress UI
        setProcessingStep("fetching");

        let result;
        if (contentType === "url") {
          // Ingest URL
          setProcessingStep("fetching");
          result = await ingestUrl(url);
        } else {
          // Ingest text
          setProcessingStep("saving");
          result = await ingestText(title, text);
        }

        if (result.success) {
          setProcessingStep("complete");
          await new Promise((r) => setTimeout(r, 500));
          router.push("/library");
        } else {
          setProcessingStep("error");
          setError(result.error || "Failed to process content");
        }
      } catch (err) {
        setProcessingStep("error");
        setError(err instanceof Error ? err.message : "Failed to process content. Please try again.");
      }
    });
  };

  const isProcessing = isPending || (processingStep !== "idle" && processingStep !== "complete" && processingStep !== "error");

  return (
    <div className="min-h-screen bg-background">
      <Header />

      <main className="container mx-auto px-4 py-8 max-w-2xl">
        <div className="flex flex-col gap-6">
          <div>
            <h1 className="text-3xl font-bold">Add Content</h1>
            <p className="text-muted-foreground">
              Add a URL, paste text, or upload a file to your knowledge base
            </p>
          </div>

          {/* Content Type Selector */}
          <div className="flex gap-2">
            <Button
              variant={contentType === "url" ? "default" : "outline"}
              onClick={() => setContentType("url")}
              className="flex-1 gap-2"
              disabled={isProcessing}
            >
              <LinkIcon className="h-4 w-4" />
              URL
            </Button>
            <Button
              variant={contentType === "text" ? "default" : "outline"}
              onClick={() => setContentType("text")}
              className="flex-1 gap-2"
              disabled={isProcessing}
            >
              <FileText className="h-4 w-4" />
              Text
            </Button>
          </div>

          {/* Input Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            {contentType === "url" && (
              <div className="space-y-2">
                <label className="text-sm font-medium">URL</label>
                <Input
                  type="url"
                  placeholder="https://example.com/article"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  disabled={isProcessing}
                  required
                />
                <p className="text-xs text-muted-foreground">
                  Supports web articles, YouTube videos, and more
                </p>
              </div>
            )}

            {contentType === "text" && (
              <>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Title</label>
                  <Input
                    placeholder="My notes on..."
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    disabled={isProcessing}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Content</label>
                  <Textarea
                    placeholder="Paste or type your content here..."
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    disabled={isProcessing}
                    rows={10}
                    required
                  />
                </div>
              </>
            )}

            {/* Processing Status */}
            {processingStep !== "idle" && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg">Processing Pipeline</CardTitle>
                  <CardDescription>
                    Extracting knowledge from your content
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {processingSteps.map((step, index) => {
                      const currentIndex = processingSteps.findIndex(
                        (s) => s.key === processingStep
                      );
                      const isComplete = index < currentIndex;
                      const isCurrent = step.key === processingStep;
                      const isPending = index > currentIndex;

                      return (
                        <div
                          key={step.key}
                          className={`flex items-center gap-3 ${
                            isPending ? "text-muted-foreground" : ""
                          }`}
                        >
                          {isComplete ? (
                            <CheckCircle className="h-5 w-5 text-green-500" />
                          ) : isCurrent ? (
                            <Loader2 className="h-5 w-5 animate-spin text-primary" />
                          ) : (
                            <div className="h-5 w-5 rounded-full border-2 border-muted" />
                          )}
                          <span className={isCurrent ? "font-medium" : ""}>
                            {step.label}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Error Message */}
            {error && (
              <div className="flex items-center gap-2 text-destructive">
                <AlertCircle className="h-4 w-4" />
                <span className="text-sm">{error}</span>
              </div>
            )}

            {/* Submit Button */}
            <Button
              type="submit"
              className="w-full"
              disabled={isProcessing || (contentType === "url" && !url) || (contentType === "text" && (!title || !text))}
            >
              {isProcessing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Processing...
                </>
              ) : (
                "Add to Knowledge Base"
              )}
            </Button>
          </form>
        </div>
      </main>
    </div>
  );
}
