"use client";

import { useState, useCallback, useMemo, useEffect } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { Search, Loader2, RefreshCw } from "lucide-react";
import { getGraphData, getEntityDetails, type GraphData, type GraphNode } from "@/actions/graph";
import { Header } from "@/components/layout/header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

// Dynamically import the graph component to avoid SSR issues
const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-full">
      <p className="text-muted-foreground">Loading graph...</p>
    </div>
  ),
});

type EntityDetails = {
  id: string;
  name: string;
  type: string;
  description: string | null;
  documents: { id: string; title: string; type: string; createdAt: Date }[];
  connectedEntities: { id: string; name: string; type: string; relationType: string }[];
};

const typeColors: Record<string, string> = {
  concept: "#3b82f6",
  technology: "#10b981",
  person: "#f59e0b",
  organization: "#8b5cf6",
};

export default function GraphPage() {
  const [graphData, setGraphData] = useState<GraphData>({ nodes: [], links: [] });
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [selectedDetails, setSelectedDetails] = useState<EntityDetails | null>(null);
  const [filterType, setFilterType] = useState<string | null>(null);

  // Fetch graph data
  useEffect(() => {
    async function fetchGraph() {
      setIsLoading(true);
      try {
        const data = await getGraphData();
        setGraphData(data);
      } catch (error) {
        console.error("Failed to fetch graph:", error);
      } finally {
        setIsLoading(false);
      }
    }
    fetchGraph();
  }, []);

  // Fetch entity details when selected
  useEffect(() => {
    async function fetchDetails() {
      if (!selectedNode) {
        setSelectedDetails(null);
        return;
      }
      try {
        const details = await getEntityDetails(selectedNode.id);
        setSelectedDetails(details);
      } catch (error) {
        console.error("Failed to fetch entity details:", error);
      }
    }
    fetchDetails();
  }, [selectedNode]);

  const handleRefresh = async () => {
    setIsLoading(true);
    try {
      const data = await getGraphData();
      setGraphData(data);
    } catch (error) {
      console.error("Failed to refresh graph:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const filteredData = useMemo(() => {
    if (!filterType && !searchQuery) return graphData;

    const filteredNodes = graphData.nodes.filter((node) => {
      const matchesType = !filterType || node.type === filterType;
      const matchesSearch = !searchQuery || 
        node.name.toLowerCase().includes(searchQuery.toLowerCase());
      return matchesType && matchesSearch;
    });

    const nodeIds = new Set(filteredNodes.map((n) => n.id));
    const filteredLinks = graphData.links.filter(
      (link) => nodeIds.has(link.source as string) && nodeIds.has(link.target as string)
    );

    return { nodes: filteredNodes, links: filteredLinks };
  }, [graphData, filterType, searchQuery]);

  // Transform data for force graph
  const forceGraphData = useMemo(() => ({
    nodes: filteredData.nodes.map((n) => ({
      id: n.id,
      name: n.name,
      type: n.type,
      val: Math.max(5, n.mentionCount * 3 + 5),
    })),
    links: filteredData.links.map((l) => ({
      source: l.source,
      target: l.target,
      label: l.relationType,
    })),
  }), [filteredData]);

  const handleNodeClick = useCallback((node: { id: string; name: string; type: string }) => {
    const graphNode = graphData.nodes.find((n) => n.id === node.id);
    if (graphNode) {
      setSelectedNode(graphNode);
    }
  }, [graphData.nodes]);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Header />

      <main className="flex-1 container mx-auto px-4 py-6 flex gap-6">
        {/* Graph Canvas */}
        <div className="flex-1 relative">
          <Card className="h-[calc(100vh-12rem)]">
            <CardContent className="p-0 h-full">
              {isLoading ? (
                <div className="flex items-center justify-center h-full">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : forceGraphData.nodes.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                  <p>No entities in your knowledge graph yet.</p>
                  <Link href="/add" className="text-primary hover:underline mt-2">
                    Add some content to get started
                  </Link>
                </div>
              ) : (
              <ForceGraph2D
                graphData={forceGraphData}
                nodeLabel="name"
                nodeColor={(node) => typeColors[(node as any).type || "concept"] || "#888"}
                nodeVal={(node) => (node as any).val || 5}
                linkColor={() => "#888"}
                linkWidth={1}
                onNodeClick={(node) => handleNodeClick(node as any)}
                nodeCanvasObjectMode={() => "after"}
                nodeCanvasObject={(node: { x?: number; y?: number; name?: string; type?: string; val?: number }, ctx: CanvasRenderingContext2D, globalScale: number) => {
                  const label = node.name || "";
                  const fontSize = 10 / globalScale;
                  ctx.font = `${fontSize}px Sans-Serif`;
                  ctx.textAlign = "center";
                  ctx.textBaseline = "middle";
                  ctx.fillStyle = "hsl(var(--foreground))";
                  ctx.fillText(label, node.x || 0, (node.y || 0) + (node.val || 5) / 2 + fontSize + 2);
                }}
              />
              )}
            </CardContent>
          </Card>

          {/* Controls */}
          <div className="absolute top-4 left-4 flex flex-col gap-2">
            <div className="flex gap-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search entities..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10 w-56 bg-background"
                />
              </div>
              <Button variant="outline" size="icon" onClick={handleRefresh} disabled={isLoading}>
                <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
              </Button>
            </div>
            <div className="flex gap-1 flex-wrap">
              {Object.keys(typeColors).map((type) => (
                <Button
                  key={type}
                  variant={filterType === type ? "default" : "outline"}
                  size="sm"
                  onClick={() => setFilterType(filterType === type ? null : type)}
                  className="capitalize text-xs"
                  style={{
                    borderColor: typeColors[type],
                    color: filterType === type ? "#fff" : typeColors[type],
                    backgroundColor: filterType === type ? typeColors[type] : "transparent",
                  }}
                >
                  {type}
                </Button>
              ))}
            </div>
          </div>

          {/* Stats */}
          <div className="absolute bottom-4 left-4 bg-background/80 backdrop-blur rounded-lg px-3 py-2 text-sm">
            <span className="font-medium">{filteredData.nodes.length}</span> entities,{" "}
            <span className="font-medium">{filteredData.links.length}</span> relationships
          </div>
        </div>

        {/* Sidebar */}
        <div className="w-80 flex-shrink-0">
          <Card className="h-[calc(100vh-12rem)] overflow-auto">
            <CardHeader>
              <CardTitle>
                {selectedNode ? selectedNode.name : "Knowledge Graph"}
              </CardTitle>
              <CardDescription>
                {selectedNode
                  ? `Type: ${selectedNode.type}`
                  : "Click on a node to see details"}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {selectedNode && selectedDetails ? (
                <div className="space-y-4">
                  <div>
                    <h4 className="text-sm font-medium mb-2">Entity Type</h4>
                    <Badge
                      style={{ backgroundColor: typeColors[selectedNode.type] }}
                      className="capitalize text-white"
                    >
                      {selectedNode.type}
                    </Badge>
                  </div>

                  {selectedDetails.description && (
                    <div>
                      <h4 className="text-sm font-medium mb-2">Description</h4>
                      <p className="text-sm text-muted-foreground">
                        {selectedDetails.description}
                      </p>
                    </div>
                  )}

                  <div>
                    <h4 className="text-sm font-medium mb-2">Connected Entities</h4>
                    {selectedDetails.connectedEntities.length > 0 ? (
                      <div className="space-y-2 max-h-40 overflow-y-auto">
                        {selectedDetails.connectedEntities.map((entity, idx) => (
                          <div
                            key={`${entity.id}-${idx}`}
                            className="flex items-center gap-2 p-2 rounded-lg bg-muted cursor-pointer hover:bg-muted/80"
                            onClick={() => {
                              const node = graphData.nodes.find((n) => n.id === entity.id);
                              if (node) setSelectedNode(node);
                            }}
                          >
                            <div
                              className="w-3 h-3 rounded-full flex-shrink-0"
                              style={{ backgroundColor: typeColors[entity.type] || "#888" }}
                            />
                            <span className="text-sm truncate">{entity.name}</span>
                            <Badge variant="outline" className="ml-auto text-xs">
                              {entity.relationType}
                            </Badge>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">No connections</p>
                    )}
                  </div>

                  <div>
                    <h4 className="text-sm font-medium mb-2">Mentioned In</h4>
                    {selectedDetails.documents.length > 0 ? (
                      <div className="space-y-2 max-h-40 overflow-y-auto">
                        {selectedDetails.documents.map((doc) => (
                          <Link
                            key={doc.id}
                            href={`/library/${doc.id}`}
                            className="block p-2 rounded-lg bg-muted hover:bg-muted/80 text-sm"
                          >
                            {doc.title}
                          </Link>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">No documents</p>
                    )}
                  </div>
                </div>
              ) : selectedNode ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <div className="space-y-4">
                  <p className="text-sm text-muted-foreground">
                    Your knowledge graph visualizes the relationships between
                    entities extracted from your documents.
                  </p>
                  <div>
                    <h4 className="text-sm font-medium mb-2">Legend</h4>
                    <div className="space-y-2">
                      {Object.entries(typeColors).map(([type, color]) => (
                        <div key={type} className="flex items-center gap-2">
                          <div
                            className="w-3 h-3 rounded-full"
                            style={{ backgroundColor: color }}
                          />
                          <span className="text-sm capitalize">{type}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}
