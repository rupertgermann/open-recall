"use client";

import { useState } from "react";
import { Save, RefreshCw, CheckCircle, AlertCircle, Loader2, Server, Cpu, Database } from "lucide-react";
import { Header } from "@/components/layout/header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type Provider = "local" | "openai";
type ConnectionStatus = "connected" | "disconnected" | "testing";

export default function SettingsPage() {
  const [provider, setProvider] = useState<Provider>("local");
  const [baseUrl, setBaseUrl] = useState("http://localhost:11434/v1");
  const [model, setModel] = useState("llama3.2:8b");
  const [embeddingModel, setEmbeddingModel] = useState("nomic-embed-text");
  const [openaiKey, setOpenaiKey] = useState("");
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("disconnected");
  const [availableModels, setAvailableModels] = useState<string[]>([
    "llama3.2:8b",
    "mistral:7b",
    "qwen2.5:7b",
    "nomic-embed-text",
    "mxbai-embed-large",
  ]);
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const testConnection = async () => {
    setConnectionStatus("testing");
    // Simulate connection test
    await new Promise((r) => setTimeout(r, 1500));
    setConnectionStatus("connected");
  };

  const handleSave = async () => {
    setIsSaving(true);
    // Simulate save
    await new Promise((r) => setTimeout(r, 800));
    setIsSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="min-h-screen bg-background">
      <Header />

      <main className="container mx-auto px-4 py-8 max-w-3xl">
        <div className="flex flex-col gap-6">
          <div>
            <h1 className="text-3xl font-bold">Settings</h1>
            <p className="text-muted-foreground">
              Configure your AI provider and application preferences
            </p>
          </div>

          {/* Provider Selection */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Server className="h-5 w-5" />
                AI Provider
              </CardTitle>
              <CardDescription>
                Choose between local AI (Ollama) or cloud (OpenAI)
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-2">
                <Button
                  variant={provider === "local" ? "default" : "outline"}
                  onClick={() => setProvider("local")}
                  className="flex-1"
                >
                  <Cpu className="mr-2 h-4 w-4" />
                  Local (Ollama)
                </Button>
                <Button
                  variant={provider === "openai" ? "default" : "outline"}
                  onClick={() => setProvider("openai")}
                  className="flex-1"
                >
                  <Server className="mr-2 h-4 w-4" />
                  Cloud (OpenAI)
                </Button>
              </div>

              {provider === "local" && (
                <div className="space-y-4 pt-4 border-t">
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
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium">Chat Model</label>
                    <select
                      value={model}
                      onChange={(e) => setModel(e.target.value)}
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    >
                      {availableModels
                        .filter((m) => !m.includes("embed"))
                        .map((m) => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))}
                    </select>
                    <p className="text-xs text-muted-foreground">
                      Used for summarization, entity extraction, and chat
                    </p>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium">Embedding Model</label>
                    <select
                      value={embeddingModel}
                      onChange={(e) => setEmbeddingModel(e.target.value)}
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    >
                      {availableModels
                        .filter((m) => m.includes("embed"))
                        .map((m) => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))}
                    </select>
                    <p className="text-xs text-muted-foreground">
                      Used for generating vector embeddings
                    </p>
                  </div>
                </div>
              )}

              {provider === "openai" && (
                <div className="space-y-4 pt-4 border-t">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">API Key</label>
                    <Input
                      type="password"
                      value={openaiKey}
                      onChange={(e) => setOpenaiKey(e.target.value)}
                      placeholder="sk-..."
                    />
                    <p className="text-xs text-muted-foreground">
                      Your API key is stored locally and never sent to our servers
                    </p>
                  </div>

                  <div className="p-3 rounded-lg bg-muted">
                    <p className="text-sm">
                      <strong>Note:</strong> Using OpenAI means your data will be sent to
                      OpenAI&apos;s servers. For maximum privacy, use the local provider.
                    </p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Database Status */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Database className="h-5 w-5" />
                Database
              </CardTitle>
              <CardDescription>
                PostgreSQL with pgvector and Apache AGE
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
                  <p className="text-2xl font-bold">3</p>
                  <p className="text-xs text-muted-foreground">Documents</p>
                </div>
                <div className="text-center">
                  <p className="text-2xl font-bold">12</p>
                  <p className="text-xs text-muted-foreground">Entities</p>
                </div>
                <div className="text-center">
                  <p className="text-2xl font-bold">24</p>
                  <p className="text-xs text-muted-foreground">Relationships</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Save Button */}
          <Button onClick={handleSave} disabled={isSaving} className="w-full">
            {isSaving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving...
              </>
            ) : saved ? (
              <>
                <CheckCircle className="mr-2 h-4 w-4" />
                Saved!
              </>
            ) : (
              <>
                <Save className="mr-2 h-4 w-4" />
                Save Settings
              </>
            )}
          </Button>
        </div>
      </main>
    </div>
  );
}
