import React, { useState, useMemo } from "react";
import { Folder, FolderOpen, FileCode2, ChevronRight, ChevronDown } from "lucide-react";

interface FileTreeProps {
  files: string[];
  activeFile: string | null;
  onSelectFile: (path: string) => void;
}

interface TreeNode {
  name: string;
  path: string;
  type: "file" | "folder";
  children: Record<string, TreeNode>;
}

export const FileTree: React.FC<FileTreeProps> = ({ files, activeFile, onSelectFile }) => {
  const [expandedNodes, setExpandedNodes] = useState<Record<string, boolean>>({});

  // Parse flat file paths into a nested tree structure
  const treeData = useMemo(() => {
    const root: Record<string, TreeNode> = {};

    files.forEach(filePath => {
      const parts = filePath.split(/[/\\]/);
      let currentLevel = root;
      let accumulatedPath = "";

      parts.forEach((part, index) => {
        accumulatedPath = accumulatedPath ? `${accumulatedPath}/${part}` : part;
        const isLast = index === parts.length - 1;

        if (!currentLevel[part]) {
          currentLevel[part] = {
            name: part,
            path: accumulatedPath,
            type: isLast ? "file" : "folder",
            children: {},
          };
        }
        currentLevel = currentLevel[part].children;
      });
    });

    return root;
  }, [files]);

  const toggleExpand = (nodePath: string) => {
    setExpandedNodes(prev => ({
      ...prev,
      [nodePath]: !prev[nodePath],
    }));
  };

  const renderNode = (node: TreeNode, depth: number = 0) => {
    const isFolder = node.type === "folder";
    const isExpanded = expandedNodes[node.path] ?? true; // Default expanded
    const isActive = activeFile === node.path;
    const sortedChildren = Object.values(node.children).sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === "folder" ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });

    return (
      <div key={node.path} className="select-none">
        {/* Row element */}
        <div
          onClick={() => {
            if (isFolder) {
              toggleExpand(node.path);
            } else {
              onSelectFile(node.path);
            }
          }}
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
          className={`flex items-center gap-1.5 py-1 px-2 mx-1.5 rounded-md text-xs cursor-pointer transition font-mono ${
            isActive 
              ? "bg-arivuIndigo/10 text-arivuIndigo-light border-l-[3px] border-arivuIndigo shadow-sm" 
              : "dark:text-gray-400 text-gray-600 hover:dark:text-gray-200 text-gray-800 hover:bg-white/5 hover:bg-gray-100"
          }`}
        >
          {isFolder ? (
            <>
              {isExpanded ? (
                <ChevronDown className="w-3.5 h-3.5 shrink-0 text-gray-500" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5 shrink-0 text-gray-500" />
              )}
              {isExpanded ? (
                <FolderOpen className="w-3.5 h-3.5 shrink-0 text-arivuIndigo" />
              ) : (
                <Folder className="w-3.5 h-3.5 shrink-0 text-arivuIndigo" />
              )}
            </>
          ) : (
            <FileCode2 className={`w-3.5 h-3.5 shrink-0 ${isActive ? "text-arivuIndigo-light" : "text-arivuEmerald"}`} />
          )}
          <span className="truncate">{node.name}</span>
        </div>

        {/* Children nodes */}
        {isFolder && isExpanded && sortedChildren.length > 0 && (
          <div className="mt-0.5">
            {sortedChildren.map(child => renderNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  const rootNodes = useMemo(() => {
    return Object.values(treeData).sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === "folder" ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });
  }, [treeData]);

  return (
    <div className="flex flex-col h-full dark:bg-darkBg bg-gray-50/90 border-r dark:border-darkBorder border-gray-200 w-64 shrink-0 overflow-hidden">
      {/* File Search */}

      {/* Tree container */}
      <div className="flex-1 overflow-y-auto py-3">
        {files.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 px-4 text-center">
            <FileCode2 className="w-8 h-8 text-gray-700 mb-2 stroke-[1.5]" />
            <p className="text-[11px] text-gray-500 font-mono">No files indexed yet.</p>
          </div>
        ) : rootNodes.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-center text-[11px] text-gray-600 font-mono">
            No matches found.
          </div>
        ) : (
          rootNodes.map(node => renderNode(node))
        )}
      </div>

      {/* Footer statistics */}
      {files.length > 0 && (
        <div className="p-2.5 border-t dark:border-darkBorder border-gray-200 text-[10px] text-gray-500 font-mono text-center dark:bg-darkBg bg-gray-50/60">
          Indexed {files.length} source file{files.length === 1 ? "" : "s"}
        </div>
      )}
    </div>
  );
};
