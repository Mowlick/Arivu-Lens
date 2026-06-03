import React, { useState, useEffect } from "react";
import { FolderOpen, UploadCloud, CheckCircle2, XCircle, Loader2, Database, Trash2 } from "lucide-react";

const API_BASE = "http://localhost:8000/api";

interface ConfigPanelProps {
  onIngestSuccess: (files: string[]) => void;
  onClear: () => void;
  indexedFilesCount: number;
}

export const ConfigPanel: React.FC<ConfigPanelProps> = ({ onIngestSuccess, onClear, indexedFilesCount }) => {
  const [dirPath, setDirPath] = useState("");
  const [loading, setLoading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);
  const [health, setHealth] = useState<{
    ollama_connection: string;
    llm_model: string;
    embedding_model: string;
  } | null>(null);

  const fetchHealth = async () => {
    try {
      const res = await fetch(`${API_BASE}/health`);
      if (res.ok) {
        const data = await res.json();
        setHealth(data);
      } else {
        setHealth(null);
      }
    } catch {
      setHealth(null);
    }
  };

  useEffect(() => {
    fetchHealth();
    const interval = setInterval(fetchHealth, 10000);
    return () => clearInterval(interval);
  }, []);

  const handleLocalIngest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dirPath.trim()) return;

    setLoading(true);
    setUploadProgress("Analyzing directory structure...");
    try {
      const res = await fetch(`${API_BASE}/ingest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ directory_path: dirPath }),
      });
      const data = await res.json();
      if (res.ok) {
        onIngestSuccess(data.files || []);
        setUploadProgress(`Success! Ingested ${data.files_count} files.`);
      } else {
        alert(data.detail || "Ingestion failed.");
        setUploadProgress(null);
      }
    } catch (err) {
      alert("Error contacting the backend server. Make sure FastAPI is running on port 8000.");
      setUploadProgress(null);
    } finally {
      setLoading(false);
    }
  };

  const handleZipUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoading(true);
    setUploadProgress("Extracting & Indexing ZIP archive...");
    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch(`${API_BASE}/ingest-zip`, {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (res.ok) {
        onIngestSuccess(data.files || []);
        setUploadProgress(`Success! Ingested ${data.files_count} files from ZIP.`);
      } else {
        alert(data.detail || "ZIP upload failed.");
        setUploadProgress(null);
      }
    } catch (err) {
      alert("Error ingesting ZIP.");
      setUploadProgress(null);
    } finally {
      setLoading(false);
    }
  };

  const handleClearDb = async () => {
    if (!window.confirm("Are you sure you want to wipe the local vector database store?")) return;
    try {
      const res = await fetch(`${API_BASE}/clear`, { method: "POST" });
      if (res.ok) {
        onClear();
        setUploadProgress("Database successfully cleared.");
      }
    } catch {
      alert("Error clearing vector store.");
    }
  };

  return (
    <div className="flex flex-col gap-5 p-5 border-b border-darkBorder bg-darkBg/60 backdrop-blur-md">
      {/* Title block */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Database className="w-5 h-5 text-arivuIndigo" />
          <h2 className="text-base font-semibold tracking-wide">Workspace Ingestion</h2>
        </div>
        
        {/* Health status indicator */}
        <div className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border border-darkBorder bg-darkPanel">
          <span className={`w-2 h-2 rounded-full ${health?.ollama_connection === "online" ? "bg-arivuEmerald animate-pulse" : "bg-red-500"}`}></span>
          <span className="text-gray-400 font-mono">Ollama: {health?.ollama_connection || "offline"}</span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Option A: Path ingest */}
        <form onSubmit={handleLocalIngest} className="flex flex-col gap-2 p-4 rounded-xl border border-darkBorder bg-darkPanel/50">
          <label className="text-xs font-medium text-gray-400 flex items-center gap-1.5">
            <FolderOpen className="w-3.5 h-3.5 text-arivuIndigo" /> Local Absolute Directory Path
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="e.g. C:\Projects\MyRepo"
              value={dirPath}
              onChange={(e) => setDirPath(e.target.value)}
              disabled={loading}
              className="flex-1 text-sm bg-darkBg/80 border border-darkBorder hover:border-arivuIndigo/40 focus:border-arivuIndigo focus:ring-1 focus:ring-arivuIndigo focus:outline-none rounded-lg px-3 py-2 text-gray-200 transition font-mono placeholder:text-gray-600"
            />
            <button
              type="submit"
              disabled={loading || !dirPath.trim()}
              className="bg-arivuIndigo hover:bg-arivuIndigo-dark disabled:opacity-40 disabled:hover:bg-arivuIndigo text-sm font-medium px-4 py-2 rounded-lg text-white transition flex items-center gap-1.5 shadow-indigoGlow"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Index"}
            </button>
          </div>
        </form>

        {/* Option B: ZIP Upload */}
        <div className="flex flex-col gap-2 p-4 rounded-xl border border-darkBorder bg-darkPanel/50 justify-between">
          <div className="flex justify-between items-center">
            <label className="text-xs font-medium text-gray-400 flex items-center gap-1.5">
              <UploadCloud className="w-3.5 h-3.5 text-arivuEmerald" /> Upload Codebase .zip
            </label>
            {indexedFilesCount > 0 && (
              <button
                onClick={handleClearDb}
                className="text-xs text-red-400 hover:text-red-300 flex items-center gap-1 px-2 py-1 rounded hover:bg-red-500/10 transition font-mono"
              >
                <Trash2 className="w-3 h-3" /> Clear DB
              </button>
            )}
          </div>
          
          <div className="relative border border-dashed border-darkBorder hover:border-arivuEmerald/50 rounded-lg py-2 px-3 text-center transition cursor-pointer bg-darkBg/30 flex items-center justify-center gap-2">
            <input
              type="file"
              accept=".zip"
              disabled={loading}
              onChange={handleZipUpload}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed"
            />
            <UploadCloud className="w-4 h-4 text-arivuEmerald" />
            <span className="text-sm text-gray-400 font-medium">Select .zip archive</span>
          </div>
        </div>
      </div>

      {/* Progress & Diagnostics status block */}
      {uploadProgress && (
        <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-darkBorder bg-darkPanel/40 text-xs font-mono text-gray-300">
          {loading ? (
            <Loader2 className="w-4 h-4 text-arivuIndigo animate-spin" />
          ) : uploadProgress.includes("failed") ? (
            <XCircle className="w-4 h-4 text-red-500" />
          ) : (
            <CheckCircle2 className="w-4 h-4 text-arivuEmerald" />
          )}
          <span>{uploadProgress}</span>
        </div>
      )}

      {/* Mini Diagnostic readout */}
      {health && (
        <div className="grid grid-cols-2 gap-4 text-[10px] font-mono text-gray-500 border-t border-darkBorder/40 pt-3">
          <div>
            <span>LLM: </span>
            <span className="text-gray-400">{health.llm_model}</span>
          </div>
          <div>
            <span>Embed: </span>
            <span className="text-gray-400">{health.embedding_model}</span>
          </div>
        </div>
      )}
    </div>
  );
};
