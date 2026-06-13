import React, { useEffect, useState, useMemo, useRef } from "react";
import { X, Network, Search, SlidersHorizontal, ChevronLeft, ChevronRight, RotateCcw } from "lucide-react";
import ForceGraph3D from "react-force-graph-3d";
import { forceCollide } from "d3-force-3d";
import * as THREE from "three";

interface GraphModalProps {
  apiBase: string;
  onClose: () => void;
}

export const GraphModal: React.FC<GraphModalProps> = ({ apiBase, onClose }) => {
  const [graphData, setGraphData] = useState({ nodes: [], links: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const fgRef = useRef<any>(null);
  const [isPanelExpanded, setIsPanelExpanded] = useState(true);
  const [searchVal, setSearchVal] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [isArchView, setIsArchView] = useState(false);
  const [selectedNode, setSelectedNode] = useState<any>(null);
  const [isChainFocus, setIsChainFocus] = useState(false);
  const [visibleLayers, setVisibleLayers] = useState({
    packages: true,
    folders: true,
    files: true,
    classes: true,
    functions: true,
    dependencies: true,
  });
  const [visibleRelations, setVisibleRelations] = useState({
    imports: true,
    calls: true,
    inheritance: true,
    references: false,
  });
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set());
  const lastClickRef = useRef<{ nodeId: string; time: number } | null>(null);

  useEffect(() => {
    if (graphData.nodes.length > 2000) {
      setIsArchView(true);
    }
  }, [graphData]);

  useEffect(() => {
    const fetchGraph = async () => {
      try {
        const res = await fetch(`${apiBase}/graph`);
        if (!res.ok) throw new Error("Failed to fetch graph data");
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        if (data.nodes && data.links) {
          data.nodes.forEach((n: any) => {
            if (n.val === undefined) {
              let baseVal = 1.0;
              if (n.type === "package" || n.type === "folder") baseVal = 4.0;
              else if (n.type === "file") baseVal = 3.0;
              else if (n.type === "class") baseVal = 2.0;
              else if (n.type === "function") baseVal = 1.5;
              n.val = baseVal;
            }
            n.connections = 0;
          });
          setGraphData(data);
        } else {
          throw new Error("Invalid graph data format received from backend");
        }
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };
    fetchGraph();
  }, [apiBase]);

  const nodesMap = useMemo(() => {
    const m = new Map<string, any>();
    graphData.nodes.forEach((n: any) => m.set(n.id, n));
    return m;
  }, [graphData.nodes]);

  const folderDescendants = useMemo(() => {
    const descendants = new Map<string, string[]>();
    graphData.nodes.forEach((n: any) => {
      if (n.type !== "folder" && n.type !== "package") {
        let currentPath = n.path;
        if (currentPath && currentPath !== "External Dependency") {
          const norm = currentPath.replace(/\\/g, '/');
          const parts = norm.split('/');
          for (let i = 1; i < parts.length; i++) {
            const fPath = parts.slice(0, i).join('/');
            if (!descendants.has(fPath)) descendants.set(fPath, []);
            descendants.get(fPath)!.push(n.id);
          }
        }
      }
    });
    return descendants;
  }, [graphData.nodes]);

  const getParentFolder = (node: any) => {
    if (node.type === "package" || node.type === "external") return node.name;
    if (!node.path || node.path === "External Dependency") return "external";
    const parts = node.path.replace(/\\/g, '/').split('/');
    return parts.length > 1 ? parts.slice(0, parts.length - 1).join('/') : "root";
  };

  const getFolderStats = (folderId: string) => {
    const descIds = folderDescendants.get(folderId) || [];
    let fileCount = 0, classCount = 0, funcCount = 0;
    descIds.forEach((id) => {
      const node = nodesMap.get(id);
      if (node) {
        if (node.type === "file") fileCount++;
        else if (node.type === "class") classCount++;
        else if (node.type === "function" || node.type === "chunk") funcCount++;
      }
    });
    return { files: fileCount, classes: classCount, functions: funcCount };
  };

  const getFolderDependencies = (nodeId: string, nodeType: string, descIds: string[], links: any[], map: Map<string, any>) => {
    const outgoing = new Map<string, number>();
    const sourceIds = (nodeType === "folder" || nodeType === "package") ? new Set<string>([nodeId, ...descIds]) : new Set<string>([nodeId]);
    links.forEach((l: any) => {
      if (l.type === "depends_on") {
        const sId = typeof l.source === 'object' ? l.source.id : l.source;
        const tId = typeof l.target === 'object' ? l.target.id : l.target;
        if (sourceIds.has(sId) && !sourceIds.has(tId)) {
          const targetNode = map.get(tId);
          if (targetNode) {
            const parentDir = getParentFolder(targetNode);
            outgoing.set(parentDir, (outgoing.get(parentDir) || 0) + (l.weight || 1));
          }
        }
      }
    });
    return Array.from(outgoing.entries()).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([name]) => name);
  };

  const getSuggestedLayer = (node: any) => {
    const path = (node.path || "").toLowerCase();
    if (path.includes("api") || path.includes("routes") || path.includes("controller") || path.includes("handler") || path.includes("server") || path.includes("endpoints")) return "🌐 API Layer";
    if (path.includes("service") || path.includes("logic") || path.includes("core") || path.includes("utils") || path.includes("helpers") || path.includes("manager")) return "⚙️ Service Layer";
    if (path.includes("db") || path.includes("database") || path.includes("repository") || path.includes("models") || path.includes("schema") || path.includes("store") || path.includes("query")) return "🗄️ Data Layer";
    if (path.includes("ui") || path.includes("components") || path.includes("views") || path.includes("pages") || path.includes("frontend") || path.includes("styles") || path.includes("templates")) return "🎨 UI Layer";
    return null;
  };

  const activeLayers = useMemo(() => isArchView ? { packages: true, folders: true, files: false, classes: false, functions: false, dependencies: true } : visibleLayers, [isArchView, visibleLayers]);

  const filteredData = useMemo(() => {
    const nodes = graphData.nodes.filter((node: any) => {
      if (node.type === "package" && !activeLayers.packages) return false;
      if (node.type === "folder" && !activeLayers.folders) return false;
      if (node.type === "file" && !activeLayers.files) return false;
      if (node.type === "class" && !activeLayers.classes) return false;
      if (node.type === "function" && !activeLayers.functions) return false;
      if (node.type === "external" && !activeLayers.dependencies) return false;
      if (node.type === "chunk" && !activeLayers.classes && !activeLayers.functions) return false;
      let currentPath = node.path;
      if (currentPath && currentPath !== "External Dependency") {
        const normalizedPath = currentPath.replace(/\\/g, '/');
        const parts = normalizedPath.split('/');
        const isFolderOrPackage = node.type === 'folder' || node.type === 'package';
        const limit = isFolderOrPackage ? parts.length - 1 : parts.length;
        for (let i = 1; i <= limit; i++) {
          const ancestor = parts.slice(0, i).join('/');
          if (collapsedFolders.has(ancestor)) return false;
        }
      }
      return true;
    });
    const nodeIds = new Set(nodes.map((n: any) => n.id));
    const links = graphData.links.filter((link: any) => {
      const sourceId = typeof link.source === 'object' ? link.source.id : link.source;
      const targetId = typeof link.target === 'object' ? link.target.id : link.target;
      if (!nodeIds.has(sourceId) || !nodeIds.has(targetId)) return false;
      if (link.type === "depends_on") {
        if (link.relation === "import" && !visibleRelations.imports) return false;
        if (link.relation === "call" && !visibleRelations.calls) return false;
        if (link.relation === "inheritance" && !visibleRelations.inheritance) return false;
        if (link.relation === "reference" && !visibleRelations.references) return false;
      }
      return true;
    });
    return { nodes, links };
  }, [graphData, activeLayers, visibleRelations, collapsedFolders]);

  const nodesForDisplay = useMemo(() => {
    const { nodes, links } = filteredData;
    const connectionCounts: Record<string, number> = {};
    links.forEach((link: any) => {
      const sId = typeof link.source === 'object' ? link.source.id : link.source;
      const tId = typeof link.target === 'object' ? link.target.id : link.target;
      connectionCounts[sId] = (connectionCounts[sId] || 0) + 1;
      connectionCounts[tId] = (connectionCounts[tId] || 0) + 1;
    });
    return nodes.map((node: any) => ({ ...node, connections: connectionCounts[node.id] || 0, val: (node.val || 1.0) + (connectionCounts[node.id] || 0) * 0.2 }));
  }, [filteredData]);

  const jumpClusters = useMemo(() => nodesForDisplay.filter((n: any) => n.type === "package" || (n.type === "folder" && (n.path || "").indexOf("/") === -1)), [nodesForDisplay]);

  const dependencyChain = useMemo(() => {
    if (!selectedNode || !isChainFocus) return new Set<string>();
    const targetId = selectedNode.id;
    const downstream = new Set<string>([targetId]);
    let q = [targetId];
    while (q.length > 0) {
      const curr = q.shift()!;
      graphData.links.forEach((l: any) => {
        const sId = typeof l.source === 'object' ? l.source.id : l.source;
        const tId = typeof l.target === 'object' ? l.target.id : l.target;
        if (sId === curr && !downstream.has(tId)) { downstream.add(tId); q.push(tId); }
      });
    }
    const upstream = new Set<string>([targetId]);
    q = [targetId];
    while (q.length > 0) {
      const curr = q.shift()!;
      graphData.links.forEach((l: any) => {
        const sId = typeof l.source === 'object' ? l.source.id : l.source;
        const tId = typeof l.target === 'object' ? l.target.id : l.target;
        if (tId === curr && !upstream.has(sId)) { upstream.add(sId); q.push(sId); }
      });
    }
    return new Set([...downstream, ...upstream]);
  }, [selectedNode, isChainFocus, graphData]);

  const searchNeighbors = useMemo(() => {
    if (!searchQuery.trim()) return new Set<string>();
    const query = searchQuery.toLowerCase().trim();
    const matched = nodesForDisplay.find((n: any) => n.name.toLowerCase().includes(query));
    if (!matched) return new Set<string>();
    const neighbors = new Set<string>([matched.id]);
    filteredData.links.forEach((link: any) => {
      const sId = typeof link.source === 'object' ? link.source.id : link.source;
      const tId = typeof link.target === 'object' ? link.target.id : link.target;
      if (sId === matched.id) neighbors.add(tId);
      else if (tId === matched.id) neighbors.add(sId);
    });
    return neighbors;
  }, [searchQuery, nodesForDisplay, filteredData.links]);

  const highlightedNodes = useMemo(() => (selectedNode && isChainFocus) ? dependencyChain : searchNeighbors, [selectedNode, isChainFocus, dependencyChain, searchNeighbors]);

  const selectedNodeLinks = useMemo(() => {
    if (!selectedNode) return { dependents: [], dependencies: [] };
    const targetId = selectedNode.id;
    const dependentsSet = new Set<string>(), dependenciesSet = new Set<string>();
    filteredData.links.forEach((l: any) => {
      const sId = typeof l.source === 'object' ? l.source.id : l.source;
      const tId = typeof l.target === 'object' ? l.target.id : l.target;
      if (sId === targetId) { const n = nodesMap.get(tId); if (n) dependenciesSet.add(n.name); }
      if (tId === targetId) { const n = nodesMap.get(sId); if (n) dependentsSet.add(n.name); }
    });
    return { dependents: Array.from(dependentsSet), dependencies: Array.from(dependenciesSet) };
  }, [selectedNode, filteredData.links, nodesMap]);

  const repoMetrics = useMemo(() => {
    if (!graphData.nodes.length) return null;
    let counts = { packages: 0, folders: 0, files: 0, classes: 0, functions: 0, external: 0 };
    graphData.nodes.forEach((n: any) => {
      if (n.type === "package") counts.packages++;
      else if (n.type === "folder") counts.folders++;
      else if (n.type === "file") counts.files++;
      else if (n.type === "class") counts.classes++;
      else if (n.type === "function") counts.functions++;
      else if (n.type === "external") counts.external++;
    });
    const dependsOnCounts: Record<string, number> = {};
    graphData.links.forEach((l: any) => {
      if (l.type === "depends_on") {
        const sId = typeof l.source === 'object' ? l.source.id : l.source;
        const tId = typeof l.target === 'object' ? l.target.id : l.target;
        dependsOnCounts[sId] = (dependsOnCounts[sId] || 0) + 1;
        dependsOnCounts[tId] = (dependsOnCounts[tId] || 0) + 1;
      }
    });
    let maxConn = -1, mostConn = "";
    graphData.nodes.forEach((n: any) => {
      if (n.type !== "package" && n.type !== "folder" && n.type !== "external") {
        const c = dependsOnCounts[n.id] || 0;
        if (c > maxConn) { maxConn = c; mostConn = n.name; }
      }
    });
    return { ...counts, circular: graphData.links.filter((l: any) => l.isCyclic).length, mostConnected: mostConn || "None", largestPackage: "N/A" };
  }, [graphData]);

  useEffect(() => {
    if (fgRef.current && nodesForDisplay.length > 0) {
      fgRef.current.d3Force('link').distance(100);
      fgRef.current.d3Force('charge').strength(-250);
      fgRef.current.d3Force('collide', forceCollide((node: any) => Math.cbrt(node.val || 1) * 8 + 3));
    }
  }, [nodesForDisplay]);

  const handleNodeDoubleClick = (node: any) => {
    if (node.type === "folder" || node.type === "package") {
      setCollapsedFolders((prev) => {
        const next = new Set(prev);
        if (next.has(node.id)) next.delete(node.id);
        else next.add(node.id);
        return next;
      });
    }
  };

  const resetCamera = () => fgRef.current?.zoomToFit(1500, 100);

  const jumpToNode = (node: any) => {
    if (node && node.x !== undefined) {
      const dist = 80, ratio = 1 + dist / Math.hypot(node.x, node.y, node.z);
      fgRef.current?.cameraPosition({ x: node.x * ratio, y: node.y * ratio, z: node.z * ratio }, node, 1500);
      setSelectedNode(node);
    }
  };

  const handleNodeThreeObject = (node: any) => {
    const group = new THREE.Group();
    const isHighDensity = graphData.nodes.length > 2000;
    if ((node.type === "package" || node.type === "folder") && !isHighDensity) {
      const c = node.type === "package" ? "#06b6d4" : "#475569";
      const radius = Math.max(12, Math.sqrt((folderDescendants.get(node.id) || []).length) * 8);
      const sphere = new THREE.Mesh(new THREE.SphereGeometry(radius, 16, 16), new THREE.MeshBasicMaterial({ color: new THREE.Color(c), transparent: true, opacity: 0.035, depthWrite: false }));
      group.add(sphere);
    }
    const isMatch = searchQuery.trim() && node.name.toLowerCase().includes(searchQuery.toLowerCase().trim());
    const isSel = selectedNode?.id === node.id;
    if (isMatch || isSel || (!isHighDensity && (node.type === "package" || (node.type === "folder" && !(node.path || "").includes("/"))))) {
      const canvas = document.createElement("canvas");
      canvas.width = 300; canvas.height = 80;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "rgba(7, 8, 11, 0.82)";
      ctx.strokeStyle = isSel ? "#34d399" : (isMatch ? "#06b6d4" : "rgba(255, 255, 255, 0.12)");
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.roundRect(5, 5, 290, 70, 12); ctx.fill(); ctx.stroke();
      ctx.font = "bold 24px monospace"; ctx.fillStyle = isSel ? "#34d399" : "#ffffff"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(node.name, 150, 40);
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), depthWrite: false }));
      sprite.scale.set(40, 10.6, 1); sprite.position.y = node.val + 8;
      group.add(sprite);
    }
    return group;
  };

  const getNodeColor = (node: any) => {
    const map: any = { package: "#06b6d4", folder: "#475569", file: "#818cf8", class: "#fbbf24", function: "#34d399", external: "#f43f5e", chunk: "#94a3b8" };
    const hex = map[node.type] || "#94a3b8";
    if (highlightedNodes.size > 0 && !highlightedNodes.has(node.id)) {
      const [r, g, b] = [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
      return `rgba(${r}, ${g}, ${b}, 0.15)`;
    }
    return hex;
  };

  const getLinkColor = (link: any) => {
    const sId = typeof link.source === 'object' ? link.source.id : link.source;
    const tId = typeof link.target === 'object' ? link.target.id : link.target;
    const isHighlighted = highlightedNodes.size === 0 || (highlightedNodes.has(sId) && highlightedNodes.has(tId));
    const op = isHighlighted ? 1 : 0.08;
    if (link.type === "contains") return `rgba(255, 255, 255, ${0.04 * op})`;
    const weight = link.weight || 1;
    const base = weight >= 5 ? 0.8 : (weight >= 3 ? 0.45 : 0.2);
    return link.isCyclic ? `rgba(239, 68, 68, ${0.8 * op})` : `rgba(99, 102, 241, ${base * op})`;
  };

  const getLinkWidth = (link: any) => {
    const sId = typeof link.source === 'object' ? link.source.id : link.source;
    const tId = typeof link.target === 'object' ? link.target.id : link.target;
    if (highlightedNodes.size > 0 && !(highlightedNodes.has(sId) && highlightedNodes.has(tId))) return 0.1;
    if (link.type === "contains") return 0.4;
    const w = link.weight || 1;
    return w >= 5 ? 3.5 : (w >= 3 ? 2.0 : 0.8);
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-w-[95vw] h-[95vh] bg-gray-900 border border-white/10 rounded-3xl shadow-2xl flex flex-col overflow-hidden relative">
        <div className="p-4 border-b border-white/10 flex items-center justify-between bg-black/40 absolute top-0 left-0 right-0 z-10 backdrop-blur-md">
          <div className="flex items-center gap-2">
            <Network className="w-5 h-5 text-emerald-500" />
            <h3 className="text-sm font-bold text-gray-200 font-mono">3D Codebase Architecture Explorer</h3>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-white/10 rounded-lg text-gray-400"><X className="w-5 h-5" /></button>
        </div>
        {!loading && !error && (
          isPanelExpanded ? (
            <div className="absolute top-20 left-4 z-20 w-80 bg-black/85 border border-white/10 rounded-2xl p-4 backdrop-blur-md flex flex-col gap-4 max-h-[85vh] overflow-y-auto shadow-2xl">
              <div className="flex items-center justify-between border-b border-white/5 pb-2">
                <div className="flex items-center gap-2 text-gray-200 font-semibold text-xs font-mono">Dashboard</div>
                <button onClick={() => setIsPanelExpanded(false)} className="p-1 hover:bg-white/10 rounded"><ChevronLeft className="w-4 h-4" /></button>
              </div>
              <div className="flex flex-col gap-2">
                <label className="text-[10px] font-bold text-gray-400 font-mono">VIEW MODE</label>
                <div className="flex gap-2">
                  <button onClick={() => setIsArchView(true)} className={`flex-1 py-1 px-2 rounded-lg text-[10px] font-bold border ${isArchView ? "bg-emerald-500 text-black" : "bg-white/5 border-white/10 text-gray-300"}`}>ARCH</button>
                  <button onClick={() => setIsArchView(false)} className={`flex-1 py-1 px-2 rounded-lg text-[10px] font-bold border ${!isArchView ? "bg-emerald-500 text-black" : "bg-white/5 border-white/10 text-gray-300"}`}>EXPLORE</button>
                </div>
              </div>
              <form onSubmit={(e) => { e.preventDefault(); setSearchQuery(searchVal); }} className="flex gap-1">
                <input type="text" value={searchVal} onChange={(e) => setSearchVal(e.target.value)} className="flex-1 px-3 py-1 bg-white/5 border border-white/10 rounded-lg text-xs text-white" />
                <button type="submit" className="px-2 bg-emerald-500/20 text-emerald-500 rounded-lg"><Search className="w-4 h-4" /></button>
              </form>
              {selectedNode && (
                <div className="bg-white/5 border border-white/10 rounded-xl p-3 text-[10px] text-gray-300">
                  <div className="font-bold text-white mb-1">{selectedNode.name}</div>
                  <div className="text-emerald-500 mb-2">{selectedNode.type}</div>
                  <button onClick={() => setIsChainFocus(!isChainFocus)} className="bg-white/10 w-full py-1 rounded">Focus Chain</button>
                </div>
              )}
            </div>
          ) : (
            <button onClick={() => setIsPanelExpanded(true)} className="absolute top-20 left-4 z-20 p-3 bg-black/80 border border-white/10 rounded-2xl"><ChevronRight className="w-5 h-5" /></button>
          )
        )}
        <div className="flex-1 w-full h-full bg-[#07080b]">
          {!loading && !error && (
            <ForceGraph3D
              ref={fgRef}
              graphData={{ nodes: nodesForDisplay, links: filteredData.links }}
              nodeThreeObject={handleNodeThreeObject}
              nodeThreeObjectExtend={true}
              nodeColor={getNodeColor}
              nodeLabel={(node: any) => {
                const stats = (node.type === "folder" || node.type === "package") ? getFolderStats(node.id) : null;
                return `<div style="background: rgba(11,12,16,0.9); padding: 8px; border-radius: 8px; font-family: monospace; font-size: 10px;">${node.name}<br/>${stats ? `Files: ${stats.files}` : ""}</div>`;
              }}
              linkColor={getLinkColor}
              linkWidth={getLinkWidth}
              backgroundColor="#07080b"
              onNodeClick={(node: any) => {
                const now = Date.now();
                if (lastClickRef.current && node.id === lastClickRef.current.nodeId && (now - lastClickRef.current.time) < 300) {
                  handleNodeDoubleClick(node);
                } else {
                  setSelectedNode(node);
                  setIsChainFocus(false);
                }
                lastClickRef.current = { nodeId: node.id, time: now };
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
};
