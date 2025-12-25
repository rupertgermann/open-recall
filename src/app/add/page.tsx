"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { FileText, Link as LinkIcon, Loader2, CheckCircle, AlertCircle, Circle } from "lucide-react";
import { Header } from "@/components/layout/header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type ContentType = "url" | "text";

type StepStatus = {
  step: string;
  message: string;
  progress: number;
  error?: boolean;
};

const STEP_ORDER = ["fetching", "chunking", "summarizing", "extracting", "embedding", "saving", "complete"];

const STEP_LABELS: Record<string, string> = {
  fetching: "Fetch Content",
  chunking: "Chunk Text",
  summarizing: "Generate Summary",
  extracting: "Extract Entities",
  embedding: "Generate Embeddings",
  saving: "Save to Database",
  complete: "Complete",
};

export default function AddPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [contentType, setContentType] = useState<ContentType>("url");
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [title, setTitle] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [currentStatus, setCurrentStatus] = useState<StepStatus | null>(null);
  const [completedSteps, setCompletedSteps] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [isUpdateMode, setIsUpdateMode] = useState(false);
  const [updateDocumentId, setUpdateDocumentId] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const hasAutoStartedRef = useRef(false);

  useEffect(() => {
    const qpUrl = searchParams.get("url");
    const qpUpdate = searchParams.get("update");
    const qpStart = searchParams.get("start");
    
    // Handle update mode
    if (qpUpdate) {
      setIsUpdateMode(true);
      setUpdateDocumentId(qpUpdate);
      setContentType("url");
      
      if (qpStart === "1" && !hasAutoStartedRef.current) {
        hasAutoStartedRef.current = true;
        // Let state update settle before submitting
        setTimeout(() => {
          handleSubmit(new Event("submit") as any);
        }, 0);
      }
      return;
    }
    
    // Handle regular add mode
    if (!qpUrl) return;

    setContentType("url");
    setUrl(qpUrl);

    if (qpStart === "1" && !hasAutoStartedRef.current) {
      hasAutoStartedRef.current = true;
      // Let state update settle before submitting.
      setTimeout(() => {
        const form = document.querySelector("form");
        if (form) {
          form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
        }
      }, 0);
    }
  }, [searchParams]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsProcessing(true);
    setCompletedSteps(new Set());
    setCurrentStatus(null);

    abortControllerRef.current = new AbortController();

    try {
      const endpoint = isUpdateMode ? "/api/update-document" : "/api/ingest";
      const body = isUpdateMode 
        ? { documentId: updateDocumentId }
        : contentType === "url"
          ? { type: "url", url }
          : { type: "text", title, content: text };

      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok) {
        throw new Error("Failed to start processing");
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error("No response stream");

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));

              if (data.step === "done") {
                if (isUpdateMode && updateDocumentId) {
                  // Show completion state with back to doc link
                  setTimeout(() => setIsProcessing(false), 500);
                } else {
                  setTimeout(() => router.push("/library"), 500);
                }
                return;
              }

              if (data.error) {
                setError(data.message);
                setIsProcessing(false);
                return;
              }

              setCurrentStatus({
                step: data.step,
                message: data.message,
                progress: data.progress || 0,
              });

              const currentIndex = STEP_ORDER.indexOf(data.step);
              if (currentIndex > 0) {
                setCompletedSteps((prev) => {
                  const newSet = new Set(prev);
                  for (let i = 0; i < currentIndex; i++) {
                    newSet.add(STEP_ORDER[i]);
                  }
                  return newSet;
                });
              }

              if (data.step === "complete") {
                setCompletedSteps((prev) => {
                  const newSet = new Set(prev);
                  STEP_ORDER.forEach((s) => newSet.add(s));
                  return newSet;
                });
              }
            } catch {
              // Ignore parse errors
            }
          }
        }
      }
    } catch (error) {
      if (error instanceof Error && error.name !== "AbortError") {
        setError(error.message);
      }
      setIsProcessing(false);
    }
  };

  const handleCancel = () => {
    abortControllerRef.current?.abort();
    setIsProcessing(false);
    setCurrentStatus(null);
    setCompletedSteps(new Set());
  };

  const getStepIcon = (step: string) => {
    if (completedSteps.has(step)) {
      return <CheckCircle className="h-5 w-5 text-green-500" />;
    }
    if (currentStatus?.step === step) {
      return <Loader2 className="h-5 w-5 animate-spin text-primary" />;
    }
    return <Circle className="h-5 w-5 text-muted-foreground/30" />;
  };

  return (
    <div className="min-h-screen">
      <Header />

      <main className="container mx-auto px-4 py-8 max-w-2xl">
        <div className="flex flex-col gap-6">
          <div>
            <h1 className="text-3xl font-bold">
              {isUpdateMode ? "Updating Document" : "Add Content"}
            </h1>
            <p className="text-muted-foreground">
              {isUpdateMode 
                ? "Updating document with latest content from source"
                : "Add a URL or paste text to your knowledge base"
              }
            </p>
            {isUpdateMode && updateDocumentId && (
              <div className="mt-2">
                <Link 
                  href={`/library/${updateDocumentId}`}
                  className="text-sm text-primary hover:underline"
                >
                  ← Back to document
                </Link>
              </div>
            )}
          </div>

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

          {!isUpdateMode && (
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

              <div className="flex gap-2">
                {isProcessing ? (
                  <Button type="button" variant="outline" className="w-full" onClick={handleCancel}>
                    Cancel
                  </Button>
                ) : (
                  <Button
                    type="submit"
                    className="w-full"
                    disabled={(contentType === "url" && !url) || (contentType === "text" && (!title || !text))}
                  >
                    Add to Knowledge Base
                  </Button>
                )}
              </div>
            </form>
          )}

          {isUpdateMode && (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="flex gap-2">
                {isProcessing ? (
                  <Button type="button" variant="outline" className="w-full" onClick={handleCancel}>
                    Cancel
                  </Button>
                ) : (
                  <Button
                    type="submit"
                    className="w-full"
                  >
                    Update Document
                  </Button>
                )}
              </div>
            </form>
          )}
          {(isProcessing || currentStatus) && (
            <Card className="border-primary/20">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center justify-between">
                  <span>Processing Pipeline</span>
                  {currentStatus && (
                    <span className="text-sm font-normal text-muted-foreground">
                      {currentStatus.progress}%
                    </span>
                  )}
                </CardTitle>
                <CardDescription>
                  {currentStatus?.message || "Starting..."}
                </CardDescription>
                <div className="w-full bg-muted rounded-full h-2 mt-2">
                  <div
                    className="bg-primary h-2 rounded-full transition-all duration-300"
                    style={{ width: `${currentStatus?.progress || 0}%` }}
                  />
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {STEP_ORDER.map((step) => {
                    const isActive = currentStatus?.step === step;
                    const isCompleted = completedSteps.has(step);
                    const isPending = !isActive && !isCompleted;

                    return (
                      <div
                        key={step}
                        className={`flex items-center gap-3 transition-opacity ${isPending ? "opacity-40" : "opacity-100"
                          }`}
                      >
                        {getStepIcon(step)}
                        <div className="flex-1">
                          <span className={`text-sm ${isActive ? "font-medium" : ""}`}>
                            {STEP_LABELS[step]}
                          </span>
                          {isActive && currentStatus && (
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {currentStatus.message}
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Completion state for update mode */}
          {isUpdateMode && !isProcessing && completedSteps.has("complete") && !error && (
            <Card className="border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950/20">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2 text-green-700 dark:text-green-300">
                  <CheckCircle className="h-5 w-5" />
                  Document Updated Successfully
                </CardTitle>
                <CardDescription className="text-green-600 dark:text-green-400">
                  The document has been updated with the latest content from its source.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex gap-2">
                  <Link href={`/library/${updateDocumentId}`}>
                    <Button className="flex-1">
                      Back to Document
                    </Button>
                  </Link>
                  <Link href="/library">
                    <Button variant="outline" className="flex-1">
                      View Library
                    </Button>
                  </Link>
                </div>
              </CardContent>
            </Card>
          )}

          {error && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 text-destructive">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              <span className="text-sm">{error}</span>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
