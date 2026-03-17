"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ArrowRight,
  ChevronDown,
  ChevronUp,
  FileText,
  Layers,
  Lightbulb,
  Link2,
  Network,
  RefreshCw,
  Sparkles,
  TriangleAlert,
  Zap,
} from "lucide-react";
import { getDiscoverSnapshot } from "@/actions/discover";
import type {
  BridgeEntity,
  DiscoverData,
  HiddenConnection,
  KnowledgeCluster,
} from "@/lib/discover/types";
import { getInsightKey } from "@/lib/discover/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const typeColors: Record<string, string> = {
  person: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  concept: "bg-purple-500/10 text-purple-600 dark:text-purple-400",
  technology: "bg-green-500/10 text-green-600 dark:text-green-400",
  organization: "bg-orange-500/10 text-orange-600 dark:text-orange-400",
  location: "bg-cyan-500/10 text-cyan-600 dark:text-cyan-400",
  event: "bg-pink-500/10 text-pink-600 dark:text-pink-400",
  product: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  other: "bg-gray-500/10 text-gray-600 dark:text-gray-400",
};

function TypeBadge({ type }: { type: string }) {
  return (
    <Badge
      variant="secondary"
      className={cn("text-[10px] uppercase tracking-wider", typeColors[type] || typeColors.other)}
    >
      {type}
    </Badge>
  );
}

function EntityLink({
  id,
  name,
  type,
  description,
}: {
  id: string;
  name: string;
  type: string;
  description?: string | null;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link
          href={`/graph?entity=${id}`}
          className="inline-flex items-center gap-1 hover:underline underline-offset-2"
        >
          <span className="truncate text-sm font-semibold">{name}</span>
          <TypeBadge type={type} />
        </Link>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs">
        <p className="font-medium">{name}</p>
        <p className="text-xs capitalize opacity-80">{type}</p>
        {description ? (
          <p className="mt-1 text-xs opacity-70">
            {description.length > 150 ? `${description.slice(0, 150)}...` : description}
          </p>
        ) : null}
      </TooltipContent>
    </Tooltip>
  );
}

function RelationLabel({ label }: { label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="max-w-[100px] cursor-default text-[10px] text-muted-foreground">
          {label}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top">
        <p className="text-xs">{label}</p>
      </TooltipContent>
    </Tooltip>
  );
}

function EmptyState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <div className="mb-4 rounded-full bg-muted p-4">
        <Network className="h-8 w-8 text-muted-foreground" />
      </div>
      <h3 className="mb-1 text-lg font-medium">{title}</h3>
      <p className="max-w-md text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

function RefreshErrorBanner({ message }: { message: string }) {
  return (
    <div className="mb-6 flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-900 dark:text-amber-100">
      <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
      <p>{message}</p>
    </div>
  );
}

function InsightDisplay({
  entityIds,
  savedInsight,
}: {
  entityIds: string[];
  savedInsight?: string;
}) {
  const entityKey = getInsightKey(entityIds);
  const [insight, setInsight] = useState(savedInsight ?? "");
  const [generated, setGenerated] = useState(Boolean(savedInsight));
  const [loading, setLoading] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setInsight(savedInsight ?? "");
    setGenerated(Boolean(savedInsight));
  }, [entityKey, savedInsight]);

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  const generate = useCallback(async () => {
    abortControllerRef.current?.abort();

    const controller = new AbortController();
    abortControllerRef.current = controller;

    setLoading(true);
    setInsight("");
    setGenerated(true);

    try {
      const response = await fetch("/api/discover/insight", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entityIds }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error("Failed to generate insight");
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error("No response stream returned.");
      }

      const decoder = new TextDecoder();
      let nextInsight = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        nextInsight += decoder.decode(value, { stream: true });
        setInsight(nextInsight);
      }

      setInsight((current) => current || nextInsight);
    } catch (error) {
      if (controller.signal.aborted) {
        return;
      }

      console.error("Failed to generate insight:", error);
      setInsight("Failed to generate insight. Please try again.");
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
      }
      setLoading(false);
    }
  }, [entityIds]);

  if (!generated) {
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={generate}
        disabled={loading}
        className="shrink-0 gap-1.5 text-xs"
      >
        <Sparkles className="h-3 w-3" />
        Generate Insight
      </Button>
    );
  }

  return (
    <div className="rounded-lg border border-primary/10 bg-primary/5 p-3">
      <div className="flex items-start gap-2">
        <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <div className="min-h-[1.5em] flex-1 text-sm leading-relaxed text-muted-foreground">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
              ul: ({ children }) => <ul className="mb-2 ml-4 list-disc last:mb-0">{children}</ul>,
              ol: ({ children }) => <ol className="mb-2 ml-4 list-decimal last:mb-0">{children}</ol>,
              li: ({ children }) => <li className="mb-1 last:mb-0">{children}</li>,
              strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
              em: ({ children }) => <em className="italic text-foreground">{children}</em>,
              code: ({ children }) => (
                <code className="rounded bg-background/70 px-1 py-0.5 text-[0.9em] text-foreground">
                  {children}
                </code>
              ),
            }}
          >
            {insight}
          </ReactMarkdown>
          {loading ? (
            <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-primary/60" />
          ) : null}
        </div>
      </div>
      {!loading && insight ? (
        <div className="mt-2 flex justify-end">
          <Button
            variant="ghost"
            size="sm"
            onClick={generate}
            className="h-6 gap-1 px-2 text-[10px]"
          >
            <RefreshCw className="h-2.5 w-2.5" />
            Regenerate
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function HiddenConnectionCard({
  connection,
  savedInsight,
}: {
  connection: HiddenConnection;
  savedInsight?: string;
}) {
  return (
    <Card className="group transition-all duration-200 hover:border-primary/20 hover:shadow-md">
      <CardContent className="pb-4 pt-5">
        <div className="mb-3 flex w-full items-center justify-between gap-2">
          <EntityLink
            id={connection.entityA.id}
            name={connection.entityA.name}
            type={connection.entityA.type}
            description={connection.entityA.description}
          />

          <div className="flex shrink-0 flex-col items-center px-1">
            <RelationLabel label={connection.relationABridge} />
            <ArrowRight className="h-3 w-3 text-muted-foreground" />
          </div>

          <Tooltip>
            <TooltipTrigger asChild>
              <Link
                href={`/graph?entity=${connection.bridge.id}`}
                className="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-primary/10 bg-primary/5 px-3 py-1.5 transition-colors hover:bg-primary/10"
              >
                <Link2 className="h-3 w-3 shrink-0 text-primary" />
                <span className="max-w-[100px] min-w-0 truncate text-xs font-medium text-primary">
                  {connection.bridge.name}
                </span>
                <TypeBadge type={connection.bridge.type} />
              </Link>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-xs">
              <p className="font-medium">
                {connection.bridge.name} <span className="opacity-70">(bridge)</span>
              </p>
              <p className="text-xs capitalize opacity-80">{connection.bridge.type}</p>
              {connection.bridge.description ? (
                <p className="mt-1 text-xs opacity-70">
                  {connection.bridge.description.length > 150
                    ? `${connection.bridge.description.slice(0, 150)}...`
                    : connection.bridge.description}
                </p>
              ) : null}
            </TooltipContent>
          </Tooltip>

          <div className="flex shrink-0 flex-col items-center px-1">
            <RelationLabel label={connection.relationBridgeB} />
            <ArrowRight className="h-3 w-3 text-muted-foreground" />
          </div>

          <EntityLink
            id={connection.entityB.id}
            name={connection.entityB.name}
            type={connection.entityB.type}
            description={connection.entityB.description}
          />
        </div>

        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            {connection.sourceDocuments.length > 0 ? (
              <div className="flex min-w-0 flex-1 flex-wrap gap-1">
                {connection.sourceDocuments.slice(0, 3).map((document) => (
                  <Tooltip key={document.id}>
                    <TooltipTrigger asChild>
                      <Link
                        href={`/library/${document.id}`}
                        className="inline-flex items-center gap-1 rounded bg-muted/50 px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-muted"
                      >
                        <FileText className="h-2.5 w-2.5" />
                        {document.title.length > 30
                          ? `${document.title.slice(0, 30)}...`
                          : document.title}
                      </Link>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">
                      <p className="text-xs">{document.title}</p>
                    </TooltipContent>
                  </Tooltip>
                ))}
              </div>
            ) : (
              <div className="flex-1" />
            )}
          </div>

          <InsightDisplay
            entityIds={[connection.entityA.id, connection.bridge.id, connection.entityB.id]}
            savedInsight={savedInsight}
          />
        </div>
      </CardContent>
    </Card>
  );
}

function BridgeEntityCard({ entity }: { entity: BridgeEntity }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <Card className="group transition-all duration-200 hover:border-primary/20 hover:shadow-md">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <Link
                  href={`/graph?entity=${entity.id}`}
                  className="rounded-full bg-primary/10 p-1.5 transition-colors hover:bg-primary/20"
                >
                  <Zap className="h-4 w-4 text-primary" />
                </Link>
              </TooltipTrigger>
              <TooltipContent side="top">
                <p className="text-xs">View in graph</p>
              </TooltipContent>
            </Tooltip>
            <div>
              <CardTitle className="text-sm">
                <Link href={`/graph?entity=${entity.id}`} className="hover:underline underline-offset-2">
                  {entity.name}
                </Link>
              </CardTitle>
              <TypeBadge type={entity.type} />
            </div>
          </div>
          <div className="text-right">
            <span className="text-2xl font-bold text-primary">{entity.connectionCount}</span>
            <p className="text-[10px] text-muted-foreground">connections</p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {entity.description ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <p className="mb-2 cursor-default text-xs text-muted-foreground line-clamp-2">
                {entity.description}
              </p>
            </TooltipTrigger>
            {entity.description.length > 100 ? (
              <TooltipContent side="bottom" className="max-w-sm">
                <p className="text-xs">{entity.description}</p>
              </TooltipContent>
            ) : null}
          </Tooltip>
        ) : null}

        <Button
          variant="ghost"
          size="sm"
          onClick={() => setExpanded((value) => !value)}
          className="h-7 w-full justify-between px-2 text-xs"
        >
          <span>Connected entities ({entity.connectionCount})</span>
          {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </Button>

        {expanded ? (
          <div className="mt-2 flex flex-wrap gap-1">
            {entity.connectedEntities.map((connectedEntity) => (
              <Tooltip key={connectedEntity.id}>
                <TooltipTrigger asChild>
                  <Link href={`/graph?entity=${connectedEntity.id}`}>
                    <Badge
                      variant="outline"
                      className="cursor-pointer text-[10px] transition-colors hover:bg-muted"
                    >
                      {connectedEntity.name}
                    </Badge>
                  </Link>
                </TooltipTrigger>
                <TooltipContent side="top">
                  <p className="text-xs capitalize">{connectedEntity.type}</p>
                </TooltipContent>
              </Tooltip>
            ))}
            {entity.connectionCount > entity.connectedEntities.length ? (
              <Badge variant="secondary" className="text-[10px]">
                +{entity.connectionCount - entity.connectedEntities.length} more
              </Badge>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function KnowledgeClusterCard({ cluster }: { cluster: KnowledgeCluster }) {
  const [expanded, setExpanded] = useState(false);
  const visibleMembers = expanded ? cluster.members : cluster.members.slice(0, 5);

  return (
    <Card className="group transition-all duration-200 hover:border-primary/20 hover:shadow-md">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="rounded-full bg-primary/10 p-1.5">
              <Layers className="h-4 w-4 text-primary" />
            </div>
            <div>
              <CardTitle className="text-sm">{cluster.name}</CardTitle>
              <TypeBadge type={cluster.dominantType} />
            </div>
          </div>
          <div className="text-right">
            <span className="text-2xl font-bold">{cluster.memberCount}</span>
            <p className="text-[10px] text-muted-foreground">entities</p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="mb-2 flex flex-wrap gap-1">
          {visibleMembers.map((member) => (
            <Tooltip key={member.id}>
              <TooltipTrigger asChild>
                <Link href={`/graph?entity=${member.id}`}>
                  <Badge
                    variant="outline"
                    className="cursor-pointer text-[10px] transition-colors hover:bg-muted"
                  >
                    {member.name}
                  </Badge>
                </Link>
              </TooltipTrigger>
              <TooltipContent side="top">
                <p className="text-xs capitalize">{member.type}</p>
              </TooltipContent>
            </Tooltip>
          ))}

          {!expanded && cluster.members.length > 5 ? (
            <Badge variant="secondary" className="text-[10px]">
              +{cluster.members.length - 5} more
            </Badge>
          ) : null}
        </div>

        {cluster.bridgeEntities.length > 0 ? (
          <div className="mt-2 border-t pt-2">
            <p className="mb-1 flex items-center gap-1 text-[10px] text-muted-foreground">
              <Link2 className="h-2.5 w-2.5" />
              Key connectors inside this cluster
            </p>
            <div className="flex flex-wrap gap-1">
              {cluster.bridgeEntities.map((bridgeEntity) => (
                <Tooltip key={bridgeEntity.id}>
                  <TooltipTrigger asChild>
                    <Link href={`/graph?entity=${bridgeEntity.id}`}>
                      <Badge
                        variant="secondary"
                        className={cn(
                          "cursor-pointer text-[10px] transition-opacity hover:opacity-80",
                          typeColors[bridgeEntity.type] || typeColors.other
                        )}
                      >
                        {bridgeEntity.name}
                      </Badge>
                    </Link>
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    <p className="text-xs capitalize">{bridgeEntity.type}</p>
                  </TooltipContent>
                </Tooltip>
              ))}
            </div>
          </div>
        ) : null}

        {cluster.members.length > 5 ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setExpanded((value) => !value)}
            className="mt-2 h-7 w-full justify-center text-xs"
          >
            {expanded ? "Show less" : `Show all ${cluster.memberCount} entities`}
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function DiscoverClient({ initialData }: { initialData: DiscoverData }) {
  const [data, setData] = useState(initialData);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const refresh = useCallback(() => {
    setRefreshError(null);
    setIsRefreshing(true);

    void getDiscoverSnapshot()
      .then((nextSnapshot) => {
        setData(nextSnapshot);
      })
      .catch((error) => {
        console.error("Failed to refresh discover data:", error);
        setRefreshError("Refresh failed. The current results are still shown.");
      })
      .finally(() => {
        setIsRefreshing(false);
      });
  }, []);

  return (
    <TooltipProvider delayDuration={300}>
      <div>
        <div className="mb-8 flex items-center justify-between">
          <div>
            <div className="mb-1 flex items-center gap-3">
              <div className="rounded-lg bg-primary/10 p-2">
                <Sparkles className="h-6 w-6 text-primary" />
              </div>
              <h1 className="text-3xl font-bold tracking-tight">Discover</h1>
            </div>
            <p className="ml-[52px] text-muted-foreground">Hidden connections in your knowledge</p>
          </div>
          <Button variant="outline" size="sm" onClick={refresh} disabled={isRefreshing} className="gap-2">
            <RefreshCw className={cn("h-4 w-4", isRefreshing && "animate-spin")} />
            Refresh
          </Button>
        </div>

        {refreshError ? <RefreshErrorBanner message={refreshError} /> : null}

        <div className="mb-10 grid grid-cols-2 gap-4 md:grid-cols-4">
          <div className="rounded-lg border bg-card p-4">
            <p className="mb-1 text-xs uppercase tracking-wider text-muted-foreground">Entities</p>
            <p className="text-2xl font-bold">{data.stats.totalEntities.toLocaleString("en-US")}</p>
          </div>
          <div className="rounded-lg border bg-card p-4">
            <p className="mb-1 text-xs uppercase tracking-wider text-muted-foreground">Relationships</p>
            <p className="text-2xl font-bold">
              {data.stats.totalRelationships.toLocaleString("en-US")}
            </p>
          </div>
          <div className="rounded-lg border bg-card p-4">
            <p className="mb-1 text-xs uppercase tracking-wider text-muted-foreground">Clusters</p>
            <p className="text-2xl font-bold">{data.stats.clustersFound.toLocaleString("en-US")}</p>
          </div>
          <div className="rounded-lg border bg-card p-4">
            <p className="mb-1 text-xs uppercase tracking-wider text-muted-foreground">
              Potential Insights
            </p>
            <p className="text-2xl font-bold">
              {data.stats.potentialInsights.toLocaleString("en-US")}
            </p>
          </div>
        </div>

        <section className="mb-12">
          <div className="mb-4 flex items-center gap-2">
            <Link2 className="h-5 w-5 text-primary" />
            <h2 className="text-xl font-semibold">Hidden Connections</h2>
            <Badge variant="secondary" className="ml-1 text-xs">
              {data.connections.length}
            </Badge>
          </div>
          <p className="mb-4 text-sm text-muted-foreground">
            Entities that are not directly connected but share surprising paths through bridge
            entities.
          </p>

          {data.connections.length === 0 ? (
            <EmptyState
              title="No hidden connections yet"
              description="Add more documents to your knowledge base to discover non-obvious connections between topics."
            />
          ) : (
            <div className="grid grid-cols-1 gap-4">
              {data.connections.map((connection) => (
                <HiddenConnectionCard
                  key={connection.key}
                  connection={connection}
                  savedInsight={data.savedInsights[connection.key]}
                />
              ))}
            </div>
          )}
        </section>

        <section className="mb-12">
          <div className="mb-4 flex items-center gap-2">
            <Zap className="h-5 w-5 text-primary" />
            <h2 className="text-xl font-semibold">Bridge Entities</h2>
            <Badge variant="secondary" className="ml-1 text-xs">
              {data.bridges.length}
            </Badge>
          </div>
          <p className="mb-4 text-sm text-muted-foreground">
            Knowledge connectors that link many different parts of your knowledge graph.
          </p>

          {data.bridges.length === 0 ? (
            <EmptyState
              title="No bridge entities found"
              description="Bridge entities emerge when your knowledge base grows and entities start connecting across different topics."
            />
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {data.bridges.map((bridge) => (
                <BridgeEntityCard key={bridge.id} entity={bridge} />
              ))}
            </div>
          )}
        </section>

        <section className="mb-12">
          <div className="mb-4 flex items-center gap-2">
            <Layers className="h-5 w-5 text-primary" />
            <h2 className="text-xl font-semibold">Knowledge Clusters</h2>
            <Badge variant="secondary" className="ml-1 text-xs">
              {data.clusters.length}
            </Badge>
          </div>
          <p className="mb-4 text-sm text-muted-foreground">
            Thematic groupings of related entities forming distinct knowledge domains.
          </p>

          {data.clusters.length === 0 ? (
            <EmptyState
              title="No clusters detected"
              description="Clusters form when entities are connected through relationships. Add more content to see thematic groupings emerge."
            />
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {data.clusters.map((cluster) => (
                <KnowledgeClusterCard key={cluster.id} cluster={cluster} />
              ))}
            </div>
          )}
        </section>
      </div>
    </TooltipProvider>
  );
}
