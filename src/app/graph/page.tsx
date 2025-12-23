"use client";

import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Search, Loader2, RefreshCw, Focus } from "lucide-react";
import { getGraphData, getDocumentGraph, getEntityDetails, type GraphData, type GraphNode } from "@/actions/graph";
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

type GraphState = {
  selectedNodeId: string | null;
  camera: { x: number; y: number; k: number } | null;
  focusDocumentId: string | null;
};

const STORAGE_KEY = "open-recall-graph-state";

export default function GraphPage() {
  const searchParams = useSearchParams();
  const focusDocumentId = searchParams.get("focus");
  const [graphData, setGraphData] = useState<GraphData>({ nodes: [], links: [] });
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [selectedDetails, setSelectedDetails] = useState<EntityDetails | null>(null);
  const [filterType, setFilterType] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const graphRef = useRef<any>(null);
  const isInitialized = useRef(false);
  const hasAutoZoomed = useRef(false);

  // Save state to local storage
  const saveGraphState = useCallback((newState: Partial<GraphState>) => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      const current: GraphState = saved ? JSON.parse(saved) : {
        selectedNodeId: null,
        camera: null,
        focusDocumentId: null
      };
      
      const updated = { ...current, ...newState };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    } catch (e) {
      console.error("Failed to save graph state:", e);
    }
  }, []);

  // Restore state on mount
  useEffect(() => {
    if (isInitialized.current) return;
    
    // If URL has focus param, prioritize that and clear saved focus
    if (focusDocumentId) {
      saveGraphState({ focusDocumentId });
      return;
    }

    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const state: GraphState = JSON.parse(saved);
        
        // Restore selected node if we have data
        if (state.selectedNodeId && graphData.nodes.length > 0) {
          const node = graphData.nodes.find(n => n.id === state.selectedNodeId);
          if (node) setSelectedNode(node);
        }

        // Restore camera if graph ref exists
        if (state.camera && graphRef.current) {
          graphRef.current.centerAt(state.camera.x, state.camera.y, 0);
          graphRef.current.zoom(state.camera.k, 0);
        }
      }
    } catch (e) {
      console.error("Failed to restore graph state:", e);
    }
    isInitialized.current = true;
  }, [focusDocumentId, graphData.nodes, saveGraphState]);

  // Save camera state on zoom/pan end
  const handleEngineStop = useCallback(() => {
    if (graphRef.current) {
      const { x, y, k } = graphRef.current.cameraPosition();
      saveGraphState({ camera: { x, y, k } });
    }
  }, [saveGraphState]);

  useEffect(() => {
    if (!containerRef.current) return;

    const updateDimensions = () => {
      if (containerRef.current) {
        setDimensions({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        });
      }
    };

    const observer = new ResizeObserver(updateDimensions);
    observer.observe(containerRef.current);
    updateDimensions(); // Initial size

    return () => observer.disconnect();
  }, []);

  // Fetch graph data
  useEffect(() => {
    async function fetchGraph() {
      setIsLoading(true);
      try {
        const data = focusDocumentId 
          ? await getDocumentGraph(focusDocumentId)
          : await getGraphData();
        setGraphData(data);
      } catch (error) {
        console.error("Failed to fetch graph:", error);
      } finally {
        setIsLoading(false);
      }
    }
    fetchGraph();
  }, [focusDocumentId]);

  // Center graph when focused data loads
  useEffect(() => {
    if (focusDocumentId && !isLoading && graphRef.current && graphData.nodes.length > 0) {
      // Center and zoom to fit all nodes
      setTimeout(() => {
        graphRef.current?.zoomToFit(400);
      }, 100);
    }
  }, [focusDocumentId, isLoading, graphData.nodes.length]);
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
      val: Math.min(Math.max(5, n.mentionCount * 3 + 5), 50), // Cap at 50 to prevent oversized nodes
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
      saveGraphState({ selectedNodeId: graphNode.id });
    }
  }, [graphData.nodes, saveGraphState]);

  // Restore state when data loads
  useEffect(() => {
    if (isLoading || graphData.nodes.length === 0) return;

    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const state: GraphState = JSON.parse(saved);
        
        // Restore selected node if not already selected
        if (state.selectedNodeId && !selectedNode) {
          const node = graphData.nodes.find(n => n.id === state.selectedNodeId);
          if (node) setSelectedNode(node);
        }

        // Only restore camera if there's no selected node (auto-zoom will handle it otherwise)
        if (state.camera && graphRef.current && !isInitialized.current && !state.selectedNodeId) {
          // Add a small delay to ensure graph is ready
          setTimeout(() => {
             if (graphRef.current) {
                graphRef.current.centerAt(state.camera!.x, state.camera!.y, 0);
                graphRef.current.zoom(state.camera!.k, 0);
             }
          }, 100);
          isInitialized.current = true;
        }
      }
    } catch (e) {
      console.error("Failed to restore graph state:", e);
    }
  }, [isLoading, graphData.nodes, selectedNode, saveGraphState]);

  // Save camera state handler
  const handleZoomEnd = useCallback((transform: { k: number; x: number; y: number }) => {
    saveGraphState({ camera: transform });
  }, [saveGraphState]);

  // Zoom to and center on the selected node
  const handleZoomToNode = useCallback(() => {
    if (!selectedNode || !graphRef.current) return;
    
    const graphInstance = graphRef.current;
    const internalData = (graphInstance as any)._graphData || forceGraphData;
    const internalNode = internalData.nodes.find((n: any) => n.id === selectedNode.id);
    
    if (internalNode && internalNode.x !== undefined && internalNode.y !== undefined) {
      // Center on the node and zoom in for focus
      graphInstance.centerAt(internalNode.x, internalNode.y, 500);
      graphInstance.zoom(5, 500);
    }
  }, [selectedNode, forceGraphData]);

  // Auto-zoom to selected node on page load
  useEffect(() => {
    if (!selectedNode || !graphRef.current || isLoading || hasAutoZoomed.current) return;
    
    // Wait for the graph to stabilize and node positions to be calculated
    const timer = setTimeout(() => {
      if (!graphRef.current) return;
      
      const graphInstance = graphRef.current;
      const internalData = (graphInstance as any)._graphData || forceGraphData;
      const internalNode = internalData.nodes.find((n: any) => n.id === selectedNode.id);
      
      if (internalNode && internalNode.x !== undefined && internalNode.y !== undefined) {
        graphInstance.centerAt(internalNode.x, internalNode.y, 500);
        graphInstance.zoom(5, 500);
        hasAutoZoomed.current = true;
      }
    }, 800);
    
    return () => clearTimeout(timer);
  }, [selectedNode, isLoading, forceGraphData]);

  return (
    <div className="min-h-screen flex flex-col">
      <Header />

      <main className="flex-1 flex gap-6 px-6 py-6">
        {/* Graph Canvas */}
        <div className="flex-1 relative">
          <Card className="h-[calc(100vh-12rem)]">
            <CardContent ref={containerRef} className="p-0 h-full overflow-hidden">
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
                  ref={graphRef}
                  width={dimensions.width}
                  height={dimensions.height}
                  graphData={forceGraphData}
                  nodeLabel="name"
                  nodeColor={(node) => typeColors[(node as any).type || "concept"] || "#888"}
                  nodeVal={(node) => (node as any).val || 5}
                  linkColor={() => "#888"}
                  linkWidth={1}
                  onNodeClick={(node) => handleNodeClick(node as any)}
                  onZoomEnd={handleZoomEnd}
                  nodeCanvasObjectMode={() => "replace"}
                  nodeCanvasObject={(node: { x?: number; y?: number; name?: string; type?: string; val?: number }, ctx: CanvasRenderingContext2D, globalScale: number) => {
                    const label = node.name || "";
                    const fontSize = 14 / globalScale; // Increased font size
                    ctx.font = `${fontSize}px Sans-Serif`;
                    const textWidth = ctx.measureText(label).width;
                    const bckgDimensions = [textWidth, fontSize].map(n => n + fontSize * 0.2); // some padding

                    // Draw Node
                    const baseRadius = Math.sqrt(Math.max(0, node.val || 5)) * 0.4; // Reduced by 90% (from *4 to *0.4)
                    const maxRadius = 100 / globalScale; // Cap at 20px, adjusted for zoom
                    const minRadius = maxRadius * 0.05; // Minimum size is 33% of max size (6.67px when max is 20px)
                    const r = Math.max(minRadius, Math.min(baseRadius, maxRadius)); // Cap both min and max
                    
                    // Draw glow effect for selected node
                    const isSelected = selectedNode && selectedNode.id === (node as any).id;
                    if (isSelected) {
                      // Glow parameters - adjust these to customize the effect
                      const baseColor = typeColors[(node as any).type || "concept"] || "#888";
                      const glowRadius = 20 / globalScale; // Glow size (increase for more prominent glow)
                      const glowOpacity = 0.4; // Glow transparency (0.1 = subtle, 0.5 = prominent)
                      
                      // Convert hex to RGB and add alpha channel
                      const hexToRgb = (hex: string) => {
                        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
                        return result ? {
                          r: parseInt(result[1], 16),
                          g: parseInt(result[2], 16),
                          b: parseInt(result[3], 16)
                        } : { r: 136, g: 136, b: 136 }; // Default to #888
                      };
                      
                      const rgb = hexToRgb(baseColor);
                      
                      // Draw multiple circles for glow effect
                      for (let i = 3; i > 0; i--) {
                        ctx.beginPath();
                        ctx.arc(node.x || 0, node.y || 0, r + (glowRadius * i / 3), 0, 2 * Math.PI, false);
                        const alpha = Math.floor(glowOpacity * 255 / i);
                        ctx.fillStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha / 255})`;
                        ctx.fill();
                      }
                    }
                    
                    ctx.beginPath();
                    ctx.arc(node.x || 0, node.y || 0, r, 0, 2 * Math.PI, false);
                    ctx.fillStyle = typeColors[(node as any).type || "concept"] || "#888";
                    ctx.fill();

                    // Text Wrapping Logic
                    const words = label.split(' ');
                    const maxLineLength = 15; // characters
                    let lines = [];
                    let currentLine = words[0];

                    for (let i = 1; i < words.length; i++) {
                      if (currentLine.length + words[i].length + 1 < maxLineLength) {
                        currentLine += ' ' + words[i];
                      } else {
                        lines.push(currentLine);
                        currentLine = words[i];
                      }
                    }
                    lines.push(currentLine);
                    if (lines.length > 2) {
                      lines = lines.slice(0, 2);
                      lines[1] += "...";
                    }

                    // Draw Text
                    ctx.textAlign = "center";
                    ctx.textBaseline = "middle";
                    ctx.fillStyle = "hsl(var(--foreground))";

                    lines.forEach((line, i) => {
                      const yOffset = r + fontSize + (i * fontSize * 1.2);
                      ctx.fillText(line, node.x || 0, (node.y || 0) + yOffset);
                    });
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
        <div className="w-96 flex-shrink-0">
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
              {selectedNode && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleZoomToNode}
                  className="mt-2 gap-2"
                >
                  <Focus className="h-4 w-4" />
                  Zoom to Node
                </Button>
              )}
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
                      <div className="space-y-2 max-h-60 overflow-y-auto">
                        {selectedDetails.connectedEntities.map((entity, idx) => (
                          <div
                            key={`${entity.id}-${idx}`}
                            className="flex items-center gap-2 p-2 rounded-lg bg-muted cursor-pointer hover:bg-muted/80"
                            onClick={() => {
                              const node = graphData.nodes.find((n) => n.id === entity.id);
                              if (node && graphRef.current) {
                                setSelectedNode(node);
                                saveGraphState({ selectedNodeId: node.id });
                                // Get the current zoom level
                                const currentZoom = graphRef.current.zoom();
                                
                                // Use the force graph's internal data structure
                                const graphInstance = graphRef.current;
                                // Access the graph's current state through the internal _graphData property
                                const internalData = (graphInstance as any)._graphData || forceGraphData;
                                const internalNode = internalData.nodes.find((n: any) => n.id === entity.id);
                                
                                if (internalNode && internalNode.x !== undefined && internalNode.y !== undefined) {
                                  // Center the graph on this node while preserving current zoom
                                  graphInstance.centerAt(internalNode.x, internalNode.y, 400);
                                  graphInstance.zoom(currentZoom, 400);
                                }
                              }
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
