"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  Sparkles,
  ArrowRight,
  Loader2,
  RefreshCw,
  Network,
  Lightbulb,
  Layers,
  Link2,
  FileText,
  Zap,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { Header } from "@/components/layout/header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  getHiddenConnections,
  getBridgeEntities,
  getKnowledgeClusters,
  getDiscoverStats,
  getSavedInsightsMap,
  type HiddenConnection,
  type BridgeEntity,
  type KnowledgeCluster,
  type DiscoverStats,
} from "@/actions/discover";
import { cn } from "@/lib/utils";

// ============================================================================
// Entity Link — clickable entity badge that navigates to graph
// ============================================================================

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
          <span className="font-semibold text-sm truncate">{name}</span>
          <TypeBadge type={type} />
        </Link>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs">
        <p className="font-medium">{name}</p>
        <p className="text-xs opacity-80 capitalize">{type}</p>
        {description && (
          <p className="text-xs opacity-70 mt-1">
            {description.length > 150
              ? `${description.slice(0, 150)}...`
              : description}
          </p>
        )}
      </TooltipContent>
    </Tooltip>
  );
}

// ============================================================================
// Relation Tooltip — hoverable relation type
// ============================================================================

function RelationLabel({ label }: { label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="text-[10px] text-muted-foreground truncate max-w-[100px] cursor-default">
          {label}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top">
        <p className="text-xs">{label}</p>
      </TooltipContent>
    </Tooltip>
  );
}

// ============================================================================
// Insight Generator Component (streaming, with persistence)
// ============================================================================

function InsightDisplay({
  entityIds,
  savedInsight,
}: {
  entityIds: string[];
  savedInsight?: string | null;
}) {
  const [insight, setInsight] = useState(savedInsight || "");
  const [loading, setLoading] = useState(false);
  const [generated, setGenerated] = useState(!!savedInsight);

  const generate = useCallback(async () => {
    setLoading(true);
    setInsight("");
    setGenerated(true);

    try {
      const response = await fetch("/api/discover/insight", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entityIds }),
      });

      if (!response.ok) throw new Error("Failed to generate insight");

      const reader = response.body?.getReader();
      if (!reader) throw new Error("No reader");

      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const text = decoder.decode(value, { stream: true });
        setInsight((prev) => prev + text);
      }
    } catch (error) {
      console.error("Failed to generate insight:", error);
      setInsight("Failed to generate insight. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [entityIds]);

  if (!generated) {
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={generate}
        className="gap-1.5 text-xs"
      >
        <Sparkles className="h-3 w-3" />
        Generate Insight
      </Button>
    );
  }

  return (
    <div className="mt-3 rounded-lg bg-primary/5 border border-primary/10 p-3">
      <div className="flex items-start gap-2">
        <Lightbulb className="h-4 w-4 text-primary mt-0.5 shrink-0" />
        <div className="text-sm text-muted-foreground leading-relaxed min-h-[1.5em]">
          {insight}
          {loading && (
            <span className="inline-block w-1.5 h-4 bg-primary/60 ml-0.5 animate-pulse" />
          )}
        </div>
      </div>
      {!loading && !savedInsight && insight && (
        <div className="flex justify-end mt-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={generate}
            className="gap-1 text-[10px] h-6 px-2"
          >
            <RefreshCw className="h-2.5 w-2.5" />
            Regenerate
          </Button>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Skeleton Components
// ============================================================================

function StatsSkeleton() {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {[...Array(4)].map((_, i) => (
        <div
          key={i}
          className="rounded-lg border bg-card p-4 animate-pulse"
        >
          <div className="h-4 w-20 bg-muted rounded mb-2" />
          <div className="h-8 w-16 bg-muted rounded" />
        </div>
      ))}
    </div>
  );
}

function CardSkeleton({
  count = 3,
  cols = "md:grid-cols-2 lg:grid-cols-3",
}: {
  count?: number;
  cols?: string;
}) {
  return (
    <div className={`grid gap-4 ${cols}`}>
      {[...Array(count)].map((_, i) => (
        <Card key={i} className="animate-pulse">
          <CardHeader>
            <div className="h-5 w-3/4 bg-muted rounded" />
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div className="h-4 w-full bg-muted rounded" />
              <div className="h-4 w-2/3 bg-muted rounded" />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ============================================================================
// Empty State
// ============================================================================

function EmptyState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <div className="rounded-full bg-muted p-4 mb-4">
        <Network className="h-8 w-8 text-muted-foreground" />
      </div>
      <h3 className="text-lg font-medium mb-1">{title}</h3>
      <p className="text-sm text-muted-foreground max-w-md">{description}</p>
    </div>
  );
}

// ============================================================================
// Entity Type Badge Colors
// ============================================================================

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
      className={cn(
        "text-[10px] uppercase tracking-wider",
        typeColors[type] || typeColors.other
      )}
    >
      {type}
    </Badge>
  );
}

// ============================================================================
// Hidden Connection Card — single column, all elements clickable
// ============================================================================

function HiddenConnectionCard({
  connection,
  savedInsight,
}: {
  connection: HiddenConnection;
  savedInsight?: string | null;
}) {
  const entityIds = [
    connection.entityA.id,
    connection.bridge.id,
    connection.entityB.id,
  ];

  return (
    <Card className="group hover:shadow-md transition-all duration-200 hover:border-primary/20">
      <CardContent className="pt-5 pb-4">
        <div className="flex items-center gap-3 mb-3 flex-wrap">
          <EntityLink
            id={connection.entityA.id}
            name={connection.entityA.name}
            type={connection.entityA.type}
            description={connection.entityA.description}
          />

          <div className="flex flex-col items-center shrink-0 px-1">
            <RelationLabel label={connection.relationABridge} />
            <ArrowRight className="h-3 w-3 text-muted-foreground" />
          </div>

          <Tooltip>
            <TooltipTrigger asChild>
              <Link
                href={`/graph?entity=${connection.bridge.id}`}
                className="flex flex-col items-center shrink-0 px-3 py-1.5 rounded-md bg-primary/5 border border-primary/10 hover:bg-primary/10 transition-colors"
              >
                <Link2 className="h-3 w-3 text-primary mb-0.5" />
                <span className="font-medium text-xs text-primary truncate max-w-[100px]">
                  {connection.bridge.name}
                </span>
                <TypeBadge type={connection.bridge.type} />
              </Link>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-xs">
              <p className="font-medium">
                {connection.bridge.name}{" "}
                <span className="opacity-70">(bridge)</span>
              </p>
              <p className="text-xs opacity-80 capitalize">
                {connection.bridge.type}
              </p>
              {connection.bridge.description && (
                <p className="text-xs opacity-70 mt-1">
                  {connection.bridge.description.length > 150
                    ? `${connection.bridge.description.slice(0, 150)}...`
                    : connection.bridge.description}
                </p>
              )}
            </TooltipContent>
          </Tooltip>

          <div className="flex flex-col items-center shrink-0 px-1">
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

        {connection.sourceDocuments.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-2">
            {connection.sourceDocuments.slice(0, 3).map((doc) => (
              <Tooltip key={doc.id}>
                <TooltipTrigger asChild>
                  <Link
                    href={`/library/${doc.id}`}
                    className="inline-flex items-center gap-1 text-[10px] text-muted-foreground bg-muted/50 rounded px-1.5 py-0.5 hover:bg-muted transition-colors"
                  >
                    <FileText className="h-2.5 w-2.5" />
                    {doc.title.length > 30
                      ? `${doc.title.slice(0, 30)}...`
                      : doc.title}
                  </Link>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  <p className="text-xs">{doc.title}</p>
                </TooltipContent>
              </Tooltip>
            ))}
          </div>
        )}

        <InsightDisplay entityIds={entityIds} savedInsight={savedInsight} />
      </CardContent>
    </Card>
  );
}

// ============================================================================
// Bridge Entity Card — clickable entity names
// ============================================================================

function BridgeEntityCard({ entity }: { entity: BridgeEntity }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <Card className="group hover:shadow-md transition-all duration-200 hover:border-primary/20">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <Link
                  href={`/graph?entity=${entity.id}`}
                  className="rounded-full bg-primary/10 p-1.5 hover:bg-primary/20 transition-colors"
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
                <Link
                  href={`/graph?entity=${entity.id}`}
                  className="hover:underline underline-offset-2"
                >
                  {entity.name}
                </Link>
              </CardTitle>
              <TypeBadge type={entity.type} />
            </div>
          </div>
          <div className="text-right">
            <span className="text-2xl font-bold text-primary">
              {entity.connectionCount}
            </span>
            <p className="text-[10px] text-muted-foreground">connections</p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {entity.description && (
          <Tooltip>
            <TooltipTrigger asChild>
              <p className="text-xs text-muted-foreground mb-2 line-clamp-2 cursor-default">
                {entity.description}
              </p>
            </TooltipTrigger>
            {entity.description.length > 100 && (
              <TooltipContent side="bottom" className="max-w-sm">
                <p className="text-xs">{entity.description}</p>
              </TooltipContent>
            )}
          </Tooltip>
        )}

        <Button
          variant="ghost"
          size="sm"
          onClick={() => setExpanded(!expanded)}
          className="w-full justify-between text-xs h-7 px-2"
        >
          <span>Connected entities ({entity.connectedEntities.length})</span>
          {expanded ? (
            <ChevronUp className="h-3 w-3" />
          ) : (
            <ChevronDown className="h-3 w-3" />
          )}
        </Button>

        {expanded && (
          <div className="mt-2 flex flex-wrap gap-1">
            {entity.connectedEntities.map((e) => (
              <Tooltip key={e.id}>
                <TooltipTrigger asChild>
                  <Link href={`/graph?entity=${e.id}`}>
                    <Badge
                      variant="outline"
                      className="text-[10px] hover:bg-muted transition-colors cursor-pointer"
                    >
                      {e.name}
                    </Badge>
                  </Link>
                </TooltipTrigger>
                <TooltipContent side="top">
                  <p className="text-xs capitalize">{e.type}</p>
                </TooltipContent>
              </Tooltip>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ============================================================================
// Knowledge Cluster Card — clickable entity names
// ============================================================================

function KnowledgeClusterCard({ cluster }: { cluster: KnowledgeCluster }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <Card className="group hover:shadow-md transition-all duration-200 hover:border-primary/20">
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
        <div className="flex flex-wrap gap-1 mb-2">
          {cluster.members.slice(0, expanded ? 20 : 5).map((m) => (
            <Tooltip key={m.id}>
              <TooltipTrigger asChild>
                <Link href={`/graph?entity=${m.id}`}>
                  <Badge
                    variant="outline"
                    className="text-[10px] hover:bg-muted transition-colors cursor-pointer"
                  >
                    {m.name}
                  </Badge>
                </Link>
              </TooltipTrigger>
              <TooltipContent side="top">
                <p className="text-xs capitalize">{m.type}</p>
              </TooltipContent>
            </Tooltip>
          ))}
          {!expanded && cluster.members.length > 5 && (
            <Badge variant="secondary" className="text-[10px]">
              +{cluster.members.length - 5} more
            </Badge>
          )}
        </div>

        {cluster.bridgeEntities.length > 0 && (
          <div className="mt-2 pt-2 border-t">
            <p className="text-[10px] text-muted-foreground mb-1 flex items-center gap-1">
              <Link2 className="h-2.5 w-2.5" />
              Bridge entities (connect to other clusters)
            </p>
            <div className="flex flex-wrap gap-1">
              {cluster.bridgeEntities.map((b) => (
                <Tooltip key={b.id}>
                  <TooltipTrigger asChild>
                    <Link href={`/graph?entity=${b.id}`}>
                      <Badge
                        variant="secondary"
                        className={cn(
                          "text-[10px] hover:opacity-80 transition-opacity cursor-pointer",
                          typeColors[b.type] || typeColors.other
                        )}
                      >
                        {b.name}
                      </Badge>
                    </Link>
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    <p className="text-xs capitalize">{b.type} (bridge)</p>
                  </TooltipContent>
                </Tooltip>
              ))}
            </div>
          </div>
        )}

        {cluster.members.length > 5 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setExpanded(!expanded)}
            className="w-full justify-center text-xs h-7 mt-2"
          >
            {expanded
              ? "Show less"
              : `Show all ${cluster.memberCount} entities`}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

// ============================================================================
// Main Discover Page
// ============================================================================

export default function DiscoverPage() {
  const [stats, setStats] = useState<DiscoverStats | null>(null);
  const [connections, setConnections] = useState<HiddenConnection[]>([]);
  const [bridges, setBridges] = useState<BridgeEntity[]>([]);
  const [clusters, setClusters] = useState<KnowledgeCluster[]>([]);
  const [savedInsights, setSavedInsights] = useState<Map<string, string>>(
    new Map()
  );

  const [loadingStats, setLoadingStats] = useState(true);
  const [loadingConnections, setLoadingConnections] = useState(true);
  const [loadingBridges, setLoadingBridges] = useState(true);
  const [loadingClusters, setLoadingClusters] = useState(true);

  const loadData = useCallback(async () => {
    setLoadingStats(true);
    setLoadingConnections(true);
    setLoadingBridges(true);
    setLoadingClusters(true);

    // Load all data in parallel
    getDiscoverStats()
      .then(setStats)
      .catch(console.error)
      .finally(() => setLoadingStats(false));

    getHiddenConnections()
      .then(setConnections)
      .catch(console.error)
      .finally(() => setLoadingConnections(false));

    getBridgeEntities()
      .then(setBridges)
      .catch(console.error)
      .finally(() => setLoadingBridges(false));

    getKnowledgeClusters()
      .then(setClusters)
      .catch(console.error)
      .finally(() => setLoadingClusters(false));

    getSavedInsightsMap()
      .then(setSavedInsights)
      .catch(console.error);
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const isLoading =
    loadingStats || loadingConnections || loadingBridges || loadingClusters;

  function getInsightKey(entityIds: string[]) {
    return [...entityIds].sort().join(",");
  }

  return (
    <TooltipProvider delayDuration={300}>
      <div className="min-h-screen bg-background">
        <Header />

        <main className="container mx-auto px-4 py-8 max-w-7xl">
          {/* Page Header */}
          <div className="flex items-center justify-between mb-8">
            <div>
              <div className="flex items-center gap-3 mb-1">
                <div className="rounded-lg bg-primary/10 p-2">
                  <Sparkles className="h-6 w-6 text-primary" />
                </div>
                <h1 className="text-3xl font-bold tracking-tight">Discover</h1>
              </div>
              <p className="text-muted-foreground ml-[52px]">
                Hidden connections in your knowledge
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={loadData}
              disabled={isLoading}
              className="gap-2"
            >
              <RefreshCw
                className={cn("h-4 w-4", isLoading && "animate-spin")}
              />
              Refresh
            </Button>
          </div>

          {/* Stats Bar */}
          {loadingStats ? (
            <StatsSkeleton />
          ) : stats ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-10">
              <div className="rounded-lg border bg-card p-4">
                <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">
                  Entities
                </p>
                <p className="text-2xl font-bold">
                  {stats.totalEntities.toLocaleString("en-US")}
                </p>
              </div>
              <div className="rounded-lg border bg-card p-4">
                <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">
                  Relationships
                </p>
                <p className="text-2xl font-bold">
                  {stats.totalRelationships.toLocaleString("en-US")}
                </p>
              </div>
              <div className="rounded-lg border bg-card p-4">
                <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">
                  Clusters
                </p>
                <p className="text-2xl font-bold">
                  {stats.clustersFound.toLocaleString("en-US")}
                </p>
              </div>
              <div className="rounded-lg border bg-card p-4">
                <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">
                  Potential Insights
                </p>
                <p className="text-2xl font-bold">
                  {stats.potentialInsights.toLocaleString("en-US")}
                </p>
              </div>
            </div>
          ) : null}

          {/* Section 1: Hidden Connections — single column */}
          <section className="mb-12">
            <div className="flex items-center gap-2 mb-4">
              <Link2 className="h-5 w-5 text-primary" />
              <h2 className="text-xl font-semibold">Hidden Connections</h2>
              <Badge variant="secondary" className="ml-1 text-xs">
                {loadingConnections ? "..." : connections.length}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground mb-4">
              Entities that are not directly connected but share surprising
              paths through bridge entities.
            </p>

            {loadingConnections ? (
              <CardSkeleton count={3} cols="grid-cols-1" />
            ) : connections.length === 0 ? (
              <EmptyState
                title="No hidden connections yet"
                description="Add more documents to your knowledge base to discover non-obvious connections between topics."
              />
            ) : (
              <div className="grid gap-4 grid-cols-1">
                {connections.map((conn, i) => (
                  <HiddenConnectionCard
                    key={i}
                    connection={conn}
                    savedInsight={savedInsights.get(
                      getInsightKey([
                        conn.entityA.id,
                        conn.bridge.id,
                        conn.entityB.id,
                      ])
                    )}
                  />
                ))}
              </div>
            )}
          </section>

          {/* Section 2: Bridge Entities — 2 columns */}
          <section className="mb-12">
            <div className="flex items-center gap-2 mb-4">
              <Zap className="h-5 w-5 text-primary" />
              <h2 className="text-xl font-semibold">Bridge Entities</h2>
              <Badge variant="secondary" className="ml-1 text-xs">
                {loadingBridges ? "..." : bridges.length}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground mb-4">
              Knowledge connectors that link many different parts of your
              knowledge graph.
            </p>

            {loadingBridges ? (
              <CardSkeleton count={4} cols="md:grid-cols-2" />
            ) : bridges.length === 0 ? (
              <EmptyState
                title="No bridge entities found"
                description="Bridge entities emerge when your knowledge base grows and entities start connecting across different topics."
              />
            ) : (
              <div className="grid gap-4 grid-cols-1 md:grid-cols-2">
                {bridges.map((entity) => (
                  <BridgeEntityCard key={entity.id} entity={entity} />
                ))}
              </div>
            )}
          </section>

          {/* Section 3: Knowledge Clusters — 2 columns */}
          <section className="mb-12">
            <div className="flex items-center gap-2 mb-4">
              <Layers className="h-5 w-5 text-primary" />
              <h2 className="text-xl font-semibold">Knowledge Clusters</h2>
              <Badge variant="secondary" className="ml-1 text-xs">
                {loadingClusters ? "..." : clusters.length}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground mb-4">
              Thematic groupings of related entities forming distinct knowledge
              domains.
            </p>

            {loadingClusters ? (
              <CardSkeleton count={4} cols="md:grid-cols-2" />
            ) : clusters.length === 0 ? (
              <EmptyState
                title="No clusters detected"
                description="Clusters form when entities are connected through relationships. Add more content to see thematic groupings emerge."
              />
            ) : (
              <div className="grid gap-4 grid-cols-1 md:grid-cols-2">
                {clusters.map((cluster, i) => (
                  <KnowledgeClusterCard key={i} cluster={cluster} />
                ))}
              </div>
            )}
          </section>
        </main>
      </div>
    </TooltipProvider>
  );
}
