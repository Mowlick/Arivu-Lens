import React, { useState, useEffect } from "react";
import { X, Copy, Check, FileCode2, Loader2 } from "lucide-react";

interface CodeViewerProps {
  filePath: string | null;
  onClose: () => void;
}

const API_BASE = "http://localhost:8000/api";

export const CodeViewer: React.FC<CodeViewerProps> = ({ filePath, onClose }) => {
  const [content, setContent] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);

  useEffect(() => {
    if (!filePath) return;

    const fetchContent = async () => {
      setLoading(true);
      try {
        const res = await fetch(`${API_BASE}/file-content?file_path=${encodeURIComponent(filePath)}`);
        if (res.ok) {
          const data = await res.json();
          setContent(data.content);
        } else {
          setContent("// Error: Could not load file contents.");
        }
      } catch (err) {
        setContent("// Error: Connection failed to backend.");
      } finally {
        setLoading(false);
      }
    };

    fetchContent();
  }, [filePath]);

  if (!filePath) return null;

  const handleCopy = async () => {
    await navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const extension = filePath.split(".").pop() || "txt";

  return (
    <div className="w-[450px] shrink-0 border-l border-darkBorder bg-darkBg/95 backdrop-blur-lg flex flex-col h-full z-20 arivu-glass shadow-indigoGlow animate-in slide-in-from-right duration-250">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-darkBorder bg-darkBg/60">
        <div className="flex items-center gap-2 text-xs font-mono font-medium text-gray-300 truncate pr-4">
          <FileCode2 className="w-4 h-4 text-arivuEmerald shrink-0" />
          <span className="truncate" title={filePath}>{filePath}</span>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <button
            onClick={handleCopy}
            disabled={loading}
            className="p-1.5 hover:text-white text-gray-400 rounded hover:bg-white/5 transition flex items-center gap-1 text-[10px] font-mono disabled:opacity-40"
          >
            {copied ? (
              <>
                <Check className="w-3.5 h-3.5 text-arivuEmerald" />
                <span className="text-arivuEmerald">Copied</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" />
                <span>Copy</span>
              </>
            )}
          </button>
          <button
            onClick={onClose}
            className="p-1 hover:text-white text-gray-400 rounded hover:bg-white/5 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Code viewport */}
      <div className="flex-1 overflow-auto p-4 bg-black/45 font-mono text-[11px] leading-relaxed text-gray-300">
        {loading ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-gray-500 font-mono text-xs">
            <Loader2 className="w-5 h-5 animate-spin text-arivuIndigo" />
            <span>Reading file from disk...</span>
          </div>
        ) : (
          <pre className="relative flex">
            {/* Row index counter column */}
            <div className="select-none pr-4 border-r border-white/5 text-right text-gray-600 font-mono">
              {content.split("\n").map((_, idx) => (
                <div key={idx}>{idx + 1}</div>
              ))}
            </div>
            {/* Source body */}
            <code className={`pl-4 overflow-x-auto block w-full whitespace-pre font-mono language-${extension}`}>
              {content}
            </code>
          </pre>
        )}
      </div>
    </div>
  );
};
