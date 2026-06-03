import React, { useState, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import { Terminal, Copy, Check, FileText, Sparkles, MessageSquare } from "lucide-react";

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

interface ChatAreaProps {
  messages: Message[];
  isLoading: boolean;
  onSendMessage: (text: string) => void;
  onSelectSourceFile: (path: string) => void;
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
    <div className="my-3 rounded-lg border border-darkBorder bg-gray-950 overflow-hidden font-mono text-sm leading-relaxed">
      <div className="flex items-center justify-between px-4 py-2 border-b border-white/5 bg-white/[0.02] text-[10px] text-gray-400 font-mono">
        <span className="uppercase">{lang}</span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 hover:text-gray-200 transition"
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

const SUGGESTIONS = [
  "What is the main architecture and tech stack of this repository?",
  "Analyze this codebase for potential bugs, security issues, or code smell.",
  "Where are the core database configurations and endpoints initialized?",
  "Explain how chunking and vector storage are set up in this system."
];

export const ChatArea: React.FC<ChatAreaProps> = ({
  messages,
  isLoading,
  onSendMessage,
  onSelectSourceFile
}) => {
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  return (
    <div className="flex flex-col flex-1 h-full bg-darkBg/30 relative overflow-hidden">
      {/* Background radial overlay */}
      <div className="absolute right-[20%] top-[10%] w-[350px] h-[350px] brand-glow-indigo rounded-full pointer-events-none opacity-20"></div>
      <div className="absolute left-[15%] bottom-[15%] w-[350px] h-[350px] brand-glow-emerald rounded-full pointer-events-none opacity-20"></div>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6 z-10">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full max-w-xl mx-auto text-center space-y-5">
            <div className="p-4 rounded-full border border-arivuIndigo/20 bg-arivuIndigo/5 shadow-indigoGlow animate-pulse">
              <Sparkles className="w-8 h-8 text-arivuIndigo" />
            </div>
            
            <div className="space-y-2">
              <h3 className="text-lg font-semibold tracking-wide text-gray-200">Chat with Compi-Lens AI</h3>
              <p className="text-xs text-gray-400 leading-relaxed font-mono">
                Ask architectural questions, locate file structures, find bugs, or dissect complex functions. Ingest your workspace or upload a ZIP file above to begin.
              </p>
            </div>

            {/* Quick Suggestion Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 pt-4 text-left w-full">
              {SUGGESTIONS.map((text, idx) => (
                <button
                  key={idx}
                  onClick={() => onSendMessage(text)}
                  className="p-3 text-xs text-gray-400 hover:text-gray-200 rounded-xl border border-darkBorder bg-darkPanel/50 hover:bg-darkPanel hover:border-arivuIndigo/40 transition arivu-glass arivu-glass-hover text-left flex items-start gap-2.5 leading-relaxed font-mono"
                >
                  <MessageSquare className="w-3.5 h-3.5 text-arivuIndigo shrink-0 mt-0.5" />
                  <span>{text}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="max-w-3xl mx-auto space-y-6">
            {messages.map((msg) => {
              const isUser = msg.role === "user";
              return (
                <div
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
                          ? "bg-arivuIndigo/15 border-arivuIndigo/30 text-gray-100 rounded-tr-none shadow-indigoGlow"
                          : "bg-darkPanel/90 border-darkBorder text-gray-300 rounded-tl-none arivu-glass"
                      }`}
                    >
                      {isUser ? (
                        <p className="whitespace-pre-wrap font-sans">{msg.content}</p>
                      ) : (
                        <div className="prose prose-invert max-w-none text-sm space-y-2.5 font-sans">
                          <ReactMarkdown
                            components={{
                              code: ({ node, className, children, ...props }) => {
                                const match = /language-(\w+)/.exec(className || "");
                                const codeString = String(children).replace(/\n$/, "");
                                return match ? (
                                  <CodeBlock className={className} children={codeString} />
                                ) : (
                                  <code className="bg-gray-800/80 px-1.5 py-0.5 rounded font-mono text-xs text-arivuEmerald-light" {...props}>
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
                      <div className="flex flex-wrap gap-2 items-center px-1.5 pt-0.5">
                        {msg.routing && (
                          <span className={`text-[9px] font-mono px-2 py-0.5 rounded border ${
                            msg.routing === "local"
                              ? "bg-arivuEmerald/5 border-arivuEmerald/15 text-arivuEmerald-light"
                              : "bg-arivuIndigo/5 border-arivuIndigo/15 text-arivuIndigo-light"
                          }`}>
                            {msg.routing === "local" ? "⚡ Local Router" : "🔍 Graph RAG"}
                          </span>
                        )}
                        {msg.sources && msg.sources.length > 0 && (
                          <>
                            <span className="text-[10px] text-gray-500 font-mono flex items-center gap-1 mr-1">
                              <FileText className="w-3 h-3 text-arivuEmerald" /> Sources:
                            </span>
                            {msg.sources.map((src, sIdx) => (
                              <button
                                key={sIdx}
                                onClick={() => onSelectSourceFile(src.file_path)}
                                className="text-[10px] text-arivuEmerald-light hover:text-white bg-arivuEmerald/10 hover:bg-arivuEmerald/20 border border-arivuEmerald/20 rounded px-2 py-0.5 transition font-mono max-w-[150px] truncate"
                                title={`${src.file_path} (Lines ${src.start_line}-${src.end_line})`}
                              >
                                {src.file_name} <span className="text-gray-500 text-[8px] font-sans">L{src.start_line}</span>
                              </button>
                            ))}
                          </>
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
                </div>
              );
            })}
            
            {/* Thinking / Streaming Indicator */}
            {isLoading && (
              <div className="flex gap-4 justify-start">
                <div className="w-7 h-7 rounded-lg border border-arivuIndigo/20 bg-arivuIndigo/10 flex items-center justify-center text-arivuIndigo shrink-0 mt-1 animate-pulse">
                  <Terminal className="w-4 h-4" />
                </div>
                <div className="bg-darkPanel/40 border border-darkBorder/40 text-xs px-4 py-2.5 rounded-2xl rounded-tl-none text-gray-500 font-mono arivu-glass flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-arivuIndigo animate-bounce" style={{ animationDelay: "0ms" }}></span>
                  <span className="w-1.5 h-1.5 rounded-full bg-arivuIndigo animate-bounce" style={{ animationDelay: "150ms" }}></span>
                  <span className="w-1.5 h-1.5 rounded-full bg-arivuIndigo animate-bounce" style={{ animationDelay: "300ms" }}></span>
                  <span>Synthesizing codebase context...</span>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        )}
      </div>
    </div>
  );
};
