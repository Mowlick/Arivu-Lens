import React, { useEffect, useState } from "react";
import { X, Network } from "lucide-react";
import ForceGraph3D from "react-force-graph-3d";
import { forceCollide } from "d3-force-3d";

interface GraphModalProps {
  apiBase: string;
  onClose: () => void;
}

export const GraphModal: React.FC<GraphModalProps> = ({ apiBase, onClose }) => {
  const [graphData, setGraphData] = useState({ nodes: [], links: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const fgRef = React.useRef<any>(null);

  useEffect(() => {
    const fetchGraph = async () => {
      try {
        const res = await fetch(`${apiBase}/graph`);
        if (!res.ok) throw new Error("Failed to fetch graph data");
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        
        // Safety check to ensure graph structure
        if (data.nodes && data.links) {
           // Compute node degree for val sizing
           data.nodes.forEach((n: any) => n.val = 1);
           data.links.forEach((l: any) => {
              const s = data.nodes.find((n: any) => n.id === l.source);
              const t = data.nodes.find((n: any) => n.id === l.target);
              if (s) s.val += 1;
              if (t) t.val += 1;
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

  useEffect(() => {
    if (fgRef.current && graphData.nodes.length > 0) {
      fgRef.current.d3Force('link').distance(100);
      fgRef.current.d3Force('charge').strength(-200);
      fgRef.current.d3Force('collide', forceCollide((node: any) => Math.cbrt(node.val) * 8 + 2));
    }
  }, [graphData]);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-w-[90vw] h-[90vh] dark:bg-[#07080b] bg-gray-900 border dark:border-white/10 border-gray-800 rounded-3xl shadow-2xl flex flex-col overflow-hidden relative">
        <div className="p-4 border-b dark:border-white/10 border-gray-800 flex items-center justify-between bg-black/40 absolute top-0 left-0 right-0 z-10 backdrop-blur-md">
          <div className="flex items-center gap-2">
            <Network className="w-5 h-5 text-arivuEmerald" />
            <h3 className="text-sm font-bold text-gray-200 font-mono">3D Codebase Architecture</h3>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-white/10 rounded-lg transition text-gray-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 w-full h-full relative flex flex-col items-center justify-center bg-[#07080b]">
          {loading ? (
             <div className="animate-pulse text-arivuEmerald font-mono text-sm flex flex-col items-center gap-3">
               <Network className="w-8 h-8 opacity-50" />
               Building Neural Graph...
             </div>
          ) : error ? (
             <div className="text-red-400 font-mono text-sm bg-red-400/10 px-4 py-3 rounded-lg border border-red-400/20">
               Error: {error}
             </div>
          ) : (
            <ForceGraph3D
              ref={fgRef}
              graphData={graphData}
              nodeLabel={(node: any) => `
                <div style="background: rgba(11, 12, 16, 0.95); border: 1px solid rgba(255,255,255,0.1); padding: 8px 12px; border-radius: 8px; font-family: monospace; font-size: 11px; color: #e2e8f0; box-shadow: 0 4px 12px rgba(0,0,0,0.5);">
                  <strong style="color: #34d399; font-size: 13px;">${node.name}</strong><br/>
                  <span style="color: #94a3b8; font-size: 10px;">${node.path}</span><br/>
                  <span style="color: #64748b; font-size: 10px;">Connections: ${node.val - 1}</span>
                </div>
              `}
              nodeAutoColorBy="group"
              nodeVal="val"
              linkColor={(link: any) => link.isCyclic ? 'rgba(255,0,0,0.8)' : 'rgba(255,255,255,0.2)'}
              linkDirectionalParticles={2}
              linkDirectionalParticleSpeed={() => 0.005}
              linkDirectionalParticleColor={(link: any) => link.isCyclic ? 'red' : '#04d9ff'}
              backgroundColor="#07080b"
              onNodeClick={(node: any) => {
                const distance = 40;
                const distRatio = 1 + distance/Math.hypot(node.x, node.y, node.z);
                if (fgRef.current) {
                  fgRef.current.cameraPosition(
                    { x: node.x * distRatio, y: node.y * distRatio, z: node.z * distRatio },
                    node,
                    1500
                  );
                }
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
};
