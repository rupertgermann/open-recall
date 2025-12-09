"use client";

import { useState, useCallback, useMemo } from "react";
import dynamic from "next/dynamic";
import { Search, Filter, ZoomIn, ZoomOut, Maximize2 } from "lucide-react";
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

// Mock graph data
const mockGraphData = {
  nodes: [
    { id: "graphrag", name: "GraphRAG", type: "concept", val: 20 },
    { id: "rag", name: "RAG", type: "concept", val: 15 },
    { id: "knowledge-graph", name: "Knowledge Graph", type: "concept", val: 18 },
    { id: "vector-search", name: "Vector Search", type: "technology", val: 12 },
    { id: "llm", name: "LLM", type: "technology", val: 16 },
    { id: "embeddings", name: "Embeddings", type: "concept", val: 10 },
    { id: "postgresql", name: "PostgreSQL", type: "technology", val: 8 },
    { id: "pgvector", name: "pgvector", type: "technology", val: 7 },
    { id: "ollama", name: "Ollama", type: "technology", val: 9 },
    { id: "local-first", name: "Local-First", type: "concept", val: 11 },
    { id: "privacy", name: "Privacy", type: "concept", val: 8 },
    { id: "nextjs", name: "Next.js", type: "technology", val: 10 },
  ],
  links: [
    { source: "graphrag", target: "rag", label: "extends" },
    { source: "graphrag", target: "knowledge-graph", label: "uses" },
    { source: "rag", target: "vector-search", label: "uses" },
    { source: "rag", target: "llm", label: "uses" },
    { source: "vector-search", target: "embeddings", label: "requires" },
    { source: "embeddings", target: "llm", label: "generated_by" },
    { source: "pgvector", target: "postgresql", label: "extends" },
    { source: "vector-search", target: "pgvector", label: "implemented_by" },
    { source: "ollama", target: "llm", label: "provides" },
    { source: "local-first", target: "privacy", label: "enables" },
    { source: "local-first", target: "ollama", label: "uses" },
    { source: "nextjs", target: "local-first", label: "supports" },
  ],
};

const typeColors: Record<string, string> = {
  concept: "#3b82f6",
  technology: "#10b981",
  person: "#f59e0b",
  organization: "#8b5cf6",
};

export default function GraphPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedNode, setSelectedNode] = useState<typeof mockGraphData.nodes[0] | null>(null);
  const [filterType, setFilterType] = useState<string | null>(null);

  const filteredData = useMemo(() => {
    if (!filterType && !searchQuery) return mockGraphData;

    const filteredNodes = mockGraphData.nodes.filter((node) => {
      const matchesType = !filterType || node.type === filterType;
      const matchesSearch = !searchQuery || 
        node.name.toLowerCase().includes(searchQuery.toLowerCase());
      return matchesType && matchesSearch;
    });

    const nodeIds = new Set(filteredNodes.map((n) => n.id));
    const filteredLinks = mockGraphData.links.filter(
      (link) => nodeIds.has(link.source as string) && nodeIds.has(link.target as string)
    );

    return { nodes: filteredNodes, links: filteredLinks };
  }, [filterType, searchQuery]);

  const handleNodeClick = useCallback((node: typeof mockGraphData.nodes[0]) => {
    setSelectedNode(node);
  }, []);

  const getConnectedNodes = (nodeId: string) => {
    const connected = new Set<string>();
    mockGraphData.links.forEach((link) => {
      if (link.source === nodeId) connected.add(link.target as string);
      if (link.target === nodeId) connected.add(link.source as string);
    });
    return mockGraphData.nodes.filter((n) => connected.has(n.id));
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Header />

      <main className="flex-1 container mx-auto px-4 py-6 flex gap-6">
        {/* Graph Canvas */}
        <div className="flex-1 relative">
          <Card className="h-[calc(100vh-12rem)]">
            <CardContent className="p-0 h-full">
              <ForceGraph2D
                graphData={filteredData}
                nodeLabel="name"
                nodeColor={(node) => typeColors[(node as any).type || "concept"] || "#888"}
                nodeVal={(node) => (node as any).val || 5}
                linkColor={() => "#888"}
                linkWidth={1}
                onNodeClick={(node) => handleNodeClick(node as any)}
                nodeCanvasObject={(node: { x?: number; y?: number; name?: string; type?: string; val?: number }, ctx: CanvasRenderingContext2D, globalScale: number) => {
                  const label = node.name || "";
                  const fontSize = 12 / globalScale;
                  ctx.font = `${fontSize}px Sans-Serif`;
                  const textWidth = ctx.measureText(label).width;
                  const bckgDimensions = [textWidth, fontSize].map((n) => n + fontSize * 0.2);

                  // Draw node circle
                  ctx.beginPath();
                  ctx.arc(node.x || 0, node.y || 0, (node.val || 5) / 2, 0, 2 * Math.PI);
                  ctx.fillStyle = typeColors[node.type || "concept"] || "#888";
                  ctx.fill();

                  // Draw label
                  ctx.textAlign = "center";
                  ctx.textBaseline = "middle";
                  ctx.fillStyle = "#fff";
                  ctx.fillText(label, node.x || 0, (node.y || 0) + (node.val || 5) / 2 + fontSize);
                }}
                nodePointerAreaPaint={(node: { x?: number; y?: number; val?: number }, color: string, ctx: CanvasRenderingContext2D) => {
                  ctx.fillStyle = color;
                  ctx.beginPath();
                  ctx.arc(node.x || 0, node.y || 0, (node.val || 5) / 2, 0, 2 * Math.PI);
                  ctx.fill();
                }}
              />
            </CardContent>
          </Card>

          {/* Controls */}
          <div className="absolute top-4 left-4 flex flex-col gap-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search entities..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 w-64 bg-background"
              />
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
              {selectedNode ? (
                <div className="space-y-4">
                  <div>
                    <h4 className="text-sm font-medium mb-2">Entity Type</h4>
                    <Badge
                      style={{ backgroundColor: typeColors[selectedNode.type] }}
                      className="capitalize"
                    >
                      {selectedNode.type}
                    </Badge>
                  </div>

                  <div>
                    <h4 className="text-sm font-medium mb-2">Connected Entities</h4>
                    <div className="space-y-2">
                      {getConnectedNodes(selectedNode.id).map((node) => (
                        <div
                          key={node.id}
                          className="flex items-center gap-2 p-2 rounded-lg bg-muted cursor-pointer hover:bg-muted/80"
                          onClick={() => setSelectedNode(node)}
                        >
                          <div
                            className="w-3 h-3 rounded-full"
                            style={{ backgroundColor: typeColors[node.type] }}
                          />
                          <span className="text-sm">{node.name}</span>
                          <Badge variant="outline" className="ml-auto text-xs capitalize">
                            {node.type}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div>
                    <h4 className="text-sm font-medium mb-2">Mentioned In</h4>
                    <p className="text-sm text-muted-foreground">
                      3 documents reference this entity
                    </p>
                  </div>
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
