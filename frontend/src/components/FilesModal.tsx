import React, { useState } from "react";
import { X, FileCode2, Search } from "lucide-react";

interface FilesModalProps {
  files: string[];
  onSelectFile: (path: string) => void;
  onClose: () => void;
}

export const FilesModal: React.FC<FilesModalProps> = ({ files, onSelectFile, onClose }) => {
  const [query, setQuery] = useState("");

  const filtered = files.filter(f => f.toLowerCase().includes(query.toLowerCase()));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-w-lg dark:bg-[#0c0d12] bg-white border dark:border-white/10 border-gray-200 rounded-2xl shadow-2xl flex flex-col overflow-hidden h-[60vh]">
        <div className="p-4 border-b dark:border-white/10 border-gray-200 flex flex-col gap-3 bg-gray-50/50 dark:bg-white/[0.02]">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold text-gray-800 dark:text-gray-200 font-mono">Attach File Context</h3>
            <button onClick={onClose} className="p-1 hover:bg-black/5 dark:hover:bg-white/10 rounded-lg transition text-gray-500">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              autoFocus
              placeholder="Search files to attach..."
              value={query}
              onChange={e => setQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2 bg-white dark:bg-[#07080b] border border-gray-200 dark:border-white/5 rounded-lg text-xs font-mono focus:outline-none focus:border-arivuIndigo text-gray-800 dark:text-gray-200"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          {filtered.length === 0 ? (
            <p className="text-center text-xs font-mono text-gray-500 py-8">No files found.</p>
          ) : (
            filtered.map((f, i) => (
              <button
                key={i}
                onClick={() => { onSelectFile(f); onClose(); }}
                className="w-full flex items-center gap-2 p-2 hover:bg-black/5 dark:hover:bg-white/5 rounded-lg transition text-left"
              >
                <FileCode2 className="w-4 h-4 text-arivuEmerald shrink-0" />
                <span className="text-[11px] font-mono text-gray-700 dark:text-gray-300 truncate">{f}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
