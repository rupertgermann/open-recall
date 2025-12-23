"use client";

import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Search, Loader2, RefreshCw, Focus, X, RotateCcw, ZoomIn, ZoomOut } from "lucide-react";
import { getGraphData, getDocumentGraph, getEntityDetails, type GraphData, type GraphNode } from "@/actions/graph";
import { getAllTags } from "@/actions/documents";
import { aiWebSearchForEntity, type WebSearchResult } from "@/actions/websearch";
import { Header } from "@/components/layout/header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";

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

const CLUSTER_VIEW_SCALE_START = 1.2;
const CLUSTER_VIEW_SCALE_END = 2.4;
const CLUSTER_TITLE_MIN_DEGREE = 8;
const CLUSTER_TITLE_OPACITY = 0.3;

export default function GraphPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const focusDocumentId = searchParams.get("focus");
  const focusEntityId = searchParams.get("entity");
  const { toast } = useToast();
  const [graphData, setGraphData] = useState<GraphData>({ nodes: [], links: [] });
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [selectedDetails, setSelectedDetails] = useState<EntityDetails | null>(null);
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [availableTags, setAvailableTags] = useState<string[]>([]);
  const [isTagDropdownOpen, setIsTagDropdownOpen] = useState(false);
  const [tagActiveIndex, setTagActiveIndex] = useState(0);
  const [webSearchResults, setWebSearchResults] = useState<WebSearchResult[]>([]);
  const [webSearchCacheByEntityId, setWebSearchCacheByEntityId] = useState<Record<string, WebSearchResult[]>>({});
  const [webSearchAdditionalPrompt, setWebSearchAdditionalPrompt] = useState("");
  const [webSearchAdditionalPromptByEntityId, setWebSearchAdditionalPromptByEntityId] = useState<Record<string, string>>({});
  const [isWebSearching, setIsWebSearching] = useState(false);
  const [isAddingUrl, setIsAddingUrl] = useState<Record<string, boolean>>({});
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const graphRef = useRef<any>(null);
  const isInitialized = useRef(false);
  const hasAutoZoomed = useRef(false);

  useEffect(() => {
    (async () => {
      try {
        const t = await getAllTags();
        setAvailableTags(t);
      } catch (e) {
        console.error("Failed to load tags:", e);
      }
    })();
  }, []);

  useEffect(() => {
    setTagActiveIndex(0);
  }, [tagInput, isTagDropdownOpen, selectedTags]);

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

  // Handle entity URL parameter
  useEffect(() => {
    if (focusEntityId && graphData.nodes.length > 0 && !isLoading) {
      const node = graphData.nodes.find(n => n.id === focusEntityId);
      if (node) {
        setSelectedNode(node);
        saveGraphState({ selectedNodeId: node.id });
      }
    }
  }, [focusEntityId, graphData.nodes, isLoading, saveGraphState]);

  // Restore state on mount
  useEffect(() => {
    if (isInitialized.current) return;
    
    // If URL has focus param, prioritize that and clear saved focus
    if (focusDocumentId) {
      saveGraphState({ focusDocumentId });
      return;
    }

    // Skip localStorage restoration if entity param is present
    if (focusEntityId) {
      isInitialized.current = true;
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
  }, [focusDocumentId, focusEntityId, graphData.nodes, saveGraphState]);

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
          : await getGraphData({ tags: selectedTags });
        setGraphData(data);
      } catch (error) {
        console.error("Failed to fetch graph:", error);
      } finally {
        setIsLoading(false);
      }
    }
    fetchGraph();
  }, [focusDocumentId, focusEntityId, selectedTags]);

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
        setWebSearchResults([]);
        setWebSearchAdditionalPrompt("");
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

  useEffect(() => {
    if (!selectedNode) return;
    setWebSearchResults(webSearchCacheByEntityId[selectedNode.id] || []);
    setWebSearchAdditionalPrompt(webSearchAdditionalPromptByEntityId[selectedNode.id] || "");
  }, [selectedNode, webSearchCacheByEntityId, webSearchAdditionalPromptByEntityId]);

  const handleAiWebSearch = useCallback(async () => {
    if (!selectedNode) return;
    setIsWebSearching(true);
    try {
      const results = await aiWebSearchForEntity({
        entityName: selectedNode.name,
        entityType: selectedNode.type,
        additionalPrompt: webSearchAdditionalPrompt,
        maxResults: 6,
      });
      setWebSearchResults(results);
      setWebSearchCacheByEntityId((prev) => ({ ...prev, [selectedNode.id]: results }));

      if (results.length === 0) {
        toast({
          title: "No results",
          description: "AI web search returned no results.",
        });
      }
    } catch (e) {
      toast({
        title: "AI web search failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setIsWebSearching(false);
    }
  }, [selectedNode, toast, webSearchAdditionalPrompt]);

  const handleAddSearchResult = useCallback(
    async (url: string) => {
      setIsAddingUrl((prev) => ({ ...prev, [url]: true }));
      try {
        const qs = new URLSearchParams({ url, start: "1" });
        router.push(`/add?${qs.toString()}`);
      } catch (e) {
        toast({
          title: "Failed to add",
          description: e instanceof Error ? e.message : "Unknown error",
          variant: "destructive",
        });
      } finally {
        setIsAddingUrl((prev) => ({ ...prev, [url]: false }));
      }
    },
    [router, toast]
  );

  const handleRefresh = async () => {
    setIsLoading(true);
    try {
      const data = focusDocumentId
        ? await getDocumentGraph(focusDocumentId)
        : await getGraphData({ tags: selectedTags });
      setGraphData(data);
    } catch (error) {
      console.error("Failed to refresh graph:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleReset = () => {
    setSearchQuery("");
    setSelectedTypes([]);
    setSelectedTags([]);
    setTagInput("");
    // Optionally reset view to fit all nodes
    if (graphRef.current) {
      graphRef.current.zoomToFit(400);
    }
  };

  const filteredData = useMemo(() => {
    if (selectedTypes.length === 0 && !searchQuery) return graphData;

    const filteredNodes = graphData.nodes.filter((node) => {
      const matchesType = selectedTypes.length === 0 || selectedTypes.includes(node.type);
      const matchesSearch = !searchQuery ||
        node.name.toLowerCase().includes(searchQuery.toLowerCase());
      return matchesType && matchesSearch;
    });

    const nodeIds = new Set(filteredNodes.map((n) => n.id));
    const filteredLinks = graphData.links.filter(
      (link) => nodeIds.has(link.source as string) && nodeIds.has(link.target as string)
    );

    return { nodes: filteredNodes, links: filteredLinks };
  }, [graphData, selectedTypes, searchQuery]);

  // Transform data for force graph
  const forceGraphData = useMemo(() => {
    // Calculate node degrees
    const degrees = new Map<string, number>();
    filteredData.links.forEach((l) => {
      const sourceId = typeof l.source === 'object' ? (l.source as any).id : l.source;
      const targetId = typeof l.target === 'object' ? (l.target as any).id : l.target;
      degrees.set(sourceId, (degrees.get(sourceId) || 0) + 1);
      degrees.set(targetId, (degrees.get(targetId) || 0) + 1);
    });

    return {
      nodes: filteredData.nodes.map((n) => ({
        id: n.id,
        name: n.name,
        type: n.type,
        val: Math.min(Math.max(5, n.mentionCount * 3 + 5), 50), // Cap at 50 to prevent oversized nodes
        degree: degrees.get(n.id) || 0,
      })),
      links: filteredData.links.map((l) => ({
        source: l.source,
        target: l.target,
        label: l.relationType,
      })),
    };
  }, [filteredData]);

  const maxNodeDegree = useMemo(() => {
    let max = 1;
    for (const n of forceGraphData.nodes as any[]) {
      const d = typeof n.degree === "number" ? n.degree : 0;
      if (d > max) max = d;
    }
    return max;
  }, [forceGraphData]);

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

  const handleZoomIn = useCallback(() => {
    if (graphRef.current) {
      const currentZoom = graphRef.current.zoom();
      const newZoom = currentZoom * 1.5;

      if (selectedNode) {
        const graphInstance = graphRef.current;
        const internalData = (graphInstance as any)._graphData || forceGraphData;
        const internalNode = internalData.nodes.find((n: any) => n.id === selectedNode.id);
        
        if (internalNode && internalNode.x !== undefined && internalNode.y !== undefined) {
          graphInstance.centerAt(internalNode.x, internalNode.y, 400);
          graphInstance.zoom(newZoom, 400);
          return;
        }
      }
      
      graphRef.current.zoom(newZoom, 400);
    }
  }, [selectedNode, forceGraphData]);

  const handleZoomOut = useCallback(() => {
    if (graphRef.current) {
      const currentZoom = graphRef.current.zoom();
      const newZoom = currentZoom / 1.2;

      if (selectedNode) {
        const graphInstance = graphRef.current;
        const internalData = (graphInstance as any)._graphData || forceGraphData;
        const internalNode = internalData.nodes.find((n: any) => n.id === selectedNode.id);
        
        if (internalNode && internalNode.x !== undefined && internalNode.y !== undefined) {
          graphInstance.centerAt(internalNode.x, internalNode.y, 400);
          graphInstance.zoom(newZoom, 400);
          return;
        }
      }

      graphRef.current.zoom(newZoom, 400);
    }
  }, [selectedNode, forceGraphData]);

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
    <div className="h-screen flex flex-col overflow-hidden">
      <Header />

      <main className="flex-1 flex gap-0 p-0 overflow-hidden">
        {/* Graph Canvas */}
        <div className="flex-1 h-full min-w-0">
          <Card className="h-full relative overflow-hidden flex flex-col">
            {/* Header Controls & Stats */}
            <div className="absolute top-0 left-0 right-0 z-10 border-b bg-background/40 backdrop-blur-sm">
              <div className="flex flex-wrap items-center gap-2 p-2">
                {/* Search */}
                <div className="relative flex-shrink-0">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Search entities..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-9 pr-8 w-48 md:w-64 bg-background"
                  />
                  {searchQuery && (
                    <button
                      onClick={() => setSearchQuery("")}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>

                {/* Tag Filter */}
                <div className="flex items-center gap-2 border-l pl-2 ml-1">
                  <div className="relative">
                    <Input
                      placeholder="Filter tags…"
                      value={tagInput}
                      onChange={(e) => setTagInput(e.target.value)}
                      onFocus={() => {
                        if (!focusDocumentId) setIsTagDropdownOpen(true);
                      }}
                      onBlur={() => {
                        setTimeout(() => setIsTagDropdownOpen(false), 120);
                      }}
                      onKeyDown={(e) => {
                        const q = tagInput.trim().toLowerCase();
                        const suggestions = (q.length === 0
                          ? availableTags
                              .filter((t) => !selectedTags.includes(t))
                              .slice(0, 10)
                          : availableTags
                              .filter((t) => !selectedTags.includes(t))
                              .filter((t) => t.includes(q))
                              .slice(0, 10));

                        if (e.key === "ArrowDown") {
                          e.preventDefault();
                          if (suggestions.length === 0) return;
                          setIsTagDropdownOpen(true);
                          setTagActiveIndex((i) => (i + 1) % suggestions.length);
                          return;
                        }

                        if (e.key === "ArrowUp") {
                          e.preventDefault();
                          if (suggestions.length === 0) return;
                          setIsTagDropdownOpen(true);
                          setTagActiveIndex((i) => (i - 1 + suggestions.length) % suggestions.length);
                          return;
                        }

                        if (e.key !== "Enter") return;
                        e.preventDefault();

                        if (suggestions.length > 0 && isTagDropdownOpen) {
                          const chosen = suggestions[Math.max(0, Math.min(tagActiveIndex, suggestions.length - 1))];
                          if (chosen) {
                            setSelectedTags((prev) => [...prev, chosen]);
                            setTagInput("");
                            return;
                          }
                        }

                        if (!q) return;
                        if (selectedTags.includes(q)) {
                          setTagInput("");
                          return;
                        }
                        setSelectedTags((prev) => [...prev, q]);
                        setTagInput("");
                      }}
                      className="w-40 bg-background"
                      disabled={!!focusDocumentId}
                    />

                    {!focusDocumentId && isTagDropdownOpen && (
                      <div
                        className="absolute left-0 right-0 top-full mt-1 z-20 rounded-md border bg-background shadow-sm"
                        onMouseDown={(e) => {
                          // Prevent input blur from closing the dropdown before click handlers run
                          e.preventDefault();
                        }}
                      >
                        {(tagInput.trim().length === 0
                          ? availableTags
                              .filter((t) => !selectedTags.includes(t))
                              .slice(0, 10)
                          : availableTags
                              .filter((t) => !selectedTags.includes(t))
                              .filter((t) => t.includes(tagInput.trim().toLowerCase()))
                              .slice(0, 10)
                        ).map((t, idx) => (
                            <button
                              key={t}
                              type="button"
                              onMouseDown={(e) => {
                                // Keep focus on the input so blur doesn't close the menu
                                e.preventDefault();
                              }}
                              onClick={() => {
                                setSelectedTags((prev) => [...prev, t]);
                                setTagInput("");
                                setIsTagDropdownOpen(false);
                              }}
                              className={`w-full px-2 py-1 text-left text-sm hover:bg-muted ${idx === tagActiveIndex ? "bg-muted" : ""}`}
                            >
                              {t}
                            </button>
                          ))}
                      </div>
                    )}
                  </div>

                  {selectedTags.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1">
                      {selectedTags.map((t) => (
                        <Badge
                          key={t}
                          variant="secondary"
                          className="gap-1 cursor-pointer"
                          onClick={() => setSelectedTags((prev) => prev.filter((x) => x !== t))}
                        >
                          {t}
                          <X className="h-3 w-3" />
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>

                {/* Filters */}
                <div className="flex gap-1 flex-wrap items-center border-l pl-2 ml-1">
                  {Object.keys(typeColors).map((type) => (
                    <Button
                      key={type}
                      variant={selectedTypes.includes(type) ? "default" : "outline"}
                      size="sm"
                      onClick={() => {
                        setSelectedTypes((prev) =>
                          prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]
                        );
                      }}
                      className="capitalize text-xs h-8"
                      style={{
                        borderColor: typeColors[type],
                        color: selectedTypes.includes(type) ? "#fff" : typeColors[type],
                        backgroundColor: selectedTypes.includes(type) ? typeColors[type] : "hsl(var(--background))",
                      }}
                    >
                      {type}
                    </Button>
                  ))}
                </div>

                {/* Stats */}
                <div className="flex items-center gap-2 text-sm text-muted-foreground border-l pl-2 ml-1">
                  <span className="whitespace-nowrap"><span className="font-medium text-foreground">{filteredData.nodes.length}</span> entities</span>
                  <span className="whitespace-nowrap"><span className="font-medium text-foreground">{filteredData.links.length}</span> relations</span>
                </div>

                {/* Actions */}
                <div className="ml-auto flex items-center gap-1">
                  <Button variant="ghost" size="icon" onClick={handleReset} title="Reset view">
                    <RotateCcw className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={handleRefresh} disabled={isLoading} title="Refresh data">
                    <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
                  </Button>
                </div>
              </div>
            </div>

            <CardContent ref={containerRef} className="p-0 flex-1 relative overflow-hidden">
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
                  nodeCanvasObject={(node: { x?: number; y?: number; name?: string; type?: string; val?: number; degree?: number }, ctx: CanvasRenderingContext2D, globalScale: number) => {
                    const label = node.name || "";

                    const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
                    const blendT = clamp01(
                      (globalScale - CLUSTER_VIEW_SCALE_START) /
                        (CLUSTER_VIEW_SCALE_END - CLUSTER_VIEW_SCALE_START)
                    );
                    const clusterAlpha = 1 - blendT;
                    const detailAlpha = blendT;

                    const isHighDegree = (node.degree || 0) >= CLUSTER_TITLE_MIN_DEGREE;

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

                    // Text Rendering Logic
                    // Cluster overlay (fades out as you zoom in)
                    if (clusterAlpha > 0.01 && isHighDegree) {
                      const overlayBaseFontSize = Math.max(12, 24 / globalScale);
                      const degree = node.degree || 0;
                      const degreeT = clamp01(degree / maxNodeDegree);
                      const sizeMultiplier = 0.5 + 1.5 * Math.sqrt(degreeT);
                      const overlayFontSize = overlayBaseFontSize * sizeMultiplier;

                      ctx.save();
                      ctx.globalAlpha = ctx.globalAlpha * clusterAlpha;
                      ctx.font = `bold ${overlayFontSize}px Sans-Serif`;
                      ctx.textAlign = "center";
                      ctx.textBaseline = "middle";
                      ctx.fillStyle = `hsl(var(--foreground) / ${CLUSTER_TITLE_OPACITY})`;
                      ctx.fillText(label, node.x || 0, node.y || 0);
                      ctx.restore();
                    }

                    // Detail labels (fade in as you zoom in)
                    if (detailAlpha > 0.01) {
                      const fontSize = 14 / globalScale;
                      ctx.font = `${fontSize}px Sans-Serif`;

                      const words = label.split(" ");
                      const maxLineLength = 15;
                      let lines: string[] = [];
                      let currentLine = words[0] || "";

                      for (let i = 1; i < words.length; i++) {
                        if (currentLine.length + words[i].length + 1 < maxLineLength) {
                          currentLine += " " + words[i];
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

                      ctx.save();
                      ctx.globalAlpha = ctx.globalAlpha * detailAlpha;
                      ctx.textAlign = "center";
                      ctx.textBaseline = "middle";
                      ctx.fillStyle = "hsl(var(--foreground))";

                      lines.forEach((line, i) => {
                        const yOffset = r + fontSize + (i * fontSize * 1.2);
                        ctx.fillText(line, node.x || 0, (node.y || 0) + yOffset);
                      });
                      ctx.restore();
                    }
                  }}
                />
              )}
            </CardContent>
          </Card>
        </div>

        {/* Sidebar */}
        <div className="w-96 flex-shrink-0 h-full">
          <Card className="h-full flex flex-col overflow-hidden">
            <CardHeader className="flex-shrink-0">
              <CardTitle>
                {selectedNode ? selectedNode.name : "Knowledge Graph"}
              </CardTitle>
              <CardDescription>
                {selectedNode
                  ? `Type: ${selectedNode.type}`
                  : "Click on a node to see details"}
              </CardDescription>
              {selectedNode && (
                <div className="flex gap-2 mt-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleZoomToNode}
                    className="gap-2 flex-1"
                  >
                    <Focus className="h-4 w-4" />
                    Zoom to Node
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={handleZoomIn}
                    title="Zoom In"
                    className="h-9 w-9"
                  >
                    <ZoomIn className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={handleZoomOut}
                    title="Zoom Out"
                    className="h-9 w-9"
                  >
                    <ZoomOut className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </CardHeader>
            <CardContent className="flex-1 overflow-y-auto">
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

                  <div>
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <h4 className="text-sm font-medium">AI Websearch</h4>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleAiWebSearch}
                        disabled={isWebSearching}
                      >
                        {isWebSearching ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          "Do AI websearch"
                        )}
                      </Button>
                    </div>

                    <Input
                      value={webSearchAdditionalPrompt}
                      onChange={(e) => {
                        const v = e.target.value;
                        setWebSearchAdditionalPrompt(v);
                        if (selectedNode) {
                          setWebSearchAdditionalPromptByEntityId((prev) => ({
                            ...prev,
                            [selectedNode.id]: v,
                          }));
                        }
                      }}
                      placeholder="Additional prompt (optional)…"
                      className="mb-2"
                    />

                    {webSearchResults.length > 0 ? (
                      <div className="space-y-2">
                        {webSearchResults.map((r) => (
                          <div key={r.url} className="rounded-lg border p-2">
                            <div className="text-sm font-medium leading-snug">{r.title}</div>
                            <div className="text-xs text-muted-foreground mt-1 line-clamp-3">{r.snippet}</div>
                            <div className="flex items-center gap-2 mt-2">
                              <a
                                href={r.url}
                                target="_blank"
                                rel="noreferrer"
                                className="text-xs text-primary hover:underline truncate"
                              >
                                {r.url}
                              </a>
                              <Button
                                size="sm"
                                className="ml-auto"
                                onClick={() => handleAddSearchResult(r.url)}
                                disabled={!!isAddingUrl[r.url]}
                              >
                                {isAddingUrl[r.url] ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  "Add to library"
                                )}
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        Use AI websearch to find relevant sources and add them to your library.
                      </p>
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
