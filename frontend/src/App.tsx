import { useState, useEffect } from "react";
import { FileTree } from "./components/FileTree";
import { ChatArea } from "./components/ChatArea";
import { CodeViewer } from "./components/CodeViewer";
import { useNativeFS } from "./hooks/useNativeFS";
import { useNativeDragAndDrop } from "./hooks/useNativeDragAndDrop";
import { WebLLMRouter } from "./router/webllm_router";
import { 
  ShieldCheck, 
  Lock, 
  Database, 
  Cpu, 
  Layers, 
  Search, 
  Folder, 
  ChevronRight, 
  Paperclip, 
  Send, 
  Terminal, 
  Sun, 
  Info, 
  Activity, 
  Compass,
  X,
  Loader2,
  CheckCircle2,
  FolderOpen
} from "lucide-react";

const API_BASE = "http://localhost:11411/api";

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
  const [ingestPhase, setIngestPhase] = useState<0 | 1 | 2 | 3>(0); // 0=idle, 1=AST, 2=Graph, 3=Vector
  const [activeTab, setActiveTab] = useState<"path" | "zip">("path");
  
  // Infrastructure Diagnostics State
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

  const refreshFiles = async () => {
    try {
      const res = await fetch(`${API_BASE}/files`);
      if (res.ok) {
        const data = await res.json();
        setFiles(data.files || []);
      }
    } catch (err) {
      console.error("Failed to fetch indexed files:", err);
    }
  };

  const checkWorkspace = async () => {
    try {
      const res = await fetch(`${API_BASE}/health`);
      if (res.ok) {
        const data = await res.json();
        if (data.active_workspace) {
          setWorkspacePath(data.active_workspace);
          refreshFiles();
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

  const handleSendMessage = async (text: string) => {
    const userMessageId = `user_${Date.now()}`;
    const userMessage: Message = {
      id: userMessageId,
      role: "user",
      content: text
    };

    setMessages(prev => [...prev, userMessage]);
    setIsLoading(true);

    const assistantMessageId = `assistant_${Date.now()}`;
    
    // Default intent is graph_rag. If WebLLM router is ready, evaluate intent.
    let route: "local_chat" | "graph_rag" = "graph_rag";
    if (webLlmRouter && routerState === "ready") {
      try {
        route = await webLlmRouter.routePrompt(text);
      } catch (err) {
        console.warn("Local prompt routing failed, falling back to server RAG:", err);
      }
    }

    setMessages(prev => [...prev, {
      id: assistantMessageId,
      role: "assistant",
      content: "",
      sources: [],
      routing: route === "local_chat" ? "local" : "server"
    }]);

    if (route === "local_chat" && webLlmRouter) {
      try {
        let accumulatedText = "";
        await webLlmRouter.generateInstantChat(text, (token) => {
          accumulatedText += token;
          setMessages(prev =>
            prev.map(m =>
              m.id === assistantMessageId
                ? { ...m, content: accumulatedText }
                : m
            )
          );
        });
        setIsLoading(false);
        return;
      } catch (err) {
        console.warn("WebLLM local generation failed, falling back to server RAG:", err);
        // If local execution crashes mid-way, update the indicator to show server fallback
        setMessages(prev =>
          prev.map(m =>
            m.id === assistantMessageId
              ? { ...m, routing: "server" }
              : m
          )
        );
      }
    }

    // Server-side Graph RAG Pipeline
    try {
      const res = await fetch(`${API_BASE}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: text, n_results: 5 }),
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
              setMessages(prev =>
                prev.map(m =>
                  m.id === assistantMessageId
                    ? { ...m, sources: retrievedSources }
                    : m
                )
              );
            } else if (parsed.type === "content") {
              accumulatedText += parsed.text;
              setMessages(prev =>
                prev.map(m =>
                  m.id === assistantMessageId
                    ? { ...m, content: accumulatedText }
                    : m
                )
              );
            }
          } catch (e) {
            // Keep parsing lines if one fails
          }
        }
      }
    } catch (err: any) {
      setMessages(prev =>
        prev.map(m =>
          m.id === assistantMessageId
            ? { ...m, content: `*Inference error: ${err.message || "Failed to obtain response from Ollama Qwen model."}*` }
            : m
        )
      );
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex h-screen w-screen bg-[#030306] text-gray-200 overflow-hidden font-sans relative">
      {isDragging && (
        <div className="absolute inset-0 bg-[#030306]/85 backdrop-blur-md z-50 flex items-center justify-center p-8 pointer-events-none">
          <div className="w-full h-full border-2 border-dashed border-arivuEmerald/40 rounded-3xl bg-[#0a0b10]/60 flex flex-col items-center justify-center gap-4 animate-pulse">
            <div className="w-20 h-20 rounded-2xl border border-arivuEmerald/50 bg-[#0c0d12]/95 flex items-center justify-center text-arivuEmerald shadow-emeraldGlow glow-glow">
              <FolderOpen className="w-10 h-10 stroke-[1.5]" />
            </div>
            <div className="space-y-1 text-center">
              <h3 className="text-xl font-bold tracking-wide text-gray-200">Drop to Index Codebase</h3>
              <p className="text-xs font-mono text-gray-500 max-w-sm leading-relaxed">
                Release your repository folder to automatically parse the syntax structures and build the relational Code Graph RAG database.
              </p>
            </div>
          </div>
        </div>
      )}
      
      {/* ==================== 1. LEFT COLUMN ==================== */}
      <aside className="w-80 shrink-0 border-r border-white/[0.04] bg-[#07080b]/90 flex flex-col h-full z-10">
        
        {/* Card 1: Ingest Codebase */}
        <div className="p-5 border-b border-white/[0.04] flex flex-col gap-4">
          <h3 className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Ingest Codebase</h3>
          
          {workspacePath ? (
            <div className="p-4 rounded-xl border border-white/[0.03] bg-white/[0.01] flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-arivuEmerald/10 flex items-center justify-center text-arivuEmerald">
                  <FolderOpen className="w-4 h-4" />
                </div>
                <div className="overflow-hidden">
                  <h4 className="text-xs font-semibold text-gray-200 truncate" title={workspacePath}>
                    {workspacePath.split(/[/\\]/).pop()}
                  </h4>
                  <p className="text-[9px] font-mono text-gray-500 truncate" title={workspacePath}>
                    {workspacePath}
                  </p>
                </div>
              </div>
              
              <div className="flex gap-2">
                <button
                  onClick={isTauri ? handleNativeFolderSelect : () => setShowIngestModal(true)}
                  className="flex-1 text-[10px] font-mono border border-white/5 hover:border-arivuIndigo/40 hover:bg-white/5 rounded-lg py-1.5 transition text-gray-400"
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
            <div className="p-5 rounded-xl border border-white/[0.03] bg-white/[0.01] text-center flex flex-col items-center gap-3">
              <div className="w-12 h-12 rounded-full border border-dashed border-white/10 flex items-center justify-center text-gray-600 mb-1">
                <Folder className="w-5 h-5 stroke-[1.5]" />
              </div>
              <div className="space-y-1">
                <h4 className="text-xs font-semibold text-gray-300">No codebase loaded</h4>
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
          
          <div className="flex-1 min-h-0 border border-white/[0.03] bg-white/[0.01] rounded-xl overflow-hidden flex flex-col">
            {files.length > 0 ? (
              <FileTree
                files={files}
                activeFile={activeFile}
                onSelectFile={(path) => setActiveFile(path)}
              />
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center p-6 text-center gap-2">
                <Folder className="w-8 h-8 text-gray-800 stroke-[1.2] mb-1" />
                <h4 className="text-xs font-medium text-gray-400">No files to display</h4>
                <p className="text-[10px] text-gray-600 leading-relaxed font-mono">
                  Ingest a codebase to explore its structure here.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Stats footer row */}
        <div className="px-5 pb-3 pt-1 grid grid-cols-3 gap-2.5">
          <div className="p-2.5 rounded-xl border border-white/[0.03] bg-[#0c0d12]/50 text-center font-mono">
            <div className="text-[9px] text-gray-500">Files</div>
            <div className="text-xs font-bold text-gray-300 mt-1">{files.length > 0 ? files.length : "—"}</div>
          </div>
          <div className="p-2.5 rounded-xl border border-white/[0.03] bg-[#0c0d12]/50 text-center font-mono">
            <div className="text-[9px] text-gray-500">Chunks</div>
            <div className="text-xs font-bold text-gray-300 mt-1">{chunksCount > 0 ? chunksCount : "—"}</div>
          </div>
          <div className="p-2.5 rounded-xl border border-white/[0.03] bg-[#0c0d12]/50 text-center font-mono">
            <div className="text-[9px] text-gray-500">Size</div>
            <div className="text-xs font-bold text-gray-300 mt-1">
              {workspaceSizeKb > 0 
                ? workspaceSizeKb > 1024 
                  ? `${(workspaceSizeKb / 1024).toFixed(1)} MB` 
                  : `${workspaceSizeKb} KB` 
                : "—"
              }
            </div>
          </div>
        </div>

        {/* Bottom bar button */}
        <div className="p-5 pt-0">
          <button className="w-full flex items-center justify-between px-4 py-2.5 border border-white/[0.03] hover:border-white/10 bg-[#0c0d12]/40 rounded-xl text-[10px] font-mono text-gray-500 hover:text-gray-300 transition">
            <span className="flex items-center gap-1.5"><Activity className="w-3.5 h-3.5 text-arivuIndigo" /> View Ingestion History</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </aside>

      {/* ==================== 2. CENTER Q&A COLUMN ==================== */}
      <main className="flex-1 flex flex-col h-full border-r border-white/[0.04] relative">
        
        {/* App Header Banner */}
        <header className="px-6 py-4 border-b border-white/[0.04] bg-[#07080b]/90 flex items-center justify-between backdrop-blur-md">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-arivuIndigo to-arivuEmerald flex items-center justify-center text-white glow-glow">
              <ShieldCheck className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-sm font-extrabold tracking-wider uppercase text-gray-100">
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
            <div className="flex items-center gap-2 px-3 py-1 rounded-full border border-white/[0.03] bg-[#0c0d12] text-[10px] font-mono">
              <span className={`w-1.5 h-1.5 rounded-full ${health?.ollama_connection === "online" ? "bg-arivuEmerald animate-pulse" : "bg-red-500"}`}></span>
              <span className="text-gray-400">Ollama (local)</span>
              <span className="text-gray-600">|</span>
              <span className="text-arivuEmerald-light font-semibold">
                {health?.ollama_connection === "online" ? "Connected" : "Disconnected"}
              </span>
            </div>

            {/* Tauri and WebGPU badge */}
            <div className="flex items-center gap-2 px-3 py-1 rounded-full border border-white/[0.03] bg-[#0c0d12] text-[10px] font-mono">
              <span className={`w-1.5 h-1.5 rounded-full ${isTauri ? "bg-arivuIndigo animate-pulse" : "bg-gray-500"}`}></span>
              <span className="text-gray-400">{isTauri ? "Tauri App" : "Web Client"}</span>
              <span className="text-gray-600">|</span>
              <span className={`font-semibold ${routerState === "ready" ? "text-arivuEmerald-light" : "text-gray-500"}`}>
                {routerState === "ready" ? "WebGPU Active" : "WebGPU Standby"}
              </span>
            </div>
            
            {/* Action buttons */}
            <button className="p-1.5 text-gray-500 hover:text-gray-300 transition hover:bg-white/5 rounded-lg border border-white/[0.03]">
              <Sun className="w-4 h-4" />
            </button>
            <div className="w-7 h-7 rounded-full border border-white/10 bg-[#0c0d12] text-xs font-extrabold flex items-center justify-center text-arivuIndigo select-none">
              K
            </div>
          </div>
        </header>

        {/* Code Q&A Viewport */}
        <div className="flex-1 overflow-hidden relative flex flex-col">
          {files.length === 0 ? (
            /* Orbital Empty State */
            <div className="flex-1 overflow-y-auto flex flex-col items-center justify-center p-8 text-center relative">
              
              {/* Circular Orbit layout */}
              <div className="relative w-80 h-80 mb-6 flex items-center justify-center select-none">
                {/* Rings */}
                <div className="orbit-ring w-[280px] h-[160px] opacity-20" style={{ animationDuration: '40s' }}></div>
                <div className="orbit-ring w-[220px] h-[120px] opacity-40" style={{ animationDuration: '30s', animationDirection: 'reverse' }}></div>
                <div className="orbit-ring w-[160px] h-[90px] opacity-60" style={{ animationDuration: '20s' }}></div>
                
                {/* Orbiting Icons */}
                <div className="absolute top-[18%] left-[20%] w-7 h-7 rounded-lg border border-white/5 bg-[#0b0c10]/90 flex items-center justify-center text-arivuIndigo/70 text-xs font-mono glow-violet">
                  &lt;/&gt;
                </div>
                <div className="absolute top-[18%] right-[20%] w-7 h-7 rounded-lg border border-white/5 bg-[#0b0c10]/90 flex items-center justify-center text-arivuEmerald-light/70 text-xs font-mono glow-glow">
                  &gt;_
                </div>
                <div className="absolute bottom-[10%] left-[45%] w-7 h-7 rounded-lg border border-white/5 bg-[#0b0c10]/90 flex items-center justify-center text-gray-500 text-xs">
                  <Terminal className="w-3.5 h-3.5" />
                </div>
                
                {/* Central Neon Folder */}
                <div className="w-20 h-20 rounded-2xl border border-arivuEmerald bg-[#0a0b10]/90 flex items-center justify-center text-arivuEmerald shadow-emeraldGlow z-10 glow-glow">
                  <Folder className="w-8 h-8 stroke-[1.5]" />
                </div>
              </div>

              {/* Central text block */}
              <div className="max-w-md space-y-3 z-10">
                <h2 className="text-xl font-bold text-gray-100 tracking-wide">
                  Your Codebase, Your Intelligence.
                </h2>
                <h3 className="text-sm font-extrabold text-arivuEmerald-light tracking-wider font-mono uppercase">
                  100% Local. 100% Private.
                </h3>
                <p className="text-xs text-gray-500 leading-relaxed font-mono">
                  Arivu-Lens analyzes your codebase locally to help you understand, debug, and optimize your projects — all without sending a single byte of code over the internet.
                </p>
                
                <div className="pt-4">
                  <button
                    onClick={isTauri ? handleNativeFolderSelect : () => setShowIngestModal(true)}
                    className="inline-flex items-center gap-2 border border-white/[0.04] hover:border-arivuIndigo/50 bg-[#0c0d12]/60 hover:bg-[#0c0d12] text-xs font-mono text-gray-400 hover:text-gray-200 px-4 py-2.5 rounded-xl transition shadow-indigoGlow"
                  >
                    <span>← {isTauri ? "Select a codebase directory (Native)" : "Ingest a codebase from the left to begin"}</span>
                  </button>
                </div>
              </div>
            </div>
          ) : (
            /* Chat window loaded */
            <div className="flex-1 overflow-hidden flex flex-col">
              <ChatArea
                messages={messages}
                isLoading={isLoading}
                onSendMessage={handleSendMessage}
                onSelectSourceFile={(path) => setActiveFile(path)}
              />
            </div>
          )}
        </div>

        {/* Input bar bottom (Only shown when files are loaded to match Q&A) */}
        {files.length > 0 && (
          <div className="p-5 border-t border-white/[0.04] bg-[#07080b]/80 backdrop-blur-md relative z-10">
            <div className="max-w-3xl mx-auto border border-white/[0.04] hover:border-white/10 rounded-2xl bg-[#0b0c10] p-3 flex flex-col gap-3 focus-within:border-arivuIndigo/40 transition shadow-combinedGlow">
              <textarea
                rows={1}
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="Ask anything about your codebase..."
                disabled={isLoading}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    if (!chatInput.trim() || isLoading) return;
                    handleSendMessage(chatInput.trim());
                    setChatInput("");
                  }
                }}
                className="w-full text-sm bg-transparent border-0 focus:outline-none focus:ring-0 text-gray-200 resize-none placeholder:text-gray-700 min-h-[24px] max-h-36 font-sans px-1"
              />
              
              {/* Bottom control panel inside textbox */}
              <div className="flex items-center justify-between border-t border-white/[0.02] pt-2">
                <div className="flex items-center gap-1.5 text-xs text-gray-500 font-mono">
                  <button className="flex items-center gap-1 hover:text-gray-300 border border-white/[0.03] hover:border-white/5 bg-white/[0.01] hover:bg-white/[0.03] px-2.5 py-1 rounded-md transition text-[10px]">
                    <Folder className="w-3.5 h-3.5 text-arivuIndigo" /> Files
                  </button>
                  <button className="flex items-center gap-1 hover:text-gray-300 border border-white/[0.03] hover:border-white/5 bg-white/[0.01] hover:bg-white/[0.03] px-2.5 py-1 rounded-md transition text-[10px]">
                    <Search className="w-3.5 h-3.5 text-arivuEmerald" /> Search
                  </button>
                  <button className="flex items-center gap-1 hover:text-gray-300 border border-white/[0.03] hover:border-white/5 bg-white/[0.01] hover:bg-white/[0.03] px-2.5 py-1 rounded-md transition text-[10px]">
                    <Layers className="w-3.5 h-3.5 text-arivuIndigo" /> Graph
                  </button>
                  <button className="p-1 hover:text-gray-300 transition ml-1" title="Attach file">
                    <Paperclip className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-[9px] text-gray-600 font-mono hidden md:inline">
                    Enter to send • Shift+Enter for new line
                  </span>
                  
                  <button
                    onClick={() => {
                      if (!chatInput.trim() || isLoading) return;
                      handleSendMessage(chatInput.trim());
                      setChatInput("");
                    }}
                    disabled={isLoading || !chatInput.trim()}
                    className="w-8 h-8 rounded-lg bg-arivuIndigo hover:bg-arivuIndigo-dark text-white flex items-center justify-center transition disabled:opacity-40 shadow-indigoGlow shrink-0 glow-violet"
                  >
                    <Send className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
            
            <div className="max-w-3xl mx-auto flex justify-between px-2 pt-2 text-[9px] font-mono text-gray-600">
              <span>100% Private - Air-gapped Mode</span>
              <span>No context loaded</span>
            </div>
          </div>
        )}
      </main>

      {/* ==================== 3. RIGHT INFRASTRUCTURE COLUMN ==================== */}
      <aside className="w-76 shrink-0 bg-[#07080b]/90 flex flex-col h-full z-10 overflow-y-auto">
        
        {/* Card 1: AI & Infrastructure */}
        <div className="p-5 border-b border-white/[0.04] flex flex-col gap-4">
          <h3 className="text-[10px] font-bold uppercase tracking-wider text-gray-500">AI & Infrastructure</h3>
          
          <div className="space-y-3.5">
            {/* Sub-card 1: Model */}
            <div className="p-3.5 rounded-xl border border-white/[0.03] bg-[#0c0d12]/50 flex flex-col gap-3">
              <div className="flex items-center justify-between border-b border-white/[0.02] pb-2">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-violet-500/10 flex items-center justify-center text-violet-400 border border-violet-500/10 glow-violet">
                    <Cpu className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-[8px] font-bold font-mono text-gray-500 uppercase">Model (Ollama Local)</div>
                    <div className="text-xs font-extrabold text-gray-200 mt-0.5">{health?.llm_model?.split(":")[0] || "qwen2.5-coder"}</div>
                  </div>
                </div>
                <div className="flex items-center gap-1 text-[9px] font-mono px-2 py-0.5 rounded border border-arivuEmerald/10 bg-arivuEmerald/5 text-arivuEmerald-light">
                  <span className="w-1 h-1 rounded-full bg-arivuEmerald"></span> Running
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 text-[9px] font-mono text-gray-500">
                <div>
                  <div className="text-[8px] text-gray-600">Provider</div>
                  <div className="text-gray-400 mt-0.5">Ollama Local</div>
                </div>
                <div>
                  <div className="text-[8px] text-gray-600">Mode</div>
                  <div className="text-gray-400 mt-0.5">Local Inference</div>
                </div>
              </div>
            </div>

            {/* Sub-card 2: Embeddings */}
            <div className="p-3.5 rounded-xl border border-white/[0.03] bg-[#0c0d12]/50 flex flex-col gap-3">
              <div className="flex items-center justify-between border-b border-white/[0.02] pb-2">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-arivuEmerald/10 flex items-center justify-center text-arivuEmerald border border-arivuEmerald/10 glow-glow">
                    <Compass className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-[8px] font-bold font-mono text-gray-500 uppercase">Embedding Model</div>
                    <div className="text-xs font-extrabold text-gray-200 mt-0.5">{health?.embedding_model || "nomic-embed-text"}</div>
                  </div>
                </div>
                <div className="flex items-center gap-1 text-[9px] font-mono px-2 py-0.5 rounded border border-arivuEmerald/10 bg-arivuEmerald/5 text-arivuEmerald-light">
                  <span className="w-1 h-1 rounded-full bg-arivuEmerald animate-pulse"></span> Ready
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 text-[9px] font-mono text-gray-500">
                <div>
                  <div className="text-[8px] text-gray-600">Dimensions</div>
                  <div className="text-gray-400 mt-0.5">768</div>
                </div>
                <div>
                  <div className="text-[8px] text-gray-600">Status</div>
                  <div className="text-gray-400 mt-0.5">Connected</div>
                </div>
              </div>
            </div>

            {/* Sub-card 3: Vector Database */}
            <div className="p-3.5 rounded-xl border border-white/[0.03] bg-[#0c0d12]/50 flex flex-col gap-3">
              <div className="flex items-center justify-between border-b border-white/[0.02] pb-2">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-arivuIndigo/10 flex items-center justify-center text-arivuIndigo border border-arivuIndigo/10 shadow-indigoGlow">
                    <Database className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-[8px] font-bold font-mono text-gray-500 uppercase">Vector Database (ChromaDB)</div>
                    <div className="text-xs font-extrabold text-gray-200 mt-0.5">
                      {files.length > 0 ? "ChromaDB Store" : "Not Initialized"}
                    </div>
                  </div>
                </div>
                
                {files.length > 0 ? (
                  <div className="flex items-center gap-1 text-[9px] font-mono px-2 py-0.5 rounded border border-arivuEmerald/10 bg-arivuEmerald/5 text-arivuEmerald-light">
                    <span className="w-1 h-1 rounded-full bg-arivuEmerald"></span> Active
                  </div>
                ) : (
                  <div className="flex items-center gap-1 text-[9px] font-mono px-2 py-0.5 rounded border border-yellow-500/10 bg-yellow-500/5 text-yellow-400">
                    <span className="w-1 h-1 rounded-full bg-yellow-500"></span> Idle
                  </div>
                )}
              </div>
              
              <div className="grid grid-cols-3 gap-1 text-[9px] font-mono text-gray-500">
                <div>
                  <div className="text-[7px] text-gray-600 uppercase">Storage</div>
                  <div className="text-gray-400 mt-0.5">{files.length > 0 ? "4.2 MB" : "—"}</div>
                </div>
                <div>
                  <div className="text-[7px] text-gray-600 uppercase">Vectors</div>
                  <div className="text-gray-400 mt-0.5">{chunksCount > 0 ? chunksCount : "—"}</div>
                </div>
                <div>
                  <div className="text-[7px] text-gray-600 uppercase">Colls</div>
                  <div className="text-gray-400 mt-0.5">{files.length > 0 ? "1" : "—"}</div>
                </div>
              </div>
            </div>

            {/* Sub-card 4: WebLLM Intent Router */}
            <div className="p-3.5 rounded-xl border border-white/[0.03] bg-[#0c0d12]/50 flex flex-col gap-3">
              <div className="flex items-center justify-between border-b border-white/[0.02] pb-2">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-emerald-500/10 flex items-center justify-center text-emerald-400 border border-emerald-500/10 glow-glow">
                    <Layers className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-[8px] font-bold font-mono text-gray-500 uppercase">WebLLM Intent Router</div>
                    <div className="text-xs font-extrabold text-gray-200 mt-0.5">Qwen2.5-0.5B</div>
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
                  <div className="flex items-center gap-1 text-[9px] font-mono px-2 py-0.5 rounded border border-gray-500/10 bg-gray-500/5 text-gray-400">
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
                <div className="grid grid-cols-2 gap-2 text-[9px] font-mono text-gray-500">
                  <div>
                    <div className="text-[8px] text-gray-600">Hardware Accel</div>
                    <div className="text-arivuEmerald-light mt-0.5 font-semibold">WebGPU Active</div>
                  </div>
                  <div>
                    <div className="text-[8px] text-gray-600">Auto Routing</div>
                    <div className="text-gray-400 mt-0.5">Enabled</div>
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
          
          <div className="p-5 rounded-xl border border-white/[0.03] bg-[#0c0d12]/30 text-center flex flex-col items-center gap-4">
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
            <ul className="w-full text-[10px] font-mono text-gray-400 space-y-2 text-left pt-2 border-t border-white/[0.02]">
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

      {/* ==================== 4. SLIDING CODE PREVIEW PANEL ==================== */}
      {activeFile && (
        <CodeViewer
          filePath={activeFile}
          onClose={() => setActiveFile(null)}
        />
      )}

      {/* ==================== 5. GLASSMORPHIC INGESTION MODAL ==================== */}
      {showIngestModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-[450px] border border-white/[0.04] bg-[#0c0d12]/95 backdrop-blur-lg rounded-2xl p-6 arivu-glass shadow-combinedGlow flex flex-col gap-5 relative animate-in scale-in duration-200">
            
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
              className="absolute right-4 top-4 p-1 hover:text-white text-gray-400 rounded hover:bg-white/5 transition disabled:opacity-30"
            >
              <X className="w-4 h-4" />
            </button>
            
            <div className="space-y-1">
              <h2 className="text-sm font-extrabold tracking-wide uppercase text-gray-100 flex items-center gap-2">
                <FolderOpen className="w-4 h-4 text-arivuIndigo" /> Ingest Local Codebase
              </h2>
              <p className="text-[10px] text-gray-500 font-mono">
                Index repository folders or zip archives locally into ChromaDB.
              </p>
            </div>

            {/* Ingestion Tabs */}
            <div className="flex border-b border-white/[0.04] text-xs font-mono text-gray-500">
              <button
                onClick={() => setActiveTab("path")}
                disabled={modalLoading}
                className={`flex-1 py-2 text-center border-b-2 transition ${activeTab === "path" ? "text-arivuIndigo-light border-arivuIndigo font-bold" : "border-transparent hover:text-gray-300"}`}
              >
                Local Path Ingest
              </button>
              <button
                onClick={() => setActiveTab("zip")}
                disabled={modalLoading}
                className={`flex-1 py-2 text-center border-b-2 transition ${activeTab === "zip" ? "text-arivuEmerald-light border-arivuEmerald font-bold" : "border-transparent hover:text-gray-300"}`}
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
                      className="flex-1 text-xs bg-darkBg/90 border border-white/5 hover:border-white/10 focus:border-arivuIndigo focus:ring-1 focus:ring-arivuIndigo focus:outline-none rounded-lg px-3 py-2.5 text-gray-200 transition font-mono placeholder:text-gray-700"
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
                      className="px-3 border border-white/5 hover:border-arivuIndigo/40 bg-white/[0.02] hover:bg-arivuIndigo/5 rounded-lg text-gray-400 hover:text-white transition flex items-center justify-center"
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
                  
                  <div className="relative border border-dashed border-white/10 hover:border-arivuEmerald/40 rounded-xl py-6 px-4 text-center transition cursor-pointer bg-darkBg/30 flex flex-col items-center justify-center gap-2">
                    <input
                      type="file"
                      accept=".zip"
                      disabled={modalLoading}
                      onChange={handleZipUpload}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed"
                    />
                    <Folder className="w-8 h-8 text-gray-600 stroke-[1.2]" />
                    <span className="text-xs text-gray-400 font-medium font-mono">Drag or click to choose .zip repository</span>
                    <span className="text-[9px] text-gray-600 font-mono">Max volume: 150MB</span>
                  </div>
                </div>
              </div>
            )}

            {/* Modal Progress diagnostics */}
            {(modalLoading || modalProgress) && (
              <div className="flex flex-col gap-3.5 border-t border-white/[0.02] pt-4 mt-2">
                {modalLoading ? (
                  <div className="space-y-3">
                    {/* Animated Progress Bar */}
                    <div className="h-1.5 w-full bg-white/[0.03] rounded-full overflow-hidden relative">
                      <div className="absolute top-0 bottom-0 left-0 bg-gradient-to-r from-arivuIndigo to-arivuEmerald rounded-full animate-progressLine w-1/2"></div>
                    </div>
                    
                    {/* Diagnostic Checklist */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-[10px] font-mono text-gray-400">
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
                            : "bg-white/[0.01] border-white/[0.04] text-gray-600"
                        }`}>
                          <span className="font-extrabold uppercase">Phase 1</span>
                          <span>AST parsing</span>
                        </div>
                        <div className={`p-2 rounded-lg border text-center font-mono text-[9px] flex flex-col gap-1 transition-all ${
                          ingestPhase >= 2
                            ? "bg-arivuIndigo/10 border-arivuIndigo/30 text-arivuIndigo-light"
                            : "bg-white/[0.01] border-white/[0.04] text-gray-600"
                        }`}>
                          <span className="font-extrabold uppercase">Phase 2</span>
                          <span>Graph mapping</span>
                        </div>
                        <div className={`p-2 rounded-lg border text-center font-mono text-[9px] flex flex-col gap-1 transition-all ${
                          ingestPhase >= 3
                            ? "bg-arivuIndigo/10 border-arivuIndigo/30 text-arivuIndigo-light"
                            : "bg-white/[0.01] border-white/[0.04] text-gray-600"
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
                    <div className="text-[10px] text-gray-400 font-mono leading-relaxed space-y-1">
                      <div className="truncate"><strong className="text-gray-300">Target Path:</strong> <span className="text-gray-500">{dirPath || workspacePath || "Uploaded Archive"}</span></div>
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
