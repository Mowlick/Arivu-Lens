import React, { useEffect, useState, useMemo, useRef, useCallback } from "react";
import {
  X, Network, Search, ChevronLeft, ChevronRight, RotateCcw,
  Package, Folder, FileCode, Box, Zap, Globe, Link2, ArrowRight, AlertTriangle
} from "lucide-react";
import ForceGraph3D from "react-force-graph-3d";
import { forceCollide } from "d3-force-3d";
import * as THREE from "three";

// ─── Types ───────────────────────────────────────────────────────────────────
interface GraphModalProps {
  apiBase: string;
  onClose: () => void;
}

// ─── Color palette ───────────────────────────────────────────────────────────
const NODE_COLORS: Record<string, string> = {
  package:  "#06b6d4",   // cyan
  folder:   "#818cf8",   // indigo
  file:     "#a78bfa",   // violet
  class:    "#fbbf24",   // amber
  function: "#34d399",   // emerald
  external: "#f87171",   // red
  chunk:    "#94a3b8",   // slate
};

const LINK_COLORS: Record<string, string> = {
  contains:    "rgba(255,255,255,0.06)",
  import:      "#06b6d4",
  call:        "#34d399",
  inheritance: "#fbbf24",
  reference:   "#94a3b8",
  cyclic:      "#ef4444",
};

const NODE_LABELS: Record<string, string> = {
  package:  "Package",
  folder:   "Folder",
  file:     "File",
  class:    "Class",
  function: "Function",
  external: "External",
  chunk:    "Chunk",
};

// ─── Main Component ───────────────────────────────────────────────────────────
export const GraphModal: React.FC<GraphModalProps> = ({ apiBase, onClose }) => {
  const [graphData, setGraphData]           = useState<{ nodes: any[]; links: any[] }>({ nodes: [], links: [] });
  const [loading, setLoading]               = useState(true);
  const [error, setError]                   = useState<string | null>(null);
  const fgRef                               = useRef<any>(null);
  const [isPanelExpanded, setIsPanelExpanded] = useState(true);
  const [searchVal, setSearchVal]           = useState("");
  const [searchQuery, setSearchQuery]       = useState("");
  const [isArchView, setIsArchView]         = useState(false);
  const [selectedNode, setSelectedNode]     = useState<any>(null);
  const [isChainFocus, setIsChainFocus]     = useState(false);
  const [hoveredNode, setHoveredNode]       = useState<any>(null);
  const lastClickRef                        = useRef<{ nodeId: string; time: number } | null>(null);

  const [visibleLayers, setVisibleLayers] = useState({
    packages: true, folders: true, files: true,
    classes: true, functions: true, dependencies: true,
  });

  const [visibleRelations, setVisibleRelations] = useState({
    imports: true, calls: true, inheritance: true, references: false,
  });

  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set());

  // ── Fetch graph data ────────────────────────────────────────────────────────
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
              if (n.type === "package")               n.val = 12;
              else if (n.type === "folder")           n.val = 8;
              else if (n.type === "file")             n.val = 5;
              else if (n.type === "class")            n.val = 4;
              else if (n.type === "function")         n.val = 2.5;
              else                                    n.val = 1.5;
            }
            n.connections = 0;
          });
          setGraphData(data);
          if (data.nodes.length > 2000) setIsArchView(true);
        } else {
          throw new Error("Invalid graph data format");
        }
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };
    fetchGraph();
  }, [apiBase]);

  // ── Maps & helpers ──────────────────────────────────────────────────────────
  const nodesMap = useMemo(() => {
    const m = new Map<string, any>();
    graphData.nodes.forEach((n: any) => m.set(n.id, n));
    return m;
  }, [graphData.nodes]);

  const folderDescendants = useMemo(() => {
    const desc = new Map<string, string[]>();
    graphData.nodes.forEach((n: any) => {
      if (n.type !== "folder" && n.type !== "package") {
        const norm = (n.path || "").replace(/\\/g, "/");
        const parts = norm.split("/");
        for (let i = 1; i < parts.length; i++) {
          const fp = parts.slice(0, i).join("/");
          if (!desc.has(fp)) desc.set(fp, []);
          desc.get(fp)!.push(n.id);
        }
      }
    });
    return desc;
  }, [graphData.nodes]);

  const getFolderStats = (folderId: string) => {
    const ids = folderDescendants.get(folderId) || [];
    let files = 0, classes = 0, funcs = 0;
    ids.forEach((id) => {
      const n = nodesMap.get(id);
      if (!n) return;
      if (n.type === "file") files++;
      else if (n.type === "class") classes++;
      else if (n.type === "function" || n.type === "chunk") funcs++;
    });
    return { files, classes, functions: funcs };
  };

  // ── Active layers (arch vs explore) ─────────────────────────────────────────
  const activeLayers = useMemo(
    () => isArchView
      ? { packages: true, folders: true, files: false, classes: false, functions: false, dependencies: true }
      : visibleLayers,
    [isArchView, visibleLayers]
  );

  // ── Filtered data ───────────────────────────────────────────────────────────
  const filteredData = useMemo(() => {
    const nodes = graphData.nodes.filter((node: any) => {
      if (node.type === "package"  && !activeLayers.packages)     return false;
      if (node.type === "folder"   && !activeLayers.folders)      return false;
      if (node.type === "file"     && !activeLayers.files)        return false;
      if (node.type === "class"    && !activeLayers.classes)      return false;
      if (node.type === "function" && !activeLayers.functions)    return false;
      if (node.type === "external" && !activeLayers.dependencies) return false;
      if (node.type === "chunk"    && !activeLayers.classes && !activeLayers.functions) return false;

      const p = (node.path || "").replace(/\\/g, "/");
      if (p && p !== "External Dependency") {
        const parts = p.split("/");
        const isFolderOrPkg = node.type === "folder" || node.type === "package";
        const limit = isFolderOrPkg ? parts.length - 1 : parts.length;
        for (let i = 1; i <= limit; i++) {
          if (collapsedFolders.has(parts.slice(0, i).join("/"))) return false;
        }
      }
      return true;
    });

    const nodeIds = new Set(nodes.map((n: any) => n.id));
    const links = graphData.links.filter((l: any) => {
      const sId = typeof l.source === "object" ? l.source.id : l.source;
      const tId = typeof l.target === "object" ? l.target.id : l.target;
      if (!nodeIds.has(sId) || !nodeIds.has(tId)) return false;
      if (l.type === "depends_on") {
        if (l.relation === "import"      && !visibleRelations.imports)     return false;
        if (l.relation === "call"        && !visibleRelations.calls)       return false;
        if (l.relation === "inheritance" && !visibleRelations.inheritance) return false;
        if (l.relation === "reference"   && !visibleRelations.references)  return false;
      }
      return true;
    });
    return { nodes, links };
  }, [graphData, activeLayers, visibleRelations, collapsedFolders]);

  // ── Enrich nodes with connection counts ─────────────────────────────────────
  const nodesForDisplay = useMemo(() => {
    const counts: Record<string, number> = {};
    filteredData.links.forEach((l: any) => {
      const sId = typeof l.source === "object" ? l.source.id : l.source;
      const tId = typeof l.target === "object" ? l.target.id : l.target;
      counts[sId] = (counts[sId] || 0) + 1;
      counts[tId] = (counts[tId] || 0) + 1;
    });
    return filteredData.nodes.map((n: any) => ({
      ...n,
      connections: counts[n.id] || 0,
      val: (n.val || 1.5) + (counts[n.id] || 0) * 0.3,
    }));
  }, [filteredData]);

  // ── Dependency chain ─────────────────────────────────────────────────────────
  const dependencyChain = useMemo(() => {
    if (!selectedNode || !isChainFocus) return new Set<string>();
    const targetId = selectedNode.id;
    const downstream = new Set<string>([targetId]);
    let q = [targetId];
    while (q.length > 0) {
      const curr = q.shift()!;
      graphData.links.forEach((l: any) => {
        const sId = typeof l.source === "object" ? l.source.id : l.source;
        const tId = typeof l.target === "object" ? l.target.id : l.target;
        if (sId === curr && !downstream.has(tId)) { downstream.add(tId); q.push(tId); }
      });
    }
    const upstream = new Set<string>([targetId]);
    q = [targetId];
    while (q.length > 0) {
      const curr = q.shift()!;
      graphData.links.forEach((l: any) => {
        const sId = typeof l.source === "object" ? l.source.id : l.source;
        const tId = typeof l.target === "object" ? l.target.id : l.target;
        if (tId === curr && !upstream.has(sId)) { upstream.add(sId); q.push(sId); }
      });
    }
    return new Set([...downstream, ...upstream]);
  }, [selectedNode, isChainFocus, graphData]);

  // ── Search highlight ─────────────────────────────────────────────────────────
  const searchNeighbors = useMemo(() => {
    if (!searchQuery.trim()) return new Set<string>();
    const q = searchQuery.toLowerCase();
    const matched = nodesForDisplay.find((n: any) => n.name.toLowerCase().includes(q));
    if (!matched) return new Set<string>();
    const nb = new Set<string>([matched.id]);
    filteredData.links.forEach((l: any) => {
      const sId = typeof l.source === "object" ? l.source.id : l.source;
      const tId = typeof l.target === "object" ? l.target.id : l.target;
      if (sId === matched.id) nb.add(tId);
      if (tId === matched.id) nb.add(sId);
    });
    return nb;
  }, [searchQuery, nodesForDisplay, filteredData.links]);

  const highlightedNodes = useMemo(
    () => (selectedNode && isChainFocus) ? dependencyChain : searchNeighbors,
    [selectedNode, isChainFocus, dependencyChain, searchNeighbors]
  );

  // ── Selected node links ──────────────────────────────────────────────────────
  const selectedNodeLinks = useMemo(() => {
    if (!selectedNode) return { dependents: [], dependencies: [] };
    const depOuts = new Set<string>(), depIns = new Set<string>();
    filteredData.links.forEach((l: any) => {
      const sId = typeof l.source === "object" ? l.source.id : l.source;
      const tId = typeof l.target === "object" ? l.target.id : l.target;
      if (sId === selectedNode.id) { const n = nodesMap.get(tId); if (n) depOuts.add(n.name); }
      if (tId === selectedNode.id) { const n = nodesMap.get(sId); if (n) depIns.add(n.name); }
    });
    return { dependents: Array.from(depIns), dependencies: Array.from(depOuts) };
  }, [selectedNode, filteredData.links, nodesMap]);

  // ── Repo metrics ─────────────────────────────────────────────────────────────
  const repoMetrics = useMemo(() => {
    if (!graphData.nodes.length) return null;
    const counts = { packages: 0, folders: 0, files: 0, classes: 0, functions: 0, external: 0 };
    graphData.nodes.forEach((n: any) => {
      if (n.type in counts) (counts as any)[n.type]++;
    });
    const connCounts: Record<string, number> = {};
    graphData.links.forEach((l: any) => {
      if (l.type === "depends_on") {
        const s = typeof l.source === "object" ? l.source.id : l.source;
        const t = typeof l.target === "object" ? l.target.id : l.target;
        connCounts[s] = (connCounts[s] || 0) + 1;
        connCounts[t] = (connCounts[t] || 0) + 1;
      }
    });
    let maxConn = -1, mostConnected = "None";
    graphData.nodes.forEach((n: any) => {
      if (n.type !== "package" && n.type !== "folder" && n.type !== "external") {
        const c = connCounts[n.id] || 0;
        if (c > maxConn) { maxConn = c; mostConnected = n.name; }
      }
    });
    const circular = graphData.links.filter((l: any) => l.isCyclic).length;
    return { ...counts, circular, mostConnected, totalLinks: graphData.links.length };
  }, [graphData]);

  // ── Force config ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (fgRef.current && nodesForDisplay.length > 0) {
      fgRef.current.d3Force("link").distance(120);
      fgRef.current.d3Force("charge").strength(-400);
      fgRef.current.d3Force("collide", forceCollide((n: any) => Math.cbrt(n.val || 1) * 10 + 5));
    }
  }, [nodesForDisplay]);

  // ── Handlers ──────────────────────────────────────────────────────────────────
  const resetCamera = () => fgRef.current?.zoomToFit(1500, 80);

  const jumpToNode = (node: any) => {
    if (node?.x !== undefined) {
      const dist = 120;
      const ratio = 1 + dist / Math.hypot(node.x, node.y, node.z || 1);
      fgRef.current?.cameraPosition(
        { x: node.x * ratio, y: node.y * ratio, z: (node.z || 0) * ratio },
        node, 1200
      );
      setSelectedNode(node);
    }
  };

  const handleNodeDoubleClick = (node: any) => {
    if (node.type === "folder" || node.type === "package") {
      setCollapsedFolders((prev) => {
        const next = new Set(prev);
        if (next.has(node.id)) next.delete(node.id); else next.add(node.id);
        return next;
      });
    }
  };

  // ── 3D Node Object ────────────────────────────────────────────────────────────
  const handleNodeThreeObject = useCallback((node: any) => {
    const group = new THREE.Group();
    const isHighDensity = graphData.nodes.length > 2000;
    const hex = NODE_COLORS[node.type] || "#94a3b8";
    const color = new THREE.Color(hex);
    const isSelected  = selectedNode?.id === node.id;
    const isHighlight = highlightedNodes.size === 0 || highlightedNodes.has(node.id);
    const isMatch     = searchQuery.trim() && node.name.toLowerCase().includes(searchQuery.toLowerCase());
    const opacity     = isHighlight ? 1.0 : 0.15;
    const radius      = Math.max(2, Math.cbrt(node.val || 1) * 4);

    // ── Geometry per type ─────────────────────────────────────────────────────
    // Initialize with a default so TypeScript infers the union type without
    // relying on THREE.BufferGeometry, which is not exported in r184 typings.
    const geo =
      node.type === "package"  ? new THREE.SphereGeometry(radius * 1.4, 32, 32)
    : node.type === "folder"   ? new THREE.CylinderGeometry(radius, radius, radius * 0.6, 6)
    : node.type === "file"     ? new THREE.CylinderGeometry(radius * 0.9, radius * 0.9, radius * 0.3, 32)
    : node.type === "class"    ? new THREE.BoxGeometry(radius * 1.6, radius * 1.6, radius * 1.6)
    : node.type === "function" ? new THREE.TetrahedronGeometry(radius * 1.3)
    : node.type === "external" ? new THREE.OctahedronGeometry(radius * 1.2)
    :                            new THREE.SphereGeometry(radius, 8, 8);

    const mat = new THREE.MeshPhongMaterial({
      color,
      emissive: color,
      emissiveIntensity: isSelected ? 0.9 : isMatch ? 0.6 : 0.3,
      transparent: true,
      opacity,
      shininess: 80,
    });
    group.add(new THREE.Mesh(geo, mat));

    // ── Glow ring on selected ─────────────────────────────────────────────────
    if (isSelected) {
      const ringGeo = new THREE.TorusGeometry(radius * 2.2, radius * 0.2, 8, 64);
      const ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color("#34d399"), transparent: true, opacity: 0.9 });
      group.add(new THREE.Mesh(ringGeo, ringMat));
    }

    // ── Cyclic warning ring ───────────────────────────────────────────────────
    const isCyclicNode = graphData.links.some((l: any) => {
      if (!l.isCyclic) return false;
      const s = typeof l.source === "object" ? l.source.id : l.source;
      const t = typeof l.target === "object" ? l.target.id : l.target;
      return s === node.id || t === node.id;
    });
    if (isCyclicNode) {
      const warnGeo = new THREE.TorusGeometry(radius * 2.6, radius * 0.15, 8, 64);
      const warnMat = new THREE.MeshBasicMaterial({ color: new THREE.Color("#ef4444"), transparent: true, opacity: 0.8 });
      group.add(new THREE.Mesh(warnGeo, warnMat));
    }

    // ── Folder halo ───────────────────────────────────────────────────────────
    if ((node.type === "package" || node.type === "folder") && !isHighDensity) {
      const haloR = Math.max(18, Math.sqrt((folderDescendants.get(node.id) || []).length) * 9);
      const haloGeo = new THREE.SphereGeometry(haloR, 16, 16);
      const haloMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.04 * opacity, depthWrite: false, side: THREE.BackSide });
      group.add(new THREE.Mesh(haloGeo, haloMat));
    }

    // ── Label ─────────────────────────────────────────────────────────────────
    const showLabel =
      isSelected || isMatch || node.type === "package" ||
      (!isHighDensity && (node.type === "folder" || node.type === "file"));

    if (showLabel) {
      const canvas = document.createElement("canvas");
      canvas.width = 512; canvas.height = 100;
      const ctx = canvas.getContext("2d")!;

      // Pill background
      ctx.fillStyle = "rgba(7,8,15,0.88)";
      ctx.strokeStyle = isSelected ? "#34d399" : isMatch ? "#06b6d4" : hex;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.roundRect(6, 6, 500, 88, 18);
      ctx.fill(); ctx.stroke();

      // Type badge
      ctx.fillStyle = hex + "33";
      ctx.beginPath();
      ctx.roundRect(14, 14, 100, 28, 8);
      ctx.fill();
      ctx.font = "bold 18px monospace";
      ctx.fillStyle = hex;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(NODE_LABELS[node.type] || node.type, 64, 28);

      // Node name
      ctx.font = "bold 28px 'Inter', monospace";
      ctx.fillStyle = isSelected ? "#34d399" : "#ffffff";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const name = node.name.length > 24 ? node.name.slice(0, 22) + "…" : node.name;
      ctx.fillText(name, 256, 66);

      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), depthWrite: false })
      );
      sprite.scale.set(52, 10, 1);
      sprite.position.y = radius * 2.8 + 6;
      group.add(sprite);
    }

    return group;
  }, [graphData.nodes, graphData.links, selectedNode, highlightedNodes, searchQuery, folderDescendants]);

  // ── Link colors ───────────────────────────────────────────────────────────────
  const getLinkColor = useCallback((link: any) => {
    const sId = typeof link.source === "object" ? link.source.id : link.source;
    const tId = typeof link.target === "object" ? link.target.id : link.target;
    const isLit = highlightedNodes.size === 0 || (highlightedNodes.has(sId) && highlightedNodes.has(tId));
    const dimFactor = isLit ? 1 : 0.08;

    if (link.type === "contains") {
      return `rgba(255,255,255,${0.08 * dimFactor})`;
    }
    if (link.isCyclic) return `rgba(239,68,68,${0.95 * dimFactor})`;

    const rel = link.relation || "reference";
    const baseColors: Record<string, [number, number, number, number]> = {
      import:      [6,   182, 212, 0.85],
      call:        [52,  211, 153, 0.75],
      inheritance: [251, 191, 36,  0.85],
      reference:   [148, 163, 184, 0.45],
    };
    const c = baseColors[rel] || baseColors.reference;
    return `rgba(${c[0]},${c[1]},${c[2]},${c[3] * dimFactor})`;
  }, [highlightedNodes]);

  const getLinkWidth = useCallback((link: any) => {
    const sId = typeof link.source === "object" ? link.source.id : link.source;
    const tId = typeof link.target === "object" ? link.target.id : link.target;
    if (highlightedNodes.size > 0 && !(highlightedNodes.has(sId) && highlightedNodes.has(tId))) return 0.2;
    if (link.type === "contains") return 0.6;
    const w = link.weight || 1;
    if (link.isCyclic) return 4;
    return w >= 5 ? 4.5 : w >= 3 ? 2.5 : 1.2;
  }, [highlightedNodes]);

  // ── Directional particles ─────────────────────────────────────────────────────
  const getLinkParticles = useCallback((link: any) => {
    if (link.type === "contains") return 0;
    const rel = link.relation || "";
    if (rel === "import" || rel === "inheritance") return 4;
    if (rel === "call") return 3;
    return 0;
  }, []);

  const getLinkParticleColor = useCallback((link: any) => {
    const rel = link.relation || "";
    if (rel === "import")      return "#06b6d4";
    if (rel === "call")        return "#34d399";
    if (rel === "inheritance") return "#fbbf24";
    return "#94a3b8";
  }, []);

  // ── Node layer counts ─────────────────────────────────────────────────────────
  const layerCounts = useMemo(() => {
    const c = { packages: 0, folders: 0, files: 0, classes: 0, functions: 0, dependencies: 0 };
    graphData.nodes.forEach((n: any) => {
      if (n.type === "package")  c.packages++;
      if (n.type === "folder")   c.folders++;
      if (n.type === "file")     c.files++;
      if (n.type === "class")    c.classes++;
      if (n.type === "function") c.functions++;
      if (n.type === "external") c.dependencies++;
    });
    return c;
  }, [graphData.nodes]);

  // ─── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-3 bg-black/85 backdrop-blur-sm">
      <div className="w-full max-w-[97vw] h-[96vh] bg-[#07080d] border border-white/10 rounded-3xl shadow-2xl flex flex-col overflow-hidden relative">

        {/* ── Top bar ── */}
        <div className="absolute top-0 left-0 right-0 z-10 px-5 py-3 border-b border-white/8 flex items-center justify-between bg-black/60 backdrop-blur-md">
          <div className="flex items-center gap-3">
            <Network className="w-5 h-5 text-emerald-400" />
            <h3 className="text-sm font-bold text-gray-100 tracking-wide font-mono">3D Codebase Architecture Explorer</h3>
            {repoMetrics && (
              <span className="hidden md:flex items-center gap-1.5 text-[10px] text-gray-500 font-mono ml-4">
                <span className="text-cyan-400">{repoMetrics.packages + repoMetrics.folders}</span> folders
                <span className="mx-1 opacity-30">·</span>
                <span className="text-violet-400">{repoMetrics.files}</span> files
                <span className="mx-1 opacity-30">·</span>
                <span className="text-amber-400">{repoMetrics.classes}</span> classes
                <span className="mx-1 opacity-30">·</span>
                <span className="text-emerald-400">{repoMetrics.functions}</span> functions
                {repoMetrics.circular > 0 && (
                  <><span className="mx-1 opacity-30">·</span><span className="text-red-400">{repoMetrics.circular} cyclic</span></>
                )}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={resetCamera} title="Reset camera" className="p-1.5 hover:bg-white/10 rounded-lg text-gray-400 hover:text-white transition-colors">
              <RotateCcw className="w-4 h-4" />
            </button>
            <button onClick={onClose} className="p-1.5 hover:bg-white/10 rounded-lg text-gray-400 hover:text-white transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* ── Side Panel ── */}
        {!loading && !error && (
          isPanelExpanded ? (
            <div className="absolute top-14 left-4 z-20 w-72 bg-[#0b0c14]/92 border border-white/10 rounded-2xl backdrop-blur-xl flex flex-col gap-0 max-h-[88vh] overflow-y-auto shadow-2xl divide-y divide-white/5">

              {/* Panel header */}
              <div className="flex items-center justify-between px-4 py-3">
                <span className="text-xs font-bold text-gray-300 tracking-wider font-mono uppercase">Dashboard</span>
                <button onClick={() => setIsPanelExpanded(false)} className="p-1 hover:bg-white/10 rounded transition-colors">
                  <ChevronLeft className="w-4 h-4 text-gray-400" />
                </button>
              </div>

              {/* View mode */}
              <div className="px-4 py-3 flex flex-col gap-2">
                <label className="text-[10px] font-bold text-gray-500 font-mono uppercase tracking-widest">View Mode</label>
                <div className="flex gap-2">
                  <button
                    onClick={() => setIsArchView(true)}
                    className={`flex-1 py-1.5 rounded-lg text-[11px] font-bold transition-all ${isArchView ? "bg-emerald-500 text-black shadow-lg shadow-emerald-500/30" : "bg-white/5 border border-white/10 text-gray-400 hover:bg-white/10"}`}
                  >ARCH</button>
                  <button
                    onClick={() => setIsArchView(false)}
                    className={`flex-1 py-1.5 rounded-lg text-[11px] font-bold transition-all ${!isArchView ? "bg-emerald-500 text-black shadow-lg shadow-emerald-500/30" : "bg-white/5 border border-white/10 text-gray-400 hover:bg-white/10"}`}
                  >EXPLORE</button>
                </div>
              </div>

              {/* Search */}
              <div className="px-4 py-3">
                <form onSubmit={(e) => { e.preventDefault(); setSearchQuery(searchVal); }} className="flex gap-1.5">
                  <input
                    type="text" value={searchVal}
                    onChange={(e) => { setSearchVal(e.target.value); if (!e.target.value) setSearchQuery(""); }}
                    placeholder="Search nodes…"
                    className="flex-1 px-3 py-1.5 bg-white/5 border border-white/10 rounded-lg text-xs text-white placeholder-gray-600 focus:outline-none focus:border-emerald-500/50 focus:bg-white/8 transition-all"
                  />
                  <button type="submit" className="px-2.5 bg-emerald-500/20 text-emerald-400 rounded-lg hover:bg-emerald-500/30 transition-colors">
                    <Search className="w-4 h-4" />
                  </button>
                </form>
              </div>

              {/* Legend */}
              <div className="px-4 py-3 flex flex-col gap-2">
                <label className="text-[10px] font-bold text-gray-500 font-mono uppercase tracking-widest">Node Types</label>
                <div className="grid grid-cols-2 gap-1.5">
                  {[
                    { type: "package",  label: "Package",  icon: <Package  className="w-3 h-3" /> },
                    { type: "folder",   label: "Folder",   icon: <Folder   className="w-3 h-3" /> },
                    { type: "file",     label: "File",     icon: <FileCode className="w-3 h-3" /> },
                    { type: "class",    label: "Class",    icon: <Box      className="w-3 h-3" /> },
                    { type: "function", label: "Function", icon: <Zap      className="w-3 h-3" /> },
                    { type: "external", label: "External", icon: <Globe    className="w-3 h-3" /> },
                  ].map(({ type, label, icon }) => (
                    <div key={type} className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-white/3">
                      <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: NODE_COLORS[type] }} />
                      <span style={{ color: NODE_COLORS[type] }} className="mr-1">{icon}</span>
                      <span className="text-[10px] text-gray-400 font-mono">{label}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Link types legend */}
              <div className="px-4 py-3 flex flex-col gap-2">
                <label className="text-[10px] font-bold text-gray-500 font-mono uppercase tracking-widest">Link Types</label>
                <div className="flex flex-col gap-1">
                  {[
                    { rel: "import",      label: "Import",      color: LINK_COLORS.import },
                    { rel: "call",        label: "Function Call", color: LINK_COLORS.call },
                    { rel: "inheritance", label: "Inheritance",  color: LINK_COLORS.inheritance },
                    { rel: "cyclic",      label: "Cyclic Dep",   color: LINK_COLORS.cyclic },
                  ].map(({ rel, label, color }) => (
                    <div key={rel} className="flex items-center gap-2">
                      <div className="flex items-center gap-1 flex-1">
                        <div className="h-px flex-1 rounded" style={{ backgroundColor: color }} />
                        <ArrowRight className="w-2.5 h-2.5 flex-shrink-0" style={{ color }} />
                      </div>
                      <span className="text-[10px] text-gray-400 font-mono w-24">{label}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Layer toggles */}
              {!isArchView && (
                <div className="px-4 py-3 flex flex-col gap-2">
                  <label className="text-[10px] font-bold text-gray-500 font-mono uppercase tracking-widest">Layers</label>
                  <div className="flex flex-col gap-1">
                    {(Object.keys(visibleLayers) as Array<keyof typeof visibleLayers>).map((layer) => {
                      const countMap: Record<string, number> = {
                        packages: layerCounts.packages,
                        folders: layerCounts.folders,
                        files: layerCounts.files,
                        classes: layerCounts.classes,
                        functions: layerCounts.functions,
                        dependencies: layerCounts.dependencies,
                      };
                      const colorMap: Record<string, string> = {
                        packages: NODE_COLORS.package,
                        folders: NODE_COLORS.folder,
                        files: NODE_COLORS.file,
                        classes: NODE_COLORS.class,
                        functions: NODE_COLORS.function,
                        dependencies: NODE_COLORS.external,
                      };
                      return (
                        <button
                          key={layer}
                          onClick={() => setVisibleLayers((prev) => ({ ...prev, [layer]: !prev[layer] }))}
                          className={`flex items-center justify-between px-2 py-1 rounded-lg text-[10px] font-mono transition-all ${visibleLayers[layer] ? "bg-white/6 text-gray-200" : "bg-transparent text-gray-600"}`}
                        >
                          <div className="flex items-center gap-2">
                            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: visibleLayers[layer] ? colorMap[layer] : "#374151" }} />
                            <span className="capitalize">{layer}</span>
                          </div>
                          <span className="text-gray-600">{countMap[layer]}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Relation toggles */}
              {!isArchView && (
                <div className="px-4 py-3 flex flex-col gap-2">
                  <label className="text-[10px] font-bold text-gray-500 font-mono uppercase tracking-widest">Relations</label>
                  <div className="flex flex-col gap-1">
                    {(Object.keys(visibleRelations) as Array<keyof typeof visibleRelations>).map((rel) => {
                      const colorMap: Record<string, string> = {
                        imports:     LINK_COLORS.import,
                        calls:       LINK_COLORS.call,
                        inheritance: LINK_COLORS.inheritance,
                        references:  LINK_COLORS.reference,
                      };
                      return (
                        <button
                          key={rel}
                          onClick={() => setVisibleRelations((prev) => ({ ...prev, [rel]: !prev[rel] }))}
                          className={`flex items-center justify-between px-2 py-1 rounded-lg text-[10px] font-mono transition-all ${visibleRelations[rel] ? "bg-white/6 text-gray-200" : "bg-transparent text-gray-600"}`}
                        >
                          <div className="flex items-center gap-2">
                            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: visibleRelations[rel] ? colorMap[rel] : "#374151" }} />
                            <span className="capitalize">{rel}</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Selected node detail */}
              {selectedNode && (
                <div className="px-4 py-3 flex flex-col gap-2">
                  <label className="text-[10px] font-bold text-gray-500 font-mono uppercase tracking-widest">Selected Node</label>
                  <div className="bg-white/4 border border-white/8 rounded-xl p-3 flex flex-col gap-2">
                    <div className="flex items-start gap-2">
                      <div className="w-2.5 h-2.5 rounded-full mt-1 flex-shrink-0" style={{ backgroundColor: NODE_COLORS[selectedNode.type] || "#94a3b8" }} />
                      <div>
                        <div className="text-xs font-bold text-white leading-tight break-all">{selectedNode.name}</div>
                        <div className="text-[10px] mt-0.5 font-mono" style={{ color: NODE_COLORS[selectedNode.type] || "#94a3b8" }}>
                          {NODE_LABELS[selectedNode.type] || selectedNode.type}
                        </div>
                        {selectedNode.path && selectedNode.path !== "External Dependency" && (
                          <div className="text-[9px] text-gray-600 mt-0.5 break-all">{selectedNode.path}</div>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-1.5 text-[10px]">
                      <div className="bg-white/4 rounded-lg px-2 py-1.5 text-center">
                        <div className="text-gray-500 font-mono">Depends On</div>
                        <div className="text-emerald-400 font-bold">{selectedNodeLinks.dependencies.length}</div>
                      </div>
                      <div className="bg-white/4 rounded-lg px-2 py-1.5 text-center">
                        <div className="text-gray-500 font-mono">Depended By</div>
                        <div className="text-cyan-400 font-bold">{selectedNodeLinks.dependents.length}</div>
                      </div>
                    </div>

                    {selectedNodeLinks.dependencies.length > 0 && (
                      <div>
                        <div className="text-[9px] text-gray-600 font-mono mb-1">DEPENDS ON</div>
                        <div className="flex flex-wrap gap-1">
                          {selectedNodeLinks.dependencies.slice(0, 5).map((name) => (
                            <span key={name} className="text-[9px] px-1.5 py-0.5 bg-emerald-500/10 text-emerald-400 rounded font-mono">{name}</span>
                          ))}
                          {selectedNodeLinks.dependencies.length > 5 && (
                            <span className="text-[9px] text-gray-600">+{selectedNodeLinks.dependencies.length - 5} more</span>
                          )}
                        </div>
                      </div>
                    )}

                    {selectedNodeLinks.dependents.length > 0 && (
                      <div>
                        <div className="text-[9px] text-gray-600 font-mono mb-1">DEPENDED BY</div>
                        <div className="flex flex-wrap gap-1">
                          {selectedNodeLinks.dependents.slice(0, 5).map((name) => (
                            <span key={name} className="text-[9px] px-1.5 py-0.5 bg-cyan-500/10 text-cyan-400 rounded font-mono">{name}</span>
                          ))}
                          {selectedNodeLinks.dependents.length > 5 && (
                            <span className="text-[9px] text-gray-600">+{selectedNodeLinks.dependents.length - 5} more</span>
                          )}
                        </div>
                      </div>
                    )}

                    <button
                      onClick={() => setIsChainFocus((p) => !p)}
                      className={`w-full py-1.5 rounded-lg text-[10px] font-bold font-mono transition-all ${isChainFocus ? "bg-emerald-500 text-black" : "bg-white/8 text-gray-300 hover:bg-white/12"}`}
                    >
                      {isChainFocus ? "✓ Chain Focused" : "Focus Dependency Chain"}
                    </button>
                    <button
                      onClick={() => { setSelectedNode(null); setIsChainFocus(false); }}
                      className="w-full py-1 rounded-lg text-[10px] text-gray-600 hover:text-gray-400 transition-colors"
                    >Deselect</button>
                  </div>
                </div>
              )}

              {/* Metrics */}
              {repoMetrics && (
                <div className="px-4 py-3 flex flex-col gap-2">
                  <label className="text-[10px] font-bold text-gray-500 font-mono uppercase tracking-widest">Metrics</label>
                  <div className="grid grid-cols-2 gap-1.5 text-[10px]">
                    <div className="bg-white/3 rounded-lg px-2 py-1.5">
                      <div className="text-gray-600 font-mono text-[9px]">Total Links</div>
                      <div className="text-gray-200 font-bold">{repoMetrics.totalLinks}</div>
                    </div>
                    <div className="bg-white/3 rounded-lg px-2 py-1.5">
                      <div className="text-gray-600 font-mono text-[9px]">Cyclic Deps</div>
                      <div className={repoMetrics.circular > 0 ? "text-red-400 font-bold" : "text-gray-400 font-bold"}>{repoMetrics.circular}</div>
                    </div>
                  </div>
                  {repoMetrics.mostConnected !== "None" && (
                    <div className="bg-white/3 rounded-lg px-2 py-1.5 text-[10px]">
                      <div className="text-gray-600 font-mono text-[9px] mb-0.5">Most Connected</div>
                      <div className="text-amber-400 font-bold font-mono truncate">{repoMetrics.mostConnected}</div>
                    </div>
                  )}
                </div>
              )}

              {/* Keyboard hints */}
              <div className="px-4 py-3">
                <div className="flex flex-wrap gap-1.5 text-[9px] text-gray-600">
                  <span><kbd className="bg-white/8 px-1 py-0.5 rounded font-mono">Click</kbd> Select</span>
                  <span><kbd className="bg-white/8 px-1 py-0.5 rounded font-mono">2× Click</kbd> Collapse</span>
                  <span><kbd className="bg-white/8 px-1 py-0.5 rounded font-mono">Scroll</kbd> Zoom</span>
                  <span><kbd className="bg-white/8 px-1 py-0.5 rounded font-mono">Drag</kbd> Rotate</span>
                </div>
              </div>

            </div>
          ) : (
            <button
              onClick={() => setIsPanelExpanded(true)}
              className="absolute top-16 left-4 z-20 p-3 bg-[#0b0c14]/90 border border-white/10 rounded-2xl hover:bg-white/8 transition-colors"
              title="Open dashboard"
            >
              <ChevronRight className="w-5 h-5 text-gray-400" />
            </button>
          )
        )}

        {/* ── Graph canvas ── */}
        <div className="flex-1 w-full h-full" style={{ background: "radial-gradient(ellipse at center, #0a0c18 0%, #07080d 100%)" }}>
          {loading && (
            <div className="flex flex-col items-center justify-center h-full gap-4">
              <div className="w-12 h-12 border-2 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin" />
              <p className="text-gray-500 text-sm font-mono">Loading graph data…</p>
            </div>
          )}
          {error && (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-8">
              <AlertTriangle className="w-10 h-10 text-red-400" />
              <p className="text-red-400 font-mono text-sm">{error}</p>
            </div>
          )}
          {!loading && !error && (
            <ForceGraph3D
              ref={fgRef}
              graphData={{ nodes: nodesForDisplay, links: filteredData.links }}
              nodeThreeObject={handleNodeThreeObject}
              nodeThreeObjectExtend={true}
              nodeColor={(n: any) => {
                const hex = NODE_COLORS[n.type] || "#94a3b8";
                if (highlightedNodes.size > 0 && !highlightedNodes.has(n.id)) return `${hex}26`;
                return hex;
              }}
              nodeLabel={(node: any) => {
                const stats = (node.type === "folder" || node.type === "package") ? getFolderStats(node.id) : null;
                return `<div style="background:rgba(7,9,20,0.95);padding:8px 12px;border-radius:10px;font-family:monospace;font-size:11px;border:1px solid rgba(255,255,255,0.12);max-width:220px">
                  <span style="color:${NODE_COLORS[node.type] || "#94a3b8"};font-weight:bold">${NODE_LABELS[node.type] || node.type}</span>
                  <div style="color:#fff;font-weight:bold;margin-top:2px">${node.name}</div>
                  ${node.path && node.path !== "External Dependency" ? `<div style="color:#64748b;font-size:9px;margin-top:2px;word-break:break-all">${node.path}</div>` : ""}
                  ${stats ? `<div style="color:#64748b;margin-top:4px;font-size:9px">${stats.files} files · ${stats.classes} classes · ${stats.functions} functions</div>` : ""}
                  <div style="color:#64748b;margin-top:2px;font-size:9px">${node.connections || 0} connections</div>
                </div>`;
              }}
              linkColor={getLinkColor}
              linkWidth={getLinkWidth}
              linkDirectionalArrowLength={(link: any) => link.type === "depends_on" ? 6 : 0}
              linkDirectionalArrowRelPos={0.88}
              linkDirectionalArrowColor={getLinkColor}
              linkDirectionalParticles={getLinkParticles}
              linkDirectionalParticleWidth={2.5}
              linkDirectionalParticleSpeed={0.006}
              linkDirectionalParticleColor={getLinkParticleColor}
              linkCurvature={(link: any) => {
                const sId = typeof link.source === "object" ? link.source.id : link.source;
                const tId = typeof link.target === "object" ? link.target.id : link.target;
                return link.isCyclic && sId !== tId ? 0.3 : 0;
              }}
              backgroundColor="#00000000"
              onNodeClick={(node: any) => {
                const now = Date.now();
                if (lastClickRef.current && node.id === lastClickRef.current.nodeId && now - lastClickRef.current.time < 300) {
                  handleNodeDoubleClick(node);
                } else {
                  jumpToNode(node);
                  setIsChainFocus(false);
                }
                lastClickRef.current = { nodeId: node.id, time: now };
              }}
              onNodeHover={(node: any) => setHoveredNode(node)}
              onBackgroundClick={() => { setSelectedNode(null); setIsChainFocus(false); }}
            />
          )}
        </div>

        {/* ── Bottom status bar ── */}
        {!loading && !error && (
          <div className="absolute bottom-3 right-4 z-20 flex items-center gap-3 text-[10px] text-gray-600 font-mono">
            {hoveredNode && (
              <span className="bg-black/70 px-2 py-1 rounded-lg border border-white/8" style={{ color: NODE_COLORS[hoveredNode.type] || "#94a3b8" }}>
                {hoveredNode.name} <span className="text-gray-600">({hoveredNode.type})</span>
              </span>
            )}
            <span className="bg-black/70 px-2 py-1 rounded-lg border border-white/8">
              {nodesForDisplay.length} nodes · {filteredData.links.length} links
            </span>
          </div>
        )}

      </div>
    </div>
  );
};
