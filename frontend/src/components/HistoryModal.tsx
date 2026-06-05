import React, { useState, useEffect } from "react";
import { X, Clock, Database, FileCode2 } from "lucide-react";
import { API_BASE } from "../App";

interface HistoryEntry {
  timestamp: string;
  path: string;
  files_count: number;
  chunks_count: number;
}

interface HistoryModalProps {
  onClose: () => void;
}

export const HistoryModal: React.FC<HistoryModalProps> = ({ onClose }) => {
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API_BASE}/history`)
      .then((res) => {
        if (!res.ok) throw new Error("Failed to fetch history");
        return res.json();
      })
      .then((data) => {
        if (data && Array.isArray(data.history)) {
          setHistory(data.history);
        } else {
          setHistory([]);
        }
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-w-lg dark:bg-[#0c0d12] bg-white border dark:border-white/10 border-gray-200 rounded-2xl shadow-2xl flex flex-col overflow-hidden relative">
        <div className="p-4 border-b dark:border-white/10 border-gray-200 flex items-center justify-between bg-gray-50/50 dark:bg-white/[0.02]">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-arivuIndigo" />
            <h3 className="text-xs font-bold text-gray-800 dark:text-gray-200 font-mono">Ingestion History</h3>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-black/5 dark:hover:bg-white/10 rounded-lg transition text-gray-500">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 overflow-y-auto max-h-[60vh] flex flex-col gap-3">
          {loading ? (
            <p className="text-center text-xs font-mono text-gray-500 py-8">Loading history...</p>
          ) : error ? (
            <p className="text-center text-xs font-mono text-red-400 py-8">Error: {error}</p>
          ) : history.length === 0 ? (
            <p className="text-center text-xs font-mono text-gray-500 py-8">No ingestions found yet.</p>
          ) : (
            history.map((entry, idx) => (
              <div key={idx} className="p-3 rounded-xl border dark:border-white/5 border-gray-200 bg-gray-50/50 dark:bg-white/[0.02] flex flex-col gap-2">
                <div className="text-[10px] text-gray-500 font-mono">
                  {entry?.timestamp ? new Date(entry.timestamp).toLocaleString() : "Unknown date"}
                </div>
                <div className="text-xs font-mono font-medium text-gray-800 dark:text-gray-200 truncate">
                  {entry?.path || "Unknown path"}
                </div>
                <div className="flex items-center gap-3 text-[10px] font-mono text-gray-500 mt-1">
                  <span className="flex items-center gap-1"><FileCode2 className="w-3 h-3" /> {entry?.files_count || 0} files</span>
                  <span className="flex items-center gap-1"><Database className="w-3 h-3" /> {entry?.chunks_count || 0} chunks</span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
