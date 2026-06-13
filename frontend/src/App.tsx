import { useState, useEffect } from "react";
import { FileTree } from "./components/FileTree";
import { ChatArea } from "./components/ChatArea";
import { CodeViewer } from "./components/CodeViewer";
import { HistoryModal } from "./components/HistoryModal";
import { FilesModal } from "./components/FilesModal";
import { GraphModal } from "./components/GraphModal";
import { useNativeFS } from "./hooks/useNativeFS";
import { useNativeDragAndDrop } from "./hooks/useNativeDragAndDrop";
import { WebLLMRouter } from "./router/webllm_router";
import { useSession } from "./hooks/useSession";
import { 
  ShieldCheck, 
  Lock, 
  Database, 
  Cpu, 
  Layers, 
  Folder, 
  ChevronRight, 
  Paperclip, 
  Send, 
  Terminal, 
  Info, 
  Activity, 
  Compass,
  X,
  Loader2,
  CheckCircle2,
  FolderOpen,
  FileText,
  Network
} from "lucide-react";

export const API_BASE = "http://127.0.0.1:11411/api";

interface Source {
  file_path: string;
  file_name: string;
  start_line: number;
  end_line: number;
  language: string;
}

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: Source[];
  routing?: "local" | "server";
  attachedFiles?: string[];
}

function App() {
  const { isTauri, pickDirectory } = useNativeFS();
  const { isDragging } = useNativeDragAndDrop(async (path) => {
    await ingestDirectory(path);
  });

  // WebLLM Router State
  const [routerProgress, setRouterProgress] = useState<number | null>(null);
  const [routerState, setRouterState] = useState<"uninitialized" | "loading" | "ready" | "failed">("uninitialized");
  const [webLlmRouter, setWebLlmRouter] = useState<WebLLMRouter | null>(null);

  // Application Ingestion State
  const [files, setFiles] = useState<string[]>([]);
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [workspacePath, setWorkspacePath] = useState("");
  const [chunksCount, setChunksCount] = useState<number>(0);
  const [workspaceSizeKb, setWorkspaceSizeKb] = useState<number>(0);
  
  // Modals & UI States
  const [showIngestModal, setShowIngestModal] = useState(false);
  const [dirPath, setDirPath] = useState("");
  const [chatInput, setChatInput] = useState("");
  const [modalLoading, setModalLoading] = useState(false);
  const [modalProgress, setModalProgress] = useState<string | null>(null);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [showFilesModal, setShowFilesModal] = useState(false);
  const [showSearchModal, setShowSearchModal] = useState(false);
  const [showGraphModal, setShowGraphModal] = useState(false);
  const [ingestPhase, setIngestPhase] = useState<0 | 1 | 2 | 3>(0); // 0=idle, 1=AST, 2=Graph, 3=Vector
  const [activeTab, setActiveTab] = useState<"path" | "zip">("path");
  const [centerTab, setCenterTab] = useState<"chat" | "code">("chat");

  const [showMentionPopover, setShowMentionPopover] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [attachedFiles, setAttachedFiles] = useState<string[]>([]);

  const { sessionId, sessionsList, fetchSessions, createNewSession, loadSession, fetchSessionDetails } = useSession(workspacePath);

  useEffect(() => {
    document.documentElement.classList.add('dark');
  }, []);

  useEffect(() => {
    if (workspacePath) {
      fetchSessions();
    }
  }, [workspacePath, fetchSessions]);

  useEffect(() => {
    if (sessionId) {
      fetchSessionDetails(sessionId).then(session => {
        if (session && session.chat_history) {
          setMessages(session.chat_history.map((m: any, i: number) => ({
            id: Date.now().toString() + i,
            role: m.role,
            content: m.content,
            sources: m.sources,
            routing: "server"
          })));
        }
      });
    } else if (!sessionId && messages.length > 0) {
      setMessages([]);
    }
  }, [sessionId, fetchSessionDetails]);
  
  // Infrastructure Diagnostics State
  const [health, setHealth] = useState<{
    ollama_connection: string;
    llm_model: string;
    embedding_model: string;
  } | null>(null);
  
  const [chatStarters, setChatStarters] = useState<{title: string, desc: string}[]>([]);

  useEffect(() => {
    if (files.length > 0 && chatStarters.length === 0) {
      const fetchStarters = async () => {
        try {
          const res = await fetch(`${API_BASE}/chat`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              query: "Based on the codebase files, suggest exactly 4 extremely short, punchy chat start options (max 3-4 words for title) instead of long questions. Return ONLY a valid JSON array of objects with 'title' and 'desc'. Example: [{\"title\": \"Explain Architecture\", \"desc\": \"Context\"}]",
              n_results: 10,
              history: [],
              use_graph: false,
              session_id: null,
              attached_files: []
            })
          });
          if (!res.ok) return;
          const reader = res.body?.getReader();
          if (!reader) return;
          const decoder = new TextDecoder();
          let fullText = "";
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = decoder.decode(value, { stream: true });
            const lines = chunk.split("\n");
            for (const line of lines) {
              if (!line.trim()) continue;
              try {
                const parsed = JSON.parse(line);
                if (parsed.type === "content") {
                  fullText += parsed.text || "";
                }
              } catch (e) {}
            }
          }
          const match = fullText.match(/\[[\s\S]*\]/);
          if (match) {
            const arr = JSON.parse(match[0]);
            if (Array.isArray(arr) && arr.length >= 4) {
              setChatStarters(arr.slice(0, 4));
            }
          }
        } catch (e) {
          console.error("Starters error", e);
        }
      };
      fetchStarters();
    }
  }, [files, chatStarters.length]);
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



  const checkWorkspace = async () => {
    try {
      const res = await fetch(`${API_BASE}/workspace/restore`);
      if (res.ok) {
        const data = await res.json();
        if (data.path) {
          setWorkspacePath(data.path);
          setFiles(data.files || []);
          setChunksCount(data.chunks_count || 0);
          setWorkspaceSizeKb(Math.round((data.size_bytes || 0) / 1024));
          if (data.chat_history && data.chat_history.length > 0) {
            setMessages(data.chat_history.map((m: any, i: number) => ({
              id: Date.now().toString() + i,
              role: m.role,
              content: m.content,
              routing: "server",
              sources: []
            })));
          }
        }
      }
    } catch {}
  };

  useEffect(() => {
    fetchHealth();
    checkWorkspace();

    // Initialize WebLLM Router on load
    const initRouter = async () => {
      setRouterState("loading");
      const router = new WebLLMRouter();
      try {
        await router.initialize((report) => {
          setRouterProgress(Math.round(report.progress * 100));
        });
        setWebLlmRouter(router);
        setRouterState("ready");
      } catch (err) {
        console.warn("Failed to initialize WebLLM router:", err);
        setRouterState("failed");
      }
    };
    initRouter();

    const interval = setInterval(fetchHealth, 10000);
    return () => clearInterval(interval);
  }, []);

  // Auto-sync conversation history and refresh session list
  useEffect(() => {
    if (!workspacePath || messages.length === 0) return;
    const syncSession = async () => {
      try {
        await fetch(`${API_BASE}/workspace/sync`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_history: messages.map(m => ({ role: m.role, content: m.content })) })
        });
        
        // Refresh sessions list so dropdown titles update from "Empty Session"
        fetchSessions();
      } catch (e) {}
    };
    
    // Debounce saves by 2 seconds
    const timer = setTimeout(syncSession, 2000);
    return () => clearTimeout(timer);
  }, [workspacePath, messages, fetchSessions]);

  const ingestDirectory = async (path: string) => {
    setDirPath(path);
    setModalLoading(true);
    setShowIngestModal(true);
    setIngestPhase(1);
    setModalProgress("Connecting to indexing service...");

    try {
      const res = await fetch(`${API_BASE}/ingest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ directory_path: path }),
      });

      if (!res.ok) {
        throw new Error("Ingestion request failed");
      }

      if (!res.body) throw new Error("No response body");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let partialLine = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = (partialLine + chunk).split("\n");
        partialLine = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          
          try {
            const data = JSON.parse(trimmed);
            if (data.error) {
              setModalProgress(`Error: ${data.error}`);
              setModalLoading(false);
              return;
            }
            if (data.phase) {
              if (data.phase < 4) {
                setIngestPhase(data.phase as any);
              }
              setModalProgress(data.message);
              
              if (data.phase === 4) {
                setFiles(data.files || []);
                setChunksCount(data.chunks_count || 0);
                setWorkspaceSizeKb(Math.round((data.chunks_count * 1500) / 1024));
                setWorkspacePath(path);
                setModalLoading(false);
              }
            }
          } catch (e) {
            // Keep parsing next lines
          }
        }
      }
    } catch (err: any) {
      setModalProgress(`Error: ${err.message || "Could not reach local backend. Make sure the FastAPI server is running."}`);
      setModalLoading(false);
    }
  };

  const handleLocalIngest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dirPath.trim()) return;
    await ingestDirectory(dirPath);
  };

  const handleNativeFolderSelect = async () => {
    try {
      const selected = await pickDirectory();
      if (selected) {
        await ingestDirectory(selected);
      }
    } catch (err) {
      console.error("Failed native directory selection: ", err);
    }
  };

  const handleZipUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setModalLoading(true);
    setIngestPhase(1);
    setModalProgress("Uploading and preparing ZIP archive...");
    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch(`${API_BASE}/ingest-zip`, {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        throw new Error("ZIP upload request failed");
      }

      if (!res.body) throw new Error("No response body");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let partialLine = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = (partialLine + chunk).split("\n");
        partialLine = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          
          try {
            const data = JSON.parse(trimmed);
            if (data.error) {
              setModalProgress(`Error: ${data.error}`);
              setModalLoading(false);
              return;
            }
            if (data.phase) {
              if (data.phase < 4) {
                setIngestPhase(data.phase as any);
              }
              setModalProgress(data.message);
              
              if (data.phase === 4) {
                setFiles(data.files || []);
                setChunksCount(data.chunks_count || 0);
                setWorkspaceSizeKb(Math.round((data.chunks_count * 1500) / 1024));
                setWorkspacePath("Uploaded ZIP Archive");
                setModalLoading(false);
              }
            }
          } catch (e) {
            // Keep parsing next lines
          }
        }
      }
    } catch (err: any) {
      setModalProgress(`Error: ${err.message || "ZIP upload failed. Make sure the backend is running."}`);
      setModalLoading(false);
    }
  };

  const handleClearDb = async () => {
    if (!window.confirm("Are you sure you want to delete all indexed code from local vector store?")) return;
    try {
      const res = await fetch(`${API_BASE}/clear`, { method: "POST" });
      if (res.ok) {
        setFiles([]);
        setChunksCount(0);
        setWorkspaceSizeKb(0);
        setActiveFile(null);
        setMessages([]);
        setWorkspacePath("");
      }
    } catch {
      alert("Error clearing vector store.");
    }
  };

  const handleSendMessage = async (text: string, attachedFiles: string[] = []) => {
    setCenterTab("chat");
    const userMessageId = `user_${Date.now()}`;
    const userMessage: Message = {
      id: userMessageId,
      role: "user",
      content: text,
      attachedFiles: attachedFiles
    };

    setMessages(prev => [...prev, userMessage]);
    setIsLoading(true);

    const assistantMessageId = `assistant_${Date.now()}`;

    // Ensure a session exists
    let currentSessionId = sessionId;
    if (!currentSessionId) {
      const newId = await createNewSession();
      if (newId) {
        currentSessionId = newId;
      }
    }

    // Server-side Graph RAG Pipeline - always used (WebLLM routing removed)
    try {
      const recentMessages = messages.slice(-10).map(m => ({ role: m.role, content: m.content }));
      
      const res = await fetch(`${API_BASE}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          query: text, 
          n_results: 5, 
          history: recentMessages,
          use_files: false,
          use_search: false,
          use_graph: false,
          session_id: currentSessionId,
          attached_files: attachedFiles
        }),
      });

      if (!res.ok) {
        throw new Error("Local inference failed.");
      }

      if (!res.body) {
        throw new Error("Empty response stream from Ollama.");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let partialLine = "";
      let accumulatedText = "";
      let retrievedSources: Source[] = [];

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = (partialLine + chunk).split("\n");
        partialLine = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          
          try {
            const parsed = JSON.parse(trimmed);
            if (parsed.type === "sources") {
              retrievedSources = parsed.sources || [];
            } else if (parsed.type === "content") {
              accumulatedText += parsed.text;
            }
          } catch (e) {
            // Keep parsing lines if one fails
          }
        }
      }
      setMessages(prev => [...prev, {
        id: assistantMessageId,
        role: "assistant",
        content: accumulatedText,
        sources: retrievedSources,
        routing: "server"
      }]);
    } catch (err: any) {
      setMessages(prev => [...prev, {
        id: assistantMessageId,
        role: "assistant",
        content: `*Inference error: ${err.message || "Failed to obtain response from Ollama Qwen model."}*`,
        sources: [],
        routing: "server"
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex h-screen w-screen dark:bg-[#030306] bg-gray-50 dark:text-gray-200 text-gray-800 overflow-hidden font-sans relative transition-colors duration-300">
      {/* Modals & Overlays */}
      {showHistoryModal && <HistoryModal onClose={() => setShowHistoryModal(false)} />}
      
      {showFilesModal && (
        <FilesModal 
          files={files}
          onClose={() => setShowFilesModal(false)}
          onSelectFile={(f) => {
            setChatInput((prev) => prev + (prev.endsWith(" ") || prev === "" ? "" : " ") + `@${f} `);
          }}
        />
      )}
      
      {showSearchModal && (
        <FilesModal 
          files={files}
          onClose={() => setShowSearchModal(false)}
          onSelectFile={(f) => {
            setActiveFile(f);
            setCenterTab("code");
          }}
        />
      )}
      
      {showGraphModal && (
        <GraphModal 
          apiBase={API_BASE}
          onClose={() => setShowGraphModal(false)}
        />
      )}

      {isDragging && (
        <div className="absolute inset-0 dark:bg-[#030306] bg-gray-50/85 backdrop-blur-md z-50 flex items-center justify-center p-8 pointer-events-none">
          <div className="w-full h-full border-2 border-dashed border-arivuEmerald/40 rounded-3xl dark:bg-[#0a0b10] bg-white/60 flex flex-col items-center justify-center gap-4 animate-pulse">
            <div className="w-20 h-20 rounded-2xl border border-arivuEmerald/50 dark:bg-[#0c0d12] bg-gray-100/95 flex items-center justify-center text-arivuEmerald shadow-emeraldGlow glow-glow">
              <FolderOpen className="w-10 h-10 stroke-[1.5]" />
            </div>
            <div className="space-y-1 text-center">
              <h3 className="text-xl font-bold tracking-wide dark:text-gray-200 text-gray-800">Drop to Index Codebase</h3>
              <p className="text-xs font-mono text-gray-500 max-w-sm leading-relaxed">
                Release your repository folder to automatically parse the syntax structures and build the relational Code Graph RAG database.
              </p>
            </div>
          </div>
        </div>
      )}
      
      {/* ==================== 1. LEFT COLUMN ==================== */}
      <aside className="w-80 shrink-0 dark:bg-[#07080b] bg-white/90 flex flex-col h-full z-10">
        
        {/* Card 1: Ingest Codebase */}
        <div className="p-5 flex flex-col gap-4">
          <h3 className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Ingest Codebase</h3>
          
          {workspacePath ? (
            <div className="p-4 rounded-xl bg-white/[0.01] flex flex-col gap-3">
              <div className="flex items-center gap-2 group relative">
                <div className="w-8 h-8 rounded-lg dark:bg-arivuEmerald/10 bg-arivuEmerald/20 flex items-center justify-center text-arivuEmerald">
                  <FolderOpen className="w-4 h-4" />
                </div>
                <div className="overflow-hidden">
                  <h4 className="text-xs font-semibold dark:text-gray-200 text-gray-800 truncate" title={workspacePath}>
                    {workspacePath.split(/[/\\]/).pop()}
                  </h4>
                  <p className="text-[9px] font-mono dark:text-gray-400 text-gray-500 truncate group-hover:text-clip" title={workspacePath}>
                    {workspacePath}
                  </p>
                </div>
              </div>
              
              <div className="flex gap-2">
                <button
                  onClick={isTauri ? handleNativeFolderSelect : () => setShowIngestModal(true)}
                  className="flex-1 text-[10px] font-mono border dark:border-white/5 border-gray-200 hover:border-arivuIndigo/40 hover:bg-white/5 rounded-lg py-1.5 transition dark:text-gray-400 text-gray-600"
                >
                  Change Path
                </button>
                <button
                  onClick={handleClearDb}
                  className="text-[10px] font-mono text-red-400 hover:text-red-300 border border-red-500/10 hover:bg-red-500/10 rounded-lg px-2.5 transition"
                >
                  Clear DB
                </button>
              </div>
            </div>
          ) : (
            <div className="p-5 rounded-xl border dark:border-white/5 border-gray-200 bg-white/[0.01] text-center flex flex-col items-center gap-3">
              <div className="w-12 h-12 rounded-full border border-dashed dark:border-white/10 border-gray-200 flex items-center justify-center text-gray-600 mb-1">
                <Folder className="w-5 h-5 stroke-[1.5]" />
              </div>
              <div className="space-y-1">
                <h4 className="text-xs font-semibold dark:text-gray-300 text-gray-700">No codebase loaded</h4>
                <p className="text-[10px] text-gray-500 leading-relaxed">
                  Select a local directory or upload a .zip file to get started.
                </p>
              </div>
              
              <button
                onClick={isTauri ? handleNativeFolderSelect : () => setShowIngestModal(true)}
                className="w-full text-[10px] font-bold tracking-wider uppercase border border-arivuEmerald hover:bg-arivuEmerald/5 text-arivuEmerald-light rounded-lg py-2 transition mt-1.5"
              >
                {isTauri ? "Select Directory (Native)" : "Select Directory or Zip"}
              </button>
              
              <span className="text-[9px] font-mono text-gray-600">Supports: {isTauri ? "Local Folders" : ".zip, .tar.gz"}</span>
            </div>
          )}
        </div>

        {/* Card 2: File Explorer */}
        <div className="flex-1 flex flex-col min-h-0 p-5">
          <h3 className="text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-4">File Explorer</h3>
          
          <div className="flex-1 min-h-0 bg-white/[0.01] rounded-xl overflow-hidden flex flex-col">
            {files.length > 0 ? (
              <FileTree
                files={files}
                activeFile={activeFile}
                onSelectFile={(path) => {
                  setActiveFile(path);
                  setCenterTab("code");
                }}
              />
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center p-6 text-center gap-2">
                <Folder className="w-8 h-8 text-gray-800 stroke-[1.2] mb-1" />
                <h4 className="text-xs font-medium dark:text-gray-400 text-gray-600">No files to display</h4>
                <p className="text-[10px] text-gray-600 leading-relaxed font-mono">
                  Ingest a codebase to explore its structure here.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Stats footer row */}
        {files.length > 0 && (
          <div className="px-5 pb-4 grid grid-cols-3 gap-2.5 pt-4">
            <div className="p-2.5 rounded-xl border dark:border-white/5 border-gray-200 dark:bg-[#0c0d12]/80 bg-gray-100/80 text-center font-mono shadow-sm">
              <div className="text-[9px] dark:text-gray-500 text-gray-600">Files</div>
              <div className="text-xs font-bold dark:text-gray-300 text-gray-700 mt-1">{files.length}</div>
            </div>
            <div className="p-2.5 rounded-xl border dark:border-white/5 border-gray-200 dark:bg-[#0c0d12]/80 bg-gray-100/80 text-center font-mono shadow-sm">
              <div className="text-[9px] dark:text-gray-500 text-gray-600">Chunks</div>
              <div className="text-xs font-bold dark:text-gray-300 text-gray-700 mt-1">{chunksCount}</div>
            </div>
            <div className="p-2.5 rounded-xl border dark:border-white/5 border-gray-200 dark:bg-[#0c0d12]/80 bg-gray-100/80 text-center font-mono shadow-sm">
              <div className="text-[9px] dark:text-gray-500 text-gray-600">Size</div>
              <div className="text-xs font-bold dark:text-gray-300 text-gray-700 mt-1">
                {workspaceSizeKb > 1024 ? `${(workspaceSizeKb / 1024).toFixed(1)} MB` : `${workspaceSizeKb} KB`}
              </div>
            </div>
          </div>
        )}

        {/* Bottom bar button */}
        <div className="p-5 pt-0">
          <button 
            onClick={() => setShowHistoryModal(true)}
            className="w-full flex items-center justify-between px-4 py-2.5 border dark:border-white/5 border-gray-200 hover:dark:border-white/10 border-gray-200 dark:bg-[#0c0d12] bg-gray-100/40 rounded-xl text-[10px] font-mono text-gray-500 hover:dark:text-gray-300 text-gray-700 transition"
          >
            <span className="flex items-center gap-1.5"><Activity className="w-3.5 h-3.5 text-arivuIndigo" /> View Ingestion History</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </aside>

      {/* ==================== 2. CENTER Q&A COLUMN ==================== */}
      <main className="flex-1 flex flex-col h-full relative">
        
        {/* App Header Banner */}
        <header className="px-6 py-4 dark:bg-[#07080b] bg-white/90 flex items-center justify-between backdrop-blur-md">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-arivuIndigo to-arivuEmerald flex items-center justify-center text-white glow-glow">
              <ShieldCheck className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-sm font-extrabold tracking-wider uppercase dark:text-gray-100 text-gray-900">
                  Arivu-Lens
                </h1>
              </div>
              <p className="text-[10px] text-gray-500 tracking-wide font-mono">
                Privacy-First Codebase Intelligence
              </p>
            </div>
          </div>
          
          <div className="flex items-center gap-4">
            {/* Status dot */}
            <div className="flex items-center gap-2 px-3 py-1 rounded-full border dark:border-white/5 border-gray-200 dark:bg-[#0c0d12] bg-gray-100 text-[10px] font-mono">
              <span className={`w-1.5 h-1.5 rounded-full ${health?.ollama_connection === "online" ? "bg-arivuEmerald animate-pulse" : "bg-red-500"}`}></span>
              <span className="dark:text-gray-400 text-gray-600">Ollama</span>
              <span className="text-gray-600">|</span>
              <span className="text-arivuEmerald-light font-semibold">
                {health?.ollama_connection === "online" ? "Online" : "Offline"}
              </span>
            </div>

            {/* Tauri and WebGPU badge */}
            <div className="flex items-center gap-2 px-3 py-1 rounded-full border dark:border-white/5 border-gray-200 dark:bg-[#0c0d12] bg-gray-100 text-[10px] font-mono">
              <span className={`w-1.5 h-1.5 rounded-full ${routerState === "ready" ? "bg-arivuEmerald animate-pulse" : "bg-gray-500"}`}></span>
              <span className={`font-semibold ${routerState === "ready" ? "text-arivuEmerald-light" : "dark:text-gray-400 text-gray-600"}`}>
                {routerState === "ready" ? "WebGPU Active" : "WebGPU Standby"}
              </span>
            </div>
            
            {/* Action buttons */}
            <div className="w-7 h-7 rounded-full border dark:border-white/10 border-gray-200 dark:bg-[#0c0d12] bg-gray-100 text-xs font-extrabold flex items-center justify-center text-arivuIndigo select-none">
              K
            </div>
          </div>
        </header>

        {/* Code Q&A Viewport */}
        <div className="flex-1 overflow-hidden relative flex flex-col">
          {files.length > 0 && (
            <div className="flex items-center gap-4 px-6 dark:bg-[#07080b] bg-white/90 text-xs font-mono">
              <button 
                onClick={() => setCenterTab("chat")}
                className={`py-3 px-2 border-b-2 transition ${centerTab === "chat" ? "border-arivuIndigo text-arivuIndigo" : "border-transparent text-gray-500 hover:dark:text-gray-300 text-gray-700"}`}
              >
                Chat
              </button>
              <button 
                onClick={() => setCenterTab("code")}
                className={`py-3 px-2 border-b-2 transition ${centerTab === "code" ? "border-arivuEmerald text-arivuEmerald" : "border-transparent text-gray-500 hover:dark:text-gray-300 text-gray-700"}`}
              >
                Code Viewer
              </button>
            </div>
          )}
          
          {files.length === 0 ? (
            /* Orbital Empty State */
            <div className="flex-1 overflow-y-auto flex flex-col items-center justify-center p-8 text-center relative">
              <div className="relative w-80 h-80 mb-6 flex items-center justify-center select-none">
                <div className="orbit-ring w-[280px] h-[160px] opacity-20" style={{ animationDuration: '40s' }}></div>
                <div className="orbit-ring w-[220px] h-[120px] opacity-40" style={{ animationDuration: '30s', animationDirection: 'reverse' }}></div>
                <div className="orbit-ring w-[160px] h-[90px] opacity-60" style={{ animationDuration: '20s' }}></div>
                <div className="absolute top-[18%] left-[20%] w-7 h-7 rounded-lg border dark:border-white/5 border-gray-200 dark:bg-[#0b0c10] bg-white/90 flex items-center justify-center text-arivuIndigo/70 text-xs font-mono glow-violet">
                  &lt;/&gt;
                </div>
                <div className="absolute top-[18%] right-[20%] w-7 h-7 rounded-lg border dark:border-white/5 border-gray-200 dark:bg-[#0b0c10] bg-white/90 flex items-center justify-center text-arivuEmerald-light/70 text-xs font-mono glow-glow">
                  &gt;_
                </div>
                <div className="absolute bottom-[10%] left-[45%] w-7 h-7 rounded-lg border dark:border-white/5 border-gray-200 dark:bg-[#0b0c10] bg-white/90 flex items-center justify-center text-gray-500 text-xs">
                  <Terminal className="w-3.5 h-3.5" />
                </div>
                <div className="w-24 h-24 rounded-3xl border dark:border-white/5 border-gray-200 dark:bg-[#0a0b10] bg-white/90 flex items-center justify-center shadow-emeraldGlow z-10 glow-glow relative overflow-hidden">
                  <div className="absolute inset-0 bg-gradient-to-br from-arivuEmerald/20 to-arivuIndigo/20 opacity-50"></div>
                  <span className="text-5xl font-extrabold text-transparent bg-clip-text bg-gradient-to-br from-arivuEmerald to-arivuIndigo-light z-10 font-sans tracking-tighter">A</span>
                </div>
              </div>
              <div className="max-w-md space-y-3 z-10">
                <h2 className="text-3xl font-bold dark:text-gray-100 text-gray-900 tracking-tight">
                  Your Codebase, Your Intelligence.
                </h2>
                <div className="text-arivuEmerald-light font-black tracking-widest text-sm uppercase py-2">
                  100% LOCAL. 100% PRIVATE.
                </div>
                <p className="text-[13px] dark:text-gray-400 text-gray-500 leading-relaxed font-mono px-4">
                  Arivu-Lens analyzes your codebase locally to help you understand, debug, and optimize your projects — all without sending a single byte of code over the internet.
                </p>
                <div className="pt-4">
                  <button
                    onClick={isTauri ? handleNativeFolderSelect : () => setShowIngestModal(true)}
                    className="inline-flex items-center gap-2 border dark:border-white/5 border-gray-200 hover:border-arivuIndigo/50 dark:bg-[#0c0d12] bg-gray-100/60 hover:dark:bg-[#0c0d12] bg-gray-100 text-xs font-mono dark:text-gray-400 text-gray-600 hover:dark:text-gray-200 text-gray-800 px-4 py-2.5 rounded-xl transition shadow-indigoGlow"
                  >
                    <span>{isTauri ? "Select a codebase directory (Native)" : "Ingest a codebase to begin"}</span>
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex-1 overflow-hidden flex flex-col relative">
              {centerTab === "chat" ? (
                <ChatArea
                  messages={messages}
                  isLoading={isLoading}
                  chatStarters={chatStarters}
                  onSendMessage={handleSendMessage}
                  onSelectSourceFile={(path) => {
                    setActiveFile(path);
                    setCenterTab("code");
                  }}
                  sessionsList={sessionsList}
                  currentSessionId={sessionId}
                  onNewChat={() => {
                    setMessages([]);
                    createNewSession();
                  }}
                  onSelectSession={(id) => loadSession(id)}
                />
              ) : (
                <CodeViewer
                  filePath={activeFile}
                  isDarkMode={true}
                  onClose={() => setCenterTab("chat")}
                />
              )}
            </div>
          )}
        </div>

        {/* Input bar bottom */}
        {files.length > 0 && (
          <div className="p-5 dark:bg-[#07080b]/80 bg-white/80 backdrop-blur-md relative z-10">
            <div className={`${centerTab === "code" ? "w-full" : "max-w-3xl mx-auto"} border dark:border-white/5 border-gray-200 hover:dark:border-white/10 rounded-2xl dark:bg-[#0b0c10] bg-white shadow-combinedGlow p-3 flex flex-col gap-3 focus-within:border-arivuIndigo/40 transition`}>
              {attachedFiles.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-1 px-1">
                  {attachedFiles.map(file => (
                    <span key={file} className="bg-indigo-500/20 text-indigo-300 text-[11px] px-2 py-1 rounded-md flex items-center gap-1 border border-indigo-500/30 font-mono">
                      <FileText className="w-3 h-3" /> {file.split(/[/\\]/).pop()} 
                      <button onClick={() => setAttachedFiles(prev => prev.filter(f => f !== file))} className="hover:text-white ml-1 font-sans">×</button>
                    </span>
                  ))}
                </div>
              )}
              <div className="relative w-full">
                <textarea
                  rows={1}
                  value={chatInput}
                  onChange={(e) => {
                    const val = e.target.value;
                    setChatInput(val);
                    const match = val.match(/@(\S*)$/);
                    if (match) {
                      setShowMentionPopover(true);
                      setMentionQuery(match[1]);
                    } else {
                      setShowMentionPopover(false);
                    }
                  }}
                  placeholder="Type @ to reference files, or ask a question..."
                  disabled={isLoading}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      if (showMentionPopover) {
                        // User pressed enter while popover is open.
                        // For simplicity, we just close it and let them continue typing.
                        // Ideally, we could select the top result.
                        setShowMentionPopover(false);
                        return;
                      }
                      if (!chatInput.trim() && attachedFiles.length === 0) return;
                      if (isLoading) return;
                      handleSendMessage(chatInput.trim(), attachedFiles);
                      setChatInput("");
                      setAttachedFiles([]);
                    }
                  }}
                  className="w-full text-sm bg-transparent border-0 focus:outline-none focus:ring-0 dark:text-gray-200 text-gray-800 resize-none placeholder:text-gray-600 min-h-[24px] max-h-36 font-sans px-1"
                />
                
                {showMentionPopover && (
                  <div className="absolute bottom-full left-0 mb-2 w-72 bg-slate-900 border border-slate-700 rounded-lg shadow-xl max-h-48 overflow-y-auto z-50 py-1">
                    <div className="px-3 py-1.5 text-[10px] uppercase font-bold text-slate-500 tracking-wider">Project Files</div>
                    {files.filter(f => f.toLowerCase().includes(mentionQuery.toLowerCase())).slice(0, 15).map(f => (
                      <div 
                        key={f}
                        className="px-3 py-2 text-[11px] text-slate-300 hover:bg-slate-800 cursor-pointer flex items-center gap-2 font-mono truncate"
                        onClick={() => {
                          setAttachedFiles(prev => {
                            if (!prev.includes(f)) return [...prev, f];
                            return prev;
                          });
                          const filename = f.split(/[/\\]/).pop();
                          setChatInput(prev => prev.replace(/@\S*$/, `@${filename} `));
                          setShowMentionPopover(false);
                          document.querySelector('textarea')?.focus();
                        }}
                      >
                        <FileText className="w-3 h-3 text-emerald-400 shrink-0" />
                        <span className="truncate">{f}</span>
                      </div>
                    ))}
                    {files.filter(f => f.toLowerCase().includes(mentionQuery.toLowerCase())).length === 0 && (
                      <div className="px-3 py-2 text-xs text-slate-500 italic">No files found...</div>
                    )}
                  </div>
                )}
              </div>
              
              <div className="flex items-center justify-between border-t dark:border-white/5 border-gray-100 pt-2">
                <div className="flex items-center gap-1.5 text-xs dark:text-gray-500 text-gray-600 font-mono">
                  <button 
                    onClick={() => setShowFilesModal(true)}
                    className={`flex items-center gap-1.5 border px-3 py-1.5 rounded-lg transition text-[11px] ${
                      showFilesModal 
                        ? "border-arivuEmerald/50 bg-arivuEmerald/10 text-arivuEmerald shadow-emeraldGlow" 
                        : "dark:border-white/5 border-gray-200 hover:dark:text-gray-300 hover:bg-black/5"
                    }`}
                  >
                    <FolderOpen className={`w-3.5 h-3.5 ${showFilesModal ? "text-arivuEmerald" : "text-arivuIndigo"}`} />
                    <span>Files</span>
                  </button>
                  <button 
                    onClick={() => setShowGraphModal(true)}
                    className={`flex items-center gap-1.5 border px-3 py-1.5 rounded-lg transition text-[11px] ${
                      showGraphModal 
                        ? "border-arivuIndigo/50 bg-arivuIndigo/10 text-arivuIndigo shadow-indigoGlow" 
                        : "dark:border-white/5 border-gray-200 hover:dark:text-gray-300 hover:bg-black/5"
                    }`}
                  >
                    <Network className={`w-3.5 h-3.5 ${showGraphModal ? "text-arivuIndigo-light" : "text-arivuIndigo"}`} />
                    <span>Graph</span>
                  </button>
                </div>
                
                <div className="flex items-center gap-2">
                  <button className="p-2 hover:dark:text-gray-300 text-gray-600 transition hover:bg-white/5 rounded-lg" title="Attach file">
                    <Paperclip className="w-4 h-4" />
                  </button>
                  <span className="text-[9px] text-gray-600 font-mono hidden md:inline mr-2">
                    All analysis performed locally • Your data never leaves this machine
                  </span>
                  <button
                    onClick={() => {
                      if (!chatInput.trim() || isLoading) return;
                      handleSendMessage(chatInput);
                      setChatInput("");
                    }}
                    disabled={!chatInput.trim() || isLoading}
                    className="p-2 rounded-lg bg-arivuEmerald/10 text-arivuEmerald hover:bg-arivuEmerald/20 transition disabled:opacity-50 disabled:cursor-not-allowed border border-arivuEmerald/20"
                  >
                    <Send className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* ==================== 3. RIGHT INFRASTRUCTURE COLUMN ==================== */}
      <aside className="w-76 shrink-0 dark:bg-[#07080b] bg-white/90 flex flex-col h-full z-10 overflow-y-auto">
        
        <div className="p-5 flex flex-col gap-4">
          <h3 className="text-[10px] font-bold uppercase tracking-wider text-gray-500">AI & Infrastructure</h3>
          
          <div className="space-y-3.5">
            <div className="p-3.5 rounded-xl border border-arivuEmerald/30 dark:bg-arivuEmerald/5 bg-arivuEmerald/10 flex flex-col gap-3 shadow-emeraldGlow relative overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-arivuEmerald/5 to-transparent animate-progressLine pointer-events-none"></div>
              <div className="flex items-center justify-between border-b dark:border-white/5 border-gray-200 pb-2 relative z-10">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-arivuEmerald/10 flex items-center justify-center text-arivuEmerald border border-arivuEmerald/20 glow-glow">
                    <Cpu className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-[8px] font-bold font-mono dark:text-gray-400 text-gray-600 uppercase">Ollama Model</div>
                    <div className="text-xs font-extrabold dark:text-gray-100 text-gray-900 mt-0.5">qwen2.5-coder</div>
                  </div>
                </div>
                <div className="flex items-center gap-1 text-[9px] font-mono px-2 py-0.5 rounded border border-arivuEmerald/10 bg-arivuEmerald/5 text-arivuEmerald-light">
                  <span className="w-1.5 h-1.5 rounded-full bg-arivuEmerald animate-pulse"></span> Active
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2 text-[9px] font-mono dark:text-gray-500 text-gray-600 relative z-10">
                <div>
                  <div className="text-[8px] dark:text-gray-500 text-gray-600 uppercase">Model Size</div>
                  <div className="dark:text-gray-300 text-gray-700 mt-0.5">7B</div>
                </div>
                <div>
                  <div className="text-[8px] dark:text-gray-500 text-gray-600 uppercase">Context Length</div>
                  <div className="dark:text-gray-300 text-gray-700 mt-0.5">32K</div>
                </div>
                <div>
                  <div className="text-[8px] dark:text-gray-500 text-gray-600 uppercase">Backend</div>
                  <div className="dark:text-gray-300 text-gray-700 mt-0.5">Ollama (Local)</div>
                </div>
              </div>
            </div>

            <div className="p-3.5 rounded-xl dark:bg-[#0c0d12] bg-gray-100/50 flex flex-col gap-3">
              <div className="flex items-center justify-between border-b dark:border-white/5 border-gray-200 pb-2">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-arivuEmerald/10 flex items-center justify-center text-arivuEmerald border border-arivuEmerald/10 glow-glow">
                    <Compass className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-[8px] font-bold font-mono text-gray-500 uppercase">Embedding Model</div>
                    <div className="text-xs font-extrabold dark:text-gray-200 text-gray-800 mt-0.5">nomic-embed-text</div>
                  </div>
                </div>
                <div className="flex items-center gap-1 text-[9px] font-mono px-2 py-0.5 rounded border border-arivuEmerald/10 bg-arivuEmerald/5 text-arivuEmerald-light">
                  <span className="w-1 h-1 rounded-full bg-arivuEmerald animate-pulse"></span> Active
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 text-[9px] font-mono text-gray-500 mt-1">
                <div>
                  <div className="text-[8px] dark:text-gray-500 text-gray-600 uppercase">Dimensions</div>
                  <div className="dark:text-gray-300 text-gray-700 mt-0.5">768</div>
                </div>
                <div>
                  <div className="text-[8px] dark:text-gray-500 text-gray-600 uppercase">Status</div>
                  <div className="dark:text-gray-300 text-gray-700 mt-0.5">Ready</div>
                </div>
              </div>
            </div>

            <div className="p-3.5 rounded-xl dark:bg-[#0c0d12] bg-gray-100/50 flex flex-col gap-3">
              <div className="flex items-center justify-between border-b dark:border-white/5 border-gray-200 pb-2">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-arivuIndigo/10 flex items-center justify-center text-arivuIndigo border border-arivuIndigo/10 shadow-indigoGlow">
                    <Database className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-[8px] font-bold font-mono text-gray-500 uppercase">Vector Database</div>
                    <div className="text-xs font-extrabold dark:text-gray-200 text-gray-800 mt-0.5">
                      ChromaDB
                    </div>
                  </div>
                </div>
                
                <div className="flex items-center gap-1 text-[9px] font-mono px-2 py-0.5 rounded border border-arivuEmerald/10 bg-arivuEmerald/5 text-arivuEmerald-light">
                  <span className="w-1 h-1 rounded-full bg-arivuEmerald"></span> Active
                </div>
              </div>
              
              <div className="grid grid-cols-3 gap-1 text-[9px] font-mono text-gray-500 mt-1">
                <div>
                  <div className="text-[8px] dark:text-gray-500 text-gray-600 uppercase">Collections</div>
                  <div className="dark:text-gray-300 text-gray-700 mt-0.5">1</div>
                </div>
                <div>
                  <div className="text-[8px] dark:text-gray-500 text-gray-600 uppercase">Status</div>
                  <div className="dark:text-gray-300 text-gray-700 mt-0.5">Ready</div>
                </div>
                <div>
                  <div className="text-[8px] dark:text-gray-500 text-gray-600 uppercase">Storage</div>
                  <div className="dark:text-gray-300 text-gray-700 mt-0.5">Local</div>
                </div>
              </div>
            </div>

            <div className="p-3.5 rounded-xl dark:bg-[#0c0d12] bg-gray-100/50 flex flex-col gap-3">
              <div className="flex items-center justify-between border-b dark:border-white/5 border-gray-200 pb-2">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-emerald-500/10 flex items-center justify-center text-emerald-400 border border-emerald-500/10 glow-glow">
                    <Layers className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-[8px] font-bold font-mono text-gray-500 uppercase">LLM Runtime</div>
                    <div className="text-xs font-extrabold dark:text-gray-200 text-gray-800 mt-0.5">WebLLM (WebGPU)</div>
                  </div>
                </div>
                
                {routerState === "ready" && (
                  <div className="flex items-center gap-1 text-[9px] font-mono px-2 py-0.5 rounded border border-arivuEmerald/10 bg-arivuEmerald/5 text-arivuEmerald-light">
                    <span className="w-1.5 h-1.5 rounded-full bg-arivuEmerald animate-pulse"></span> Active
                  </div>
                )}
                {routerState === "loading" && (
                  <div className="flex items-center gap-1 text-[9px] font-mono px-2 py-0.5 rounded border border-yellow-500/10 bg-yellow-500/5 text-yellow-400">
                    <span className="w-1.5 h-1.5 rounded-full bg-yellow-500 animate-bounce"></span> Loading
                  </div>
                )}
                {routerState === "failed" && (
                  <div className="flex items-center gap-1 text-[9px] font-mono px-2 py-0.5 rounded border border-red-500/10 bg-red-500/5 text-red-400">
                    <span className="w-1.5 h-1.5 rounded-full bg-red-500"></span> Offline
                  </div>
                )}
                {routerState === "uninitialized" && (
                  <div className="flex items-center gap-1 text-[9px] font-mono px-2 py-0.5 rounded border border-gray-500/10 bg-gray-500/5 dark:text-gray-400 text-gray-600">
                    <span className="w-1.5 h-1.5 rounded-full bg-gray-400"></span> Standby
                  </div>
                )}
              </div>

              {routerState === "loading" && (
                <div className="space-y-1.5">
                  <div className="flex justify-between text-[8px] font-mono text-gray-500">
                    <span>Downloading local model...</span>
                    <span>{routerProgress}%</span>
                  </div>
                  <div className="w-full h-1.5 bg-white/5 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-gradient-to-r from-arivuIndigo to-arivuEmerald transition-all duration-300 shadow-emeraldGlow"
                      style={{ width: `${routerProgress}%` }}
                    ></div>
                  </div>
                  <p className="text-[7px] text-gray-600 font-mono leading-snug">
                    Initial download caching is ~300MB inside browser IndexedDB. Future loads are instantaneous.
                  </p>
                </div>
              )}

              {routerState === "ready" && (
                <div className="grid grid-cols-2 gap-2 text-[9px] font-mono text-gray-500 mt-1">
                  <div>
                    <div className="text-[8px] dark:text-gray-500 text-gray-600 uppercase">Engine</div>
                    <div className="dark:text-gray-300 text-gray-700 mt-0.5">WebGPU</div>
                  </div>
                  <div>
                    <div className="text-[8px] dark:text-gray-500 text-gray-600 uppercase">Status</div>
                    <div className="dark:text-gray-300 text-gray-700 mt-0.5">Running</div>
                  </div>
                </div>
              )}

              {routerState === "failed" && (
                <p className="text-[8px] text-red-400/80 font-mono leading-normal">
                  WebGPU context creation failed or model fetch blocked. Defaulting to server RAG inference.
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Card 2: Privacy Status */}
        <div className="p-5 flex flex-col gap-4">
          <h3 className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Privacy Status</h3>
          
          <div className="p-5 rounded-xl dark:bg-[#0c0d12] bg-gray-100/30 text-center flex flex-col items-center gap-4">
            {/* Padlock Icon */}
            <div className="w-14 h-14 rounded-full border border-arivuEmerald/20 bg-arivuEmerald/5 flex items-center justify-center text-arivuEmerald shadow-emeraldGlow glow-glow">
              <Lock className="w-6 h-6 stroke-[1.5]" />
            </div>
            
            <div className="space-y-1">
              <h4 className="text-xs font-bold text-arivuEmerald-light tracking-wide font-mono">
                Local Air-gapped Mode
              </h4>
              <p className="text-[10px] text-gray-500 font-mono uppercase">100% Private</p>
            </div>
            
            {/* Checklist */}
            <ul className="w-full text-[10px] font-mono dark:text-gray-400 text-gray-600 space-y-2 text-left pt-2 border-t dark:border-white/5 border-gray-200">
              <li className="flex items-center gap-2">
                <CheckCircle2 className="w-3.5 h-3.5 text-arivuEmerald shrink-0" />
                <span>No data leaves your machine</span>
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle2 className="w-3.5 h-3.5 text-arivuEmerald shrink-0" />
                <span>No API calls to external servers</span>
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle2 className="w-3.5 h-3.5 text-arivuEmerald shrink-0" />
                <span>All inference happens locally</span>
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle2 className="w-3.5 h-3.5 text-arivuEmerald shrink-0" />
                <span>Your code stays yours</span>
              </li>
            </ul>
            
            {/* info alert */}
            <div className="w-full p-3 rounded-lg border border-blue-500/10 bg-blue-500/5 text-[9px] font-mono text-gray-500 leading-relaxed flex gap-2 text-left">
              <Info className="w-4 h-4 text-blue-400 shrink-0" />
              <span>Your code never leaves your machine. Arivu-Lens is built for privacy-first development.</span>
            </div>
          </div>
        </div>
      </aside>



      {/* ==================== 5. GLASSMORPHIC INGESTION MODAL ==================== */}
      {showIngestModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-[450px] border dark:border-white/5 border-gray-200 dark:bg-[#0c0d12] bg-gray-100/95 backdrop-blur-lg rounded-2xl p-6 arivu-glass shadow-combinedGlow flex flex-col gap-5 relative animate-in scale-in duration-200">
            
            {/* Close button */}
            <button
              onClick={() => {
                if (!modalLoading) {
                  setShowIngestModal(false);
                  setModalProgress(null);
                  setIngestPhase(0);
                }
              }}
              disabled={modalLoading}
              className="absolute right-4 top-4 p-1 hover:text-white dark:text-gray-400 text-gray-600 rounded hover:bg-white/5 transition disabled:opacity-30"
            >
              <X className="w-4 h-4" />
            </button>
            
            <div className="space-y-1">
              <h2 className="text-sm font-extrabold tracking-wide uppercase dark:text-gray-100 text-gray-900 flex items-center gap-2">
                <FolderOpen className="w-4 h-4 text-arivuIndigo" /> Ingest Local Codebase
              </h2>
              <p className="text-[10px] text-gray-500 font-mono">
                Index repository folders or zip archives locally into ChromaDB.
              </p>
            </div>

            {/* Ingestion Tabs */}
            <div className="flex text-xs font-mono text-gray-500">
              <button
                onClick={() => setActiveTab("path")}
                disabled={modalLoading}
                className={`flex-1 py-2 text-center border-b-2 transition ${activeTab === "path" ? "text-arivuIndigo-light border-arivuIndigo font-bold" : "border-transparent hover:dark:text-gray-300 text-gray-700"}`}
              >
                Local Path Ingest
              </button>
              <button
                onClick={() => setActiveTab("zip")}
                disabled={modalLoading}
                className={`flex-1 py-2 text-center border-b-2 transition ${activeTab === "zip" ? "text-arivuEmerald-light border-arivuEmerald font-bold" : "border-transparent hover:dark:text-gray-300 text-gray-700"}`}
              >
                Upload ZIP Archive
              </button>
            </div>

            {activeTab === "path" ? (
              /* Local path form */
              <form onSubmit={handleLocalIngest} className="flex flex-col gap-3.5">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[9px] font-bold uppercase tracking-wider text-gray-500 font-mono">
                    Absolute Folder Path
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      required
                      placeholder="e.g. C:\Projects\MyProject"
                      value={dirPath}
                      onChange={(e) => setDirPath(e.target.value)}
                      disabled={modalLoading}
                      className="flex-1 text-xs dark:bg-darkBg bg-gray-50/90 border dark:border-white/5 border-gray-200 hover:dark:border-white/10 border-gray-200 focus:border-arivuIndigo focus:ring-1 focus:ring-arivuIndigo focus:outline-none rounded-lg px-3 py-2.5 dark:text-gray-200 text-gray-800 transition font-mono placeholder:text-gray-700"
                    />
                    <button
                      type="button"
                      disabled={modalLoading}
                      onClick={async () => {
                        const selected = await pickDirectory();
                        if (selected) {
                          setDirPath(selected);
                        }
                      }}
                      className="px-3 border dark:border-white/5 border-gray-200 hover:border-arivuIndigo/40 bg-white/[0.02] hover:bg-arivuIndigo/5 rounded-lg dark:text-gray-400 text-gray-600 hover:text-white transition flex items-center justify-center"
                      title="Browse Local Folder"
                    >
                      <FolderOpen className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={modalLoading || !dirPath.trim()}
                  className="w-full py-2.5 rounded-lg text-xs font-bold tracking-wider uppercase bg-arivuIndigo hover:bg-arivuIndigo-dark text-white transition disabled:opacity-40 shadow-indigoGlow flex items-center justify-center gap-1.5 glow-violet"
                >
                  {modalLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Index Local Folder"}
                </button>
              </form>
            ) : (
              /* ZIP Upload form */
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[9px] font-bold uppercase tracking-wider text-gray-500 font-mono">
                    Select Archive
                  </label>
                  
                  <div className="relative border border-dashed dark:border-white/10 border-gray-200 hover:border-arivuEmerald/40 rounded-xl py-6 px-4 text-center transition cursor-pointer dark:bg-darkBg bg-gray-50/30 flex flex-col items-center justify-center gap-2">
                    <input
                      type="file"
                      accept=".zip"
                      disabled={modalLoading}
                      onChange={handleZipUpload}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed"
                    />
                    <Folder className="w-8 h-8 text-gray-600 stroke-[1.2]" />
                    <span className="text-xs dark:text-gray-400 text-gray-600 font-medium font-mono">Drag or click to choose .zip repository</span>
                    <span className="text-[9px] text-gray-600 font-mono">Max volume: 150MB</span>
                  </div>
                </div>
              </div>
            )}

            {/* Modal Progress diagnostics */}
            {(modalLoading || modalProgress) && (
              <div className="flex flex-col gap-3.5 border-t dark:border-white/5 border-gray-200 pt-4 mt-2">
                {modalLoading ? (
                  <div className="space-y-3">
                    {/* Animated Progress Bar */}
                    <div className="h-1.5 w-full bg-white/[0.03] rounded-full overflow-hidden relative">
                      <div className="absolute top-0 bottom-0 left-0 bg-gradient-to-r from-arivuIndigo to-arivuEmerald rounded-full animate-progressLine w-1/2"></div>
                    </div>
                    
                    {/* Diagnostic Checklist */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-[10px] font-mono dark:text-gray-400 text-gray-600">
                        <span className="flex items-center gap-1.5">
                          <Loader2 className="w-3.5 h-3.5 text-arivuIndigo animate-spin" />
                          <span>{modalProgress || "Processing repository assets..."}</span>
                        </span>
                        <span className="text-arivuEmerald-light animate-pulse font-bold">Indexing...</span>
                      </div>

                      {/* Processing Phase Cards */}
                      <div className="grid grid-cols-3 gap-2 pt-1.5">
                        <div className={`p-2 rounded-lg border text-center font-mono text-[9px] flex flex-col gap-1 transition-all ${
                          ingestPhase >= 1
                            ? "bg-arivuIndigo/10 border-arivuIndigo/30 text-arivuIndigo-light"
                            : "bg-white/[0.01] dark:border-white/5 border-gray-200 text-gray-600"
                        }`}>
                          <span className="font-extrabold uppercase">Phase 1</span>
                          <span>AST parsing</span>
                        </div>
                        <div className={`p-2 rounded-lg border text-center font-mono text-[9px] flex flex-col gap-1 transition-all ${
                          ingestPhase >= 2
                            ? "bg-arivuIndigo/10 border-arivuIndigo/30 text-arivuIndigo-light"
                            : "bg-white/[0.01] dark:border-white/5 border-gray-200 text-gray-600"
                        }`}>
                          <span className="font-extrabold uppercase">Phase 2</span>
                          <span>Graph mapping</span>
                        </div>
                        <div className={`p-2 rounded-lg border text-center font-mono text-[9px] flex flex-col gap-1 transition-all ${
                          ingestPhase >= 3
                            ? "bg-arivuIndigo/10 border-arivuIndigo/30 text-arivuIndigo-light"
                            : "bg-white/[0.01] dark:border-white/5 border-gray-200 text-gray-600"
                        }`}>
                          <span className="font-extrabold uppercase">Phase 3</span>
                          <span>Vector indexing</span>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : modalProgress ? (
                  /* Success/Failure Summary view */
                  <div className={`p-3.5 rounded-xl border flex flex-col gap-2.5 ${
                    modalProgress.includes("failed") || modalProgress.includes("Error")
                      ? "border-red-500/20 bg-red-500/5"
                      : "border-arivuEmerald/20 bg-arivuEmerald/5"
                  }`}>
                    <div className={`flex items-center gap-2 text-xs font-mono font-bold ${
                      modalProgress.includes("failed") || modalProgress.includes("Error")
                        ? "text-red-400"
                        : "text-arivuEmerald-light"
                    }`}>
                      {modalProgress.includes("failed") || modalProgress.includes("Error") ? (
                        <span className="w-2 h-2 rounded-full bg-red-500 shrink-0"></span>
                      ) : (
                        <CheckCircle2 className="w-4 h-4 shrink-0 text-arivuEmerald" />
                      )}
                      <span>{modalProgress.includes("failed") || modalProgress.includes("Error") ? "Ingestion Failed" : "Ingestion Complete"}</span>
                    </div>
                    <div className="text-[10px] dark:text-gray-400 text-gray-600 font-mono leading-relaxed space-y-1">
                      <div className="truncate"><strong className="dark:text-gray-300 text-gray-700">Target Path:</strong> <span className="text-gray-500">{dirPath || workspacePath || "Uploaded Archive"}</span></div>
                      <div>{modalProgress}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setShowIngestModal(false);
                        setModalProgress(null);
                        setIngestPhase(0);
                      }}
                      className={`w-full mt-1.5 py-1.5 rounded-lg border text-[10px] font-mono transition uppercase font-bold ${
                        modalProgress.includes("failed") || modalProgress.includes("Error")
                          ? "border-red-500/20 hover:bg-red-500/10 text-red-400 hover:text-white"
                          : "border-arivuEmerald/20 hover:bg-arivuEmerald/10 text-arivuEmerald-light hover:text-white"
                      }`}
                    >
                      Dismiss Summary
                    </button>
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
