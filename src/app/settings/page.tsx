"use client";

import React, { useState, useEffect } from "react";
import { Save, RefreshCw, CheckCircle, Loader2, Server, Cpu, Database, MessageSquare, Binary } from "lucide-react";
import { getAISettings, saveAISettings, getDatabaseStats, testAIConnection, type AISettings, type ProviderSettings } from "@/actions/settings";
import { Header } from "@/components/layout/header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Provider = "local" | "openai";
type ConnectionStatus = "connected" | "disconnected" | "testing";

export default function SettingsPage() {
  const [isLoading, setIsLoading] = useState(true);

  const [openaiApiKey, setOpenaiApiKey] = useState("");

  // Chat provider settings
  const [chatProvider, setChatProvider] = useState<Provider>("local");
  const [chatBaseUrl, setChatBaseUrl] = useState("http://localhost:11434/v1");
  const [chatModel, setChatModel] = useState("llama3.2:8b");
  const [chatConnectionStatus, setChatConnectionStatus] = useState<ConnectionStatus>("disconnected");
  const [chatConnectionError, setChatConnectionError] = useState<string | null>(null);
  const [chatAvailableModels, setChatAvailableModels] = useState<string[]>([
    "llama3.2:8b",
    "mistral:7b", 
    "qwen2.5:7b",
  ]);

  // OpenAI-specific chat settings
  const [reasoningEffort, setReasoningEffort] = useState("medium");
  const [verbosity, setVerbosity] = useState("medium");
  const [webSearchEnabled, setWebSearchEnabled] = useState(false);

  // Embedding provider settings
  const [embeddingProvider, setEmbeddingProvider] = useState<Provider>("local");
  const [embeddingBaseUrl, setEmbeddingBaseUrl] = useState("http://localhost:11434/v1");
  const [embeddingModel, setEmbeddingModel] = useState("nomic-embed-text");
  const [embeddingConnectionStatus, setEmbeddingConnectionStatus] = useState<ConnectionStatus>("disconnected");
  const [embeddingConnectionError, setEmbeddingConnectionError] = useState<string | null>(null);
  const [embeddingAvailableModels, setEmbeddingAvailableModels] = useState<string[]>([
    "nomic-embed-text",
    "mxbai-embed-large",
  ]);

  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [dbStats, setDbStats] = useState({ documents: 0, entities: 0, relationships: 0 });

  // Auto-save function with debouncing
  const autoSave = React.useCallback(
    debounce(async () => {
      setIsSaving(true);
      try {
        const openaiBaseUrl = "https://api.openai.com/v1";
        const sharedKey = openaiApiKey || undefined;

        await saveAISettings({
          openaiApiKey: sharedKey,
          chat: {
            provider: chatProvider,
            baseUrl: chatProvider === "openai" ? openaiBaseUrl : chatBaseUrl,
            model: chatModel,
            apiKey: chatProvider === "openai" ? sharedKey : undefined,
            // Only include OpenAI-specific options for OpenAI provider
            ...(chatProvider === "openai" && {
              reasoningEffort: reasoningEffort as "low" | "medium" | "high",
              verbosity: verbosity as "low" | "medium" | "high",
              webSearchEnabled: webSearchEnabled,
            }),
          },
          embedding: {
            provider: embeddingProvider,
            baseUrl: embeddingProvider === "openai" ? openaiBaseUrl : embeddingBaseUrl,
            model: embeddingModel,
            apiKey: embeddingProvider === "openai" ? sharedKey : undefined,
            // Embeddings don't use reasoning or web search
          },
        });
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      } catch (error) {
        console.error("Failed to auto-save settings:", error);
      } finally {
        setIsSaving(false);
      }
    }, 1000), // 1 second debounce
    [chatProvider, chatBaseUrl, chatModel, reasoningEffort, verbosity, webSearchEnabled, embeddingProvider, embeddingBaseUrl, embeddingModel, openaiApiKey]
  );

  // Simple debounce function
  function debounce<T extends (...args: any[]) => any>(func: T, wait: number): T {
    let timeout: NodeJS.Timeout;
    return ((...args: any[]) => {
      clearTimeout(timeout);
      timeout = setTimeout(() => func(...args), wait);
    }) as T;
  }

  // Load settings on mount
  useEffect(() => {
    async function loadSettings() {
      try {
        const [settings, stats] = await Promise.all([
          getAISettings(),
          getDatabaseStats(),
        ]);
        // Chat settings
        setChatProvider(settings.chat.provider);
        setChatBaseUrl(settings.chat.baseUrl);
        setChatModel(settings.chat.model);
        // OpenAI-specific chat settings
        setReasoningEffort(settings.chat.reasoningEffort || "medium");
        setVerbosity(settings.chat.verbosity || "medium");
        setWebSearchEnabled(settings.chat.webSearchEnabled || false);
        // Embedding settings
        setEmbeddingProvider(settings.embedding.provider);
        setEmbeddingBaseUrl(settings.embedding.baseUrl);
        setEmbeddingModel(settings.embedding.model);

        const keyFromSettings =
          settings.chat.apiKey || settings.embedding.apiKey || "";
        setOpenaiApiKey(keyFromSettings);
        // Stats
        setDbStats(stats);
      } catch (error) {
        console.error("Failed to load settings:", error);
      } finally {
        setIsLoading(false);
      }
    }
    loadSettings();
  }, []);

  // Auto-save when any setting changes
  useEffect(() => {
    autoSave();
  }, [chatProvider, chatBaseUrl, chatModel, reasoningEffort, verbosity, webSearchEnabled, embeddingProvider, embeddingBaseUrl, embeddingModel, openaiApiKey]);

  const testChatConnection = async () => {
    setChatConnectionStatus("testing");
    setChatConnectionError(null);

    try {
      const result = await testAIConnection(
        chatProvider === "openai" ? "https://api.openai.com/v1" : chatBaseUrl,
        chatProvider === "openai" ? (openaiApiKey || undefined) : undefined
      );
      if (result.success) {
        setChatConnectionStatus("connected");
        if (result.models && result.models.length > 0) {
          let models: string[] = [];
          
          if (chatProvider === "openai") {
            // For OpenAI, show only chat models (non-embedding models)
            models = result.models
              .filter((m: string) => !m.startsWith("text-embedding-"))
              .filter((m: string) => !m.includes("embedding"));
          } else {
            // For local providers, show non-embedding models
            models = result.models.filter((m: string) => !m.includes("embed"));
          }
          
          // Always include the currently configured model in the list
          if (chatModel && !models.includes(chatModel)) {
            models = [chatModel, ...models];
          }
          
          setChatAvailableModels(models);
          // Don't auto-switch the model - keep the user's configured choice
        }
      } else {
        setChatConnectionStatus("disconnected");
        setChatConnectionError(result.error || "Connection failed");
      }
    } catch (error) {
      setChatConnectionStatus("disconnected");
      setChatConnectionError(error instanceof Error ? error.message : "Connection failed");
    }
  };

  const testEmbeddingConnection = async () => {
    setEmbeddingConnectionStatus("testing");
    setEmbeddingConnectionError(null);

    try {
      const result = await testAIConnection(
        embeddingProvider === "openai" ? "https://api.openai.com/v1" : embeddingBaseUrl,
        embeddingProvider === "openai" ? (openaiApiKey || undefined) : undefined
      );
      if (result.success) {
        setEmbeddingConnectionStatus("connected");
        if (result.models && result.models.length > 0) {
          const openaiModels = result.models.filter((m: string) => m.startsWith("text-embedding-"));
          const localModels = result.models.filter((m: string) => m.includes("embed"));

          let models = embeddingProvider === "openai" ? openaiModels : localModels;
          
          // Always include the currently configured model in the list
          if (embeddingModel && !models.includes(embeddingModel)) {
            models = [embeddingModel, ...models];
          }
          
          setEmbeddingAvailableModels(models);
          // Don't auto-switch the model - keep the user's configured choice
        }
      } else {
        setEmbeddingConnectionStatus("disconnected");
        setEmbeddingConnectionError(result.error || "Connection failed");
      }
    } catch (error) {
      setEmbeddingConnectionStatus("disconnected");
      setEmbeddingConnectionError(error instanceof Error ? error.message : "Connection failed");
    }
  };

  // Apply OpenAI defaults when switching provider
  useEffect(() => {
    if (chatProvider === "openai") {
      setChatModel((prev) => (prev === "llama3.2:8b" ? "gpt-5.2" : prev));
      // Set default OpenAI models until connection test
      setChatAvailableModels([
        "gpt-5.2",
        "gpt-5-nano",
        "gpt-5-mini",
      ]);
      setChatConnectionStatus("disconnected");
      setChatConnectionError(null);
    } else {
      setChatModel((prev) => (prev.startsWith("gpt-") ? "llama3.2:8b" : prev));
      // Reset to local models
      setChatAvailableModels([
        "llama3.2:8b",
        "mistral:7b", 
        "qwen2.5:7b",
      ]);
      setChatConnectionStatus("disconnected");
      setChatConnectionError(null);
    }
  }, [chatProvider]);

  useEffect(() => {
    if (embeddingProvider === "openai") {
      setEmbeddingModel((prev) => (prev === "nomic-embed-text" ? "text-embedding-3-small" : prev));
      // Set default OpenAI embedding models until connection test
      setEmbeddingAvailableModels([
        "text-embedding-3-small",
        "text-embedding-3-large",
      ]);
      setEmbeddingConnectionStatus("disconnected");
      setEmbeddingConnectionError(null);
    } else {
      setEmbeddingModel((prev) => (prev.startsWith("text-embedding-") ? "nomic-embed-text" : prev));
      // Reset to local models
      setEmbeddingAvailableModels([
        "nomic-embed-text",
        "mxbai-embed-large",
      ]);
      setEmbeddingConnectionStatus("disconnected");
      setEmbeddingConnectionError(null);
    }
  }, [embeddingProvider]);

  // Connection tests are now ONLY triggered by user interaction (clicking Test button)
  // Removed auto-test on mount/state change to prevent cascading server calls

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <main className="container mx-auto px-4 py-8 max-w-3xl flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </main>
      </div>
    );
  }

  // Helper component for provider config
  const ProviderConfig = ({
    title,
    description,
    icon: Icon,
    provider,
    setProvider,
    baseUrl,
    setBaseUrl,
    model,
    setModel,
    connectionStatus,
    connectionError,
    availableModels,
    testConnection,
    // OpenAI-specific props (only used for chat provider)
    reasoningEffort,
    setReasoningEffort,
    verbosity,
    setVerbosity,
    webSearchEnabled,
    setWebSearchEnabled,
    isChatProvider = false,
  }: {
    title: string;
    description: string;
    icon: React.ElementType;
    provider: Provider;
    setProvider: (p: Provider) => void;
    baseUrl: string;
    setBaseUrl: (url: string) => void;
    model: string;
    setModel: (m: string) => void;
    connectionStatus: ConnectionStatus;
    connectionError: string | null;
    availableModels: string[];
    testConnection: () => void;
    reasoningEffort?: string;
    setReasoningEffort?: (value: "low" | "medium" | "high") => void;
    verbosity?: string;
    setVerbosity?: (value: "low" | "medium" | "high") => void;
    webSearchEnabled?: boolean;
    setWebSearchEnabled?: (value: boolean) => void;
    isChatProvider?: boolean;
  }) => (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Icon className="h-5 w-5" />
          {title}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2">
          <Button
            variant={provider === "local" ? "default" : "outline"}
            onClick={() => setProvider("local")}
            className="flex-1"
          >
            <Cpu className="mr-2 h-4 w-4" />
            Local
          </Button>
          <Button
            variant={provider === "openai" ? "default" : "outline"}
            onClick={() => setProvider("openai")}
            className="flex-1"
          >
            <Server className="mr-2 h-4 w-4" />
            OpenAI
          </Button>
        </div>

        <div className="space-y-4 pt-4 border-t">
          {provider === "local" && (
            <div className="space-y-2">
              <label className="text-sm font-medium">Base URL</label>
              <div className="flex gap-2">
                <Input
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder="http://localhost:11434/v1"
                />
                <Button
                  variant="outline"
                  onClick={testConnection}
                  disabled={connectionStatus === "testing"}
                >
                  {connectionStatus === "testing" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : connectionStatus === "connected" ? (
                    <CheckCircle className="h-4 w-4 text-green-500" />
                  ) : (
                    <RefreshCw className="h-4 w-4" />
                  )}
                </Button>
              </div>
              <div className="flex items-center gap-2">
                {connectionStatus === "connected" && (
                  <Badge variant="outline" className="text-green-500 border-green-500">
                    Connected
                  </Badge>
                )}
                {connectionStatus === "disconnected" && (
                  <Badge variant="outline" className="text-muted-foreground">
                    Not tested
                  </Badge>
                )}
                {connectionError && (
                  <span className="text-xs text-destructive">{connectionError}</span>
                )}
              </div>
            </div>
          )}

          <div className="space-y-2">
            <label className="text-sm font-medium">Model</label>
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              disabled={availableModels.length === 0}
              className="h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm disabled:opacity-50"
            >
              {availableModels.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>

          {/* OpenAI-specific options */}
          {provider === "openai" && isChatProvider && (
            <div className="space-y-4 pt-4 border-t">
              <div className="space-y-2">
                <label className="text-sm font-medium">Reasoning Effort</label>
                <Select 
                  value={reasoningEffort} 
                  onValueChange={(value: "low" | "medium" | "high") => setReasoningEffort?.(value)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Controls the reasoning effort level for response generation
                </p>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Verbosity</label>
                <Select 
                  value={verbosity} 
                  onValueChange={(value: "low" | "medium" | "high") => setVerbosity?.(value)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Constrains response verbosity (low, medium, high)
                </p>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Web Search</label>
                <div className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    id="web-search"
                    checked={webSearchEnabled}
                    onChange={(e) => setWebSearchEnabled?.(e.target.checked)}
                    className="rounded"
                  />
                  <label htmlFor="web-search" className="text-sm">
                    Enable web search for responses
                  </label>
                </div>
                <p className="text-xs text-muted-foreground">
                  Allow the model to search the web for current information
                </p>
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );

  return (
    <div className="min-h-screen">
      <Header />

      <main className="container mx-auto px-4 py-8 max-w-3xl">
        <div className="flex flex-col gap-6">
          <div>
            <h1 className="text-3xl font-bold">Settings</h1>
            <p className="text-muted-foreground">
              Configure separate AI providers for chat and embeddings
            </p>
          </div>

          {/* Auto-save Status */}
          <div className="flex items-center justify-center p-4 bg-muted/50 rounded-lg">
            {isSaving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Auto-saving...</span>
              </>
            ) : saved ? (
              <>
                <CheckCircle className="mr-2 h-4 w-4 text-green-500" />
                <span className="text-sm text-green-500">All changes saved</span>
              </>
            ) : (
              <>
                <div className="mr-2 h-4 w-4 rounded-full bg-muted" />
                <span className="text-sm text-muted-foreground">Changes auto-save automatically</span>
              </>
            )}
          </div>

          {(chatProvider === "openai" || embeddingProvider === "openai") && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Server className="h-5 w-5" />
                  OpenAI
                </CardTitle>
                <CardDescription>Used when you select OpenAI as provider</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                <label className="text-sm font-medium">API Key</label>
                <Input
                  type="password"
                  value={openaiApiKey}
                  onChange={(e) => setOpenaiApiKey(e.target.value)}
                  placeholder="sk-..."
                />
                <p className="text-xs text-muted-foreground">
                  Stored locally, never sent to our servers
                </p>
              </CardContent>
            </Card>
          )}

          {/* Chat Provider */}
          <ProviderConfig
            title="Chat Provider"
            description="Used for summaries, entity extraction, flashcards, and chat"
            icon={MessageSquare}
            provider={chatProvider}
            setProvider={setChatProvider}
            baseUrl={chatBaseUrl}
            setBaseUrl={setChatBaseUrl}
            model={chatModel}
            setModel={setChatModel}
            connectionStatus={chatConnectionStatus}
            connectionError={chatConnectionError}
            availableModels={chatAvailableModels}
            testConnection={testChatConnection}
            // OpenAI-specific options for chat
            reasoningEffort={reasoningEffort}
            setReasoningEffort={setReasoningEffort}
            verbosity={verbosity}
            setVerbosity={setVerbosity}
            webSearchEnabled={webSearchEnabled}
            setWebSearchEnabled={setWebSearchEnabled}
            isChatProvider={true}
          />

          {/* Embedding Provider */}
          <ProviderConfig
            title="Embedding Provider"
            description="Used for generating vector embeddings for semantic search"
            icon={Binary}
            provider={embeddingProvider}
            setProvider={setEmbeddingProvider}
            baseUrl={embeddingBaseUrl}
            setBaseUrl={setEmbeddingBaseUrl}
            model={embeddingModel}
            setModel={setEmbeddingModel}
            connectionStatus={embeddingConnectionStatus}
            connectionError={embeddingConnectionError}
            availableModels={embeddingAvailableModels}
            testConnection={testEmbeddingConnection}
            // Embedding provider doesn't use OpenAI-specific options
            isChatProvider={false}
          />

          {/* Database Status */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Database className="h-5 w-5" />
                Database
              </CardTitle>
              <CardDescription>
                PostgreSQL with pgvector
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <p className="text-sm font-medium">Connection Status</p>
                  <p className="text-xs text-muted-foreground">
                    localhost:5432/openrecall
                  </p>
                </div>
                <Badge variant="outline" className="text-green-500 border-green-500">
                  Connected
                </Badge>
              </div>

              <div className="grid grid-cols-3 gap-4 mt-4 pt-4 border-t">
                <div className="text-center">
                  <p className="text-2xl font-bold">{dbStats.documents}</p>
                  <p className="text-xs text-muted-foreground">Documents</p>
                </div>
                <div className="text-center">
                  <p className="text-2xl font-bold">{dbStats.entities}</p>
                  <p className="text-xs text-muted-foreground">Entities</p>
                </div>
                <div className="text-center">
                  <p className="text-2xl font-bold">{dbStats.relationships}</p>
                  <p className="text-xs text-muted-foreground">Relationships</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}
