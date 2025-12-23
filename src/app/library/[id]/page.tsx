import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ExternalLink, FileText, Video, Globe, Network, Calendar, Hash } from "lucide-react";
import { Header } from "@/components/layout/header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getDocument } from "@/actions/documents";
import { DeleteButton } from "./delete-button";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const typeIcons = {
  article: Globe,
  youtube: Video,
  pdf: FileText,
  note: FileText,
};

const typeColors = {
  article: "bg-blue-500/10 text-blue-500",
  youtube: "bg-red-500/10 text-red-500",
  pdf: "bg-orange-500/10 text-orange-500",
  note: "bg-green-500/10 text-green-500",
};

const entityTypeColors: Record<string, string> = {
  person: "bg-amber-500/10 text-amber-600",
  concept: "bg-blue-500/10 text-blue-600",
  technology: "bg-green-500/10 text-green-600",
  organization: "bg-purple-500/10 text-purple-600",
  location: "bg-rose-500/10 text-rose-600",
  event: "bg-cyan-500/10 text-cyan-600",
  product: "bg-indigo-500/10 text-indigo-600",
  other: "bg-gray-500/10 text-gray-600",
};

export default async function DocumentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const document = await getDocument(id);

  if (!document) {
    notFound();
  }

  const Icon = typeIcons[document.type as keyof typeof typeIcons] || FileText;
  const colorClass = typeColors[document.type as keyof typeof typeColors] || typeColors.note;

  return (
    <div className="min-h-screen bg-background">
      <Header />

      <main className="container mx-auto px-4 py-8">
        <div className="max-w-4xl mx-auto">
          {/* Back Button */}
          <Link href="/library" className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground mb-6">
            <ArrowLeft className="h-4 w-4" />
            Back to Library
          </Link>

          {/* Document Header */}
          <div className="flex items-start gap-4 mb-8">
            <div className={`p-3 rounded-lg ${colorClass}`}>
              <Icon className="h-8 w-8" />
            </div>
            <div className="flex-1">
              <h1 className="text-3xl font-bold mb-2">{document.title}</h1>
              <div className="flex items-center gap-4 text-sm text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Calendar className="h-4 w-4" />
                  {document.createdAt.toLocaleDateString()}
                </span>
                <Badge variant="outline" className="capitalize">
                  {document.type}
                </Badge>
                <Badge
                  variant={document.processingStatus === "completed" ? "default" : "secondary"}
                >
                  {document.processingStatus}
                </Badge>
              </div>
              {document.url && (
                <a
                  href={document.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-sm text-primary hover:underline mt-2"
                >
                  <ExternalLink className="h-4 w-4" />
                  {document.url}
                </a>
              )}
            </div>
            <DeleteButton documentId={document.id} />
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            {/* Main Content */}
            <div className="lg:col-span-2 space-y-6">
              {/* Summary */}
              {document.summary && (
                <Card>
                  <CardHeader>
                    <CardTitle>Summary</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="prose prose-sm max-w-none dark:prose-invert">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {document.summary}
                      </ReactMarkdown>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Chunks */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Hash className="h-5 w-5" />
                    Content Chunks
                  </CardTitle>
                  <CardDescription>
                    {document.chunks.length} chunks extracted from this document
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {document.chunks.length > 0 ? (
                    <div className="space-y-4">
                      {document.chunks.slice(0, 5).map((chunk, index) => (
                        <div
                          key={chunk.id}
                          className="p-3 rounded-lg bg-muted/50 border"
                        >
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-xs font-medium text-muted-foreground">
                              Chunk {index + 1}
                            </span>
                            {chunk.tokenCount && (
                              <span className="text-xs text-muted-foreground">
                                ~{chunk.tokenCount} tokens
                              </span>
                            )}
                          </div>
                          <p className="text-sm line-clamp-4">{chunk.content}</p>
                        </div>
                      ))}
                      {document.chunks.length > 5 && (
                        <p className="text-sm text-muted-foreground text-center">
                          + {document.chunks.length - 5} more chunks
                        </p>
                      )}
                    </div>
                  ) : (
                    <p className="text-muted-foreground text-center py-4">
                      No chunks extracted yet
                    </p>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Sidebar */}
            <div className="space-y-6">
              {/* Entities */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Network className="h-5 w-5" />
                    Entities
                  </CardTitle>
                  <CardDescription>
                    {document.entities.length} entities extracted
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {document.entities.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {document.entities.map((entity) => (
                        <Badge
                          key={entity.id}
                          variant="outline"
                          className={entityTypeColors[entity.type] || entityTypeColors.other}
                        >
                          {entity.name}
                        </Badge>
                      ))}
                    </div>
                  ) : (
                    <p className="text-muted-foreground text-center py-4">
                      No entities extracted yet
                    </p>
                  )}
                </CardContent>
              </Card>

              {/* Relationships */}
              <Card>
                <CardHeader>
                  <CardTitle>Relationships</CardTitle>
                  <CardDescription>
                    {document.relationships.length} connections found
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {document.relationships.length > 0 ? (
                    <div className="space-y-2">
                      {document.relationships.slice(0, 10).map((rel) => {
                        const sourceEntity = document.entities.find(
                          (e) => e.id === rel.sourceEntityId
                        );
                        const targetEntity = document.entities.find(
                          (e) => e.id === rel.targetEntityId
                        );
                        return (
                          <div
                            key={rel.id}
                            className="text-sm p-2 rounded bg-muted/50"
                          >
                            <span className="font-medium">
                              {sourceEntity?.name || "Unknown"}
                            </span>
                            <span className="text-muted-foreground mx-2">
                              → {rel.relationType} →
                            </span>
                            <span className="font-medium">
                              {targetEntity?.name || "Unknown"}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-muted-foreground text-center py-4">
                      No relationships found
                    </p>
                  )}
                </CardContent>
              </Card>

              {/* Actions */}
              <Card>
                <CardHeader>
                  <CardTitle>Actions</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <Link href={`/graph?focus=${id}`} className="w-full">
                    <Button variant="outline" className="w-full">
                      View in Graph
                    </Button>
                  </Link>
                  <Link href={`/chat?context=${id}`} className="w-full">
                    <Button variant="outline" className="w-full">
                      Chat about this
                    </Button>
                  </Link>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
