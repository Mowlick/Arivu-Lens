import React, { useState, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import { Terminal, Copy, Check, Search, Bug, ShieldCheck, Network, Clock, SquarePen, ChevronDown, FileText } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

const LOADING_STAGES = [
  "Analyzing repository...",
  "Building retrieval context...",
  "Generating architectural insights...",
  "Finalizing response..."
];

interface Source {
  file_path: string;
  file_name: string;
  start_line: number;
  end_line: number;
  language: string;
}

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: Source[];
  routing?: "local" | "server";
  attachedFiles?: string[];
}

interface ChatAreaProps {
  messages: Message[];
  isLoading: boolean;
  chatStarters?: {title: string, desc: string}[];

  onSendMessage: (text: string) => void;
  onSelectSourceFile: (path: string) => void;
  sessionsList?: any[];
  currentSessionId?: string | null;
  onNewChat?: () => void;
  onSelectSession?: (id: string) => void;
}

// Copy Code Button Helper Component
const CodeBlock: React.FC<{ children: string; className?: string }> = ({ children, className }) => {
  const [copied, setCopied] = useState(false);
  const lang = className?.replace("language-", "") || "code";

  const handleCopy = async () => {
    await navigator.clipboard.writeText(children);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="my-3 rounded-lg border dark:border-darkBorder border-gray-200 dark:bg-gray-950 bg-gray-100 overflow-hidden font-mono text-sm leading-relaxed">
      <div className="flex items-center justify-between px-4 py-2 border-b dark:border-white/5 border-gray-200 bg-white/[0.02] text-[10px] dark:text-gray-400 text-gray-600 font-mono">
        <span className="uppercase">{lang}</span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 hover:dark:text-gray-200 text-gray-800 transition"
        >
          {copied ? (
            <>
              <Check className="w-3 h-3 text-arivuEmerald" />
              <span className="text-arivuEmerald">Copied</span>
            </>
          ) : (
            <>
              <Copy className="w-3 h-3" />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>
      <pre className="p-4 overflow-x-auto">
        <code className={className}>{children}</code>
      </pre>
    </div>
  );
};

// Suggestions are now dynamically generated inside the component based on workspaceName


export const ChatArea: React.FC<ChatAreaProps> = ({
  messages,
  isLoading,
  chatStarters,
  onSendMessage,
  onSelectSourceFile,
  sessionsList = [],
  currentSessionId = null,
  onNewChat,
  onSelectSession
}) => {
  const [showSessionsDropdown, setShowSessionsDropdown] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [loadingStage, setLoadingStage] = useState(0);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading]);

  useEffect(() => {
    if (isLoading) {
      setLoadingStage(0);
      const interval = setInterval(() => {
        setLoadingStage(prev => (prev < LOADING_STAGES.length - 1 ? prev + 1 : prev));
      }, 2000);
      return () => clearInterval(interval);
    }
  }, [isLoading]);

  return (
    <div className="flex flex-col flex-1 h-full dark:bg-darkBg bg-gray-50/30 relative overflow-hidden">
      {/* Background radial overlay */}
      <div className="absolute right-[20%] top-[10%] w-[350px] h-[350px] brand-glow-indigo rounded-full pointer-events-none opacity-20"></div>
      <div className="absolute left-[15%] bottom-[15%] w-[350px] h-[350px] brand-glow-emerald rounded-full pointer-events-none opacity-20"></div>

      {/* Header with Sessions and New Chat */}
      <div className="absolute top-4 right-6 z-20 flex items-center gap-3">
        <div className="relative">
          <button 
            onClick={() => setShowSessionsDropdown(!showSessionsDropdown)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg border dark:border-white/5 border-gray-200 dark:bg-[#0c0d12]/80 bg-white/80 hover:border-arivuIndigo/40 transition text-xs font-mono dark:text-gray-400 text-gray-600 shadow-indigoGlow"
          >
            <Clock className="w-3.5 h-3.5" />
            <span>History</span>
            <ChevronDown className="w-3 h-3 ml-1" />
          </button>
          
          {showSessionsDropdown && (
            <div className="absolute top-full right-0 mt-2 w-64 max-h-80 overflow-y-auto rounded-xl border dark:border-white/10 border-gray-200 dark:bg-[#0b0c10] bg-white shadow-combinedGlow z-50">
              {sessionsList.length === 0 ? (
                <div className="p-4 text-center text-xs dark:text-gray-500 text-gray-500 font-mono">No previous sessions</div>
              ) : (
                sessionsList.map(s => {
                  const isActive = s.session_id === currentSessionId;
                  const preview = s.title || s.preview || "Empty Session";
                  const date = new Date(s.last_accessed).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
                  return (
                    <button
                      key={s.session_id}
                      onClick={() => {
                        onSelectSession?.(s.session_id);
                        setShowSessionsDropdown(false);
                      }}
                      className={`w-full text-left p-3 border-b dark:border-white/5 border-gray-100 last:border-0 hover:dark:bg-white/5 hover:bg-gray-50 transition ${isActive ? 'dark:bg-arivuIndigo/10 bg-arivuIndigo/5' : ''}`}
                    >
                      <div className={`text-[11px] font-mono mb-1 truncate ${isActive ? 'text-arivuIndigo' : 'dark:text-gray-300 text-gray-700'}`}>
                        {preview}
                      </div>
                      <div className="text-[9px] dark:text-gray-500 text-gray-400 font-sans">
                        {date}
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          )}
        </div>
        <button
          onClick={() => {
            onNewChat?.();
            setShowSessionsDropdown(false);
          }}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-arivuEmerald/30 dark:bg-arivuEmerald/10 bg-arivuEmerald/5 hover:bg-arivuEmerald/20 transition text-xs font-mono text-arivuEmerald shadow-emeraldGlow"
        >
          <SquarePen className="w-3.5 h-3.5" />
          <span>New Chat</span>
        </button>
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6 z-10 pt-20">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full max-w-4xl mx-auto text-center space-y-6">
            <div className="relative w-full flex flex-col items-center justify-center mb-4">
              <div className="w-24 h-24 rounded-3xl border dark:border-white/5 border-gray-200 dark:bg-[#0a0b10] bg-white/90 flex items-center justify-center shadow-emeraldGlow relative overflow-hidden mb-8">
                <div className="absolute inset-0 bg-gradient-to-br from-arivuEmerald/20 to-arivuIndigo/20 opacity-50"></div>
                <span className="text-5xl font-extrabold text-transparent bg-clip-text bg-gradient-to-br from-arivuEmerald to-arivuIndigo-light z-10 font-sans tracking-tighter">A</span>
              </div>
              
              <h2 className="text-3xl font-bold dark:text-gray-100 text-gray-900 tracking-tight">
                Your Codebase, Your Intelligence.
              </h2>
              <div className="text-arivuEmerald-light font-black tracking-widest text-[15px] uppercase py-3">
                100% LOCAL. 100% PRIVATE.
              </div>
              <p className="text-[13px] dark:text-gray-400 text-gray-500 leading-relaxed font-mono max-w-2xl mt-1">
                Arivu-Lens analyzes your codebase locally to help you understand, debug, and optimize your projects — all without sending a single byte of code over the internet.
              </p>
            </div>

            {/* Quick Suggestion Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 pt-6 text-center w-full">
              {(chatStarters && chatStarters.length > 0 ? chatStarters : [
                { title: "Explain this function", desc: "Get a detailed explanation of any function or logic." },
                { title: "Find potential bugs", desc: "Scan for issues, edge cases and improvements." },
                { title: "Suggest refactor", desc: "Improve code quality and maintainability." },
                { title: "Show dependencies", desc: "Visualize relationships and code dependencies." }
              ]).map((starter, idx) => (
                <button
                  key={idx}
                  onClick={() => onSendMessage(starter.title)}
                  className="p-5 rounded-2xl border dark:border-white/5 border-gray-200 dark:bg-[#0c0d12]/80 bg-gray-50 hover:dark:bg-[#0f1118] hover:bg-white hover:border-arivuIndigo/40 transition-all duration-300 hover:-translate-y-1 hover:shadow-indigoGlow flex flex-col items-center gap-3"
                >
                  <div className="w-10 h-10 rounded-full flex items-center justify-center text-arivuIndigo mb-1">
                    {idx % 4 === 0 ? <Search className="w-6 h-6 stroke-[1.5]" /> :
                     idx % 4 === 1 ? <Bug className="w-6 h-6 stroke-[1.5]" /> :
                     idx % 4 === 2 ? <ShieldCheck className="w-6 h-6 stroke-[1.5]" /> :
                     <Network className="w-6 h-6 stroke-[1.5]" />}
                  </div>
                  <h4 className="text-sm font-semibold dark:text-gray-200 text-gray-800">{starter.title}</h4>
                  <p className="text-[11px] dark:text-gray-500 text-gray-600 font-mono leading-relaxed px-2 line-clamp-3">{starter.desc}</p>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="max-w-3xl mx-auto space-y-6">
            <AnimatePresence mode="popLayout">
            {messages.map((msg) => {
              const isUser = msg.role === "user";
              return (
                <motion.div
                  initial={!isUser ? { opacity: 0, y: 20 } : false}
                  animate={!isUser ? { opacity: 1, y: 0 } : false}
                  transition={{ duration: 0.4, ease: "easeOut" }}
                  key={msg.id}
                  className={`flex gap-4 ${isUser ? "justify-end" : "justify-start"}`}
                >
                  {/* Avatar */}
                  {!isUser && (
                    <div className="w-7 h-7 rounded-lg border border-arivuIndigo/20 bg-arivuIndigo/10 flex items-center justify-center text-arivuIndigo shrink-0 mt-1">
                      <Terminal className="w-4 h-4" />
                    </div>
                  )}

                  {/* Message Bubble */}
                  <div className="max-w-[85%] flex flex-col gap-2">
                    <div
                      className={`px-4 py-3 rounded-2xl text-sm leading-relaxed border ${
                        isUser
                          ? "bg-arivuIndigo/15 border-arivuIndigo/30 dark:text-gray-100 text-gray-900 rounded-tr-none shadow-indigoGlow"
                          : "dark:bg-darkPanel bg-white/90 dark:border-darkBorder border-gray-200 dark:text-gray-300 text-gray-700 rounded-tl-none arivu-glass"
                      }`}
                    >
                      {isUser ? (
                        <>
                          <p className="whitespace-pre-wrap font-sans">
                            {msg.content.split(/(@[^\s]+)/).map((part, i) => 
                              part.startsWith('@') ? <span key={i} className="text-arivuIndigo dark:text-arivuIndigo-light font-bold bg-white/20 dark:bg-black/20 px-1 py-0.5 rounded">{part}</span> : part
                            )}
                          </p>
                          {msg.attachedFiles && msg.attachedFiles.length > 0 && (
                            <div className="flex flex-wrap gap-2 mt-2 pt-2 border-t border-arivuIndigo/20">
                              {msg.attachedFiles.map((f, i) => (
                                <span key={i} className="flex items-center gap-1 text-[10px] bg-white/20 dark:bg-black/20 px-1.5 py-0.5 rounded font-mono">
                                  <FileText className="w-3 h-3" /> {f.split(/[/\\]/).pop()}
                                </span>
                              ))}
                            </div>
                          )}
                        </>
                      ) : (
                        <div className="prose dark:prose-invert max-w-none text-sm space-y-2.5 font-sans">
                          <ReactMarkdown
                            components={{
                              code: ({ node, className, children, ...props }) => {
                                const match = /language-(\w+)/.exec(className || "");
                                const codeString = String(children).replace(/\n$/, "");
                                return match ? (
                                  <CodeBlock className={className} children={codeString} />
                                ) : (
                                  <code className="dark:bg-gray-800/80 bg-gray-200 px-1.5 py-0.5 rounded font-mono text-xs dark:text-arivuEmerald-light text-arivuEmerald-dark" {...props}>
                                    {children}
                                  </code>
                                );
                              }
                            }}
                          >
                            {msg.content}
                          </ReactMarkdown>
                        </div>
                      )}
                    </div>

                    {/* Retreived Sources & Routing Mode */}
                    {!isUser && (msg.routing || (msg.sources && msg.sources.length > 0)) && (
                      <div className="mt-2 border-t dark:border-slate-800/50 border-gray-200/50 pt-2 px-1">
                        <p className="text-[10px] text-slate-500 uppercase font-mono tracking-wider mb-1.5 flex items-center gap-2">
                          Context Used
                          {msg.routing && (
                            <span className={`text-[8px] font-mono px-1.5 py-0.5 rounded border ${
                              msg.routing === "local"
                                ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
                                : "bg-indigo-500/10 border-indigo-500/20 text-indigo-400"
                            }`}>
                              {msg.routing === "local" ? "⚡ Local" : "🔍 Graph RAG"}
                            </span>
                          )}
                        </p>
                        {msg.sources && msg.sources.length > 0 && (
                          <div className="flex flex-wrap gap-2">
                            {msg.sources.map((src, sIdx) => (
                              <button
                                key={sIdx}
                                onClick={() => onSelectSourceFile(src.file_path)}
                                className="text-[11px] text-emerald-400 bg-emerald-500/10 px-2 py-1 rounded border border-emerald-500/20 cursor-pointer hover:bg-emerald-500/20 transition-colors font-mono"
                                title={`${src.file_path} (Lines ${src.start_line}-${src.end_line})`}
                              >
                                {src.file_name} <span className="opacity-60">(L{src.start_line}-{src.end_line})</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* User Avatar */}
                  {isUser && (
                    <div className="w-7 h-7 rounded-lg border border-arivuEmerald/20 bg-arivuEmerald/10 flex items-center justify-center text-arivuEmerald shrink-0 mt-1">
                      <span className="text-xs font-bold font-mono">U</span>
                    </div>
                  )}
                </motion.div>
              );
            })}
            
            {/* Thinking / Streaming Indicator */}
            {isLoading && (
              <motion.div 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="flex gap-4 justify-start"
              >
                <div className="w-7 h-7 rounded-lg border border-arivuIndigo/20 bg-arivuIndigo/10 flex items-center justify-center text-arivuIndigo shrink-0 mt-1 animate-pulse">
                  <Terminal className="w-4 h-4" />
                </div>
                <div className="dark:bg-darkPanel bg-white/40 border dark:border-darkBorder border-gray-200/40 text-xs px-4 py-2.5 rounded-2xl rounded-tl-none text-gray-500 font-mono arivu-glass flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-arivuIndigo animate-bounce" style={{ animationDelay: "0ms" }}></span>
                  <span className="w-1.5 h-1.5 rounded-full bg-arivuIndigo animate-bounce" style={{ animationDelay: "150ms" }}></span>
                  <span className="w-1.5 h-1.5 rounded-full bg-arivuIndigo animate-bounce" style={{ animationDelay: "300ms" }}></span>
                  <span>{LOADING_STAGES[loadingStage]}</span>
                </div>
              </motion.div>
            )}
            </AnimatePresence>

            <div ref={messagesEndRef} />
          </div>
        )}
      </div>
    </div>
  );
};
