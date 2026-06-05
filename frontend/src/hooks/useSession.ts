import { useState, useCallback } from "react";
import { API_BASE } from "../App";

export interface SessionData {
  session_id: string;
  workspace_path: string;
  created_at: string;
  last_accessed: string;
  chat_history: {
    role: "user" | "assistant";
    content: string;
    timestamp: string;
    sources?: any[];
  }[];
}

export function useSession(workspacePath: string | null) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionsList, setSessionsList] = useState<SessionData[]>([]);

  const fetchSessions = useCallback(async () => {
    if (!workspacePath) return;
    try {
      const res = await fetch(`${API_BASE}/sessions/list?workspace_path=${encodeURIComponent(workspacePath)}`);
      if (res.ok) {
        const data = await res.json();
        setSessionsList(data.sessions || []);
      }
    } catch (err) {
      console.error("Failed to fetch sessions", err);
    }
  }, [workspacePath]);

  const createNewSession = useCallback(async () => {
    if (!workspacePath) return null;
    try {
      const res = await fetch(`${API_BASE}/sessions/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspace_path: workspacePath })
      });
      if (res.ok) {
        const data = await res.json();
        setSessionId(data.session_id);
        await fetchSessions();
        return data.session_id;
      }
    } catch (err) {
      console.error("Failed to create session", err);
    }
    return null;
  }, [workspacePath, fetchSessions]);

  const loadSession = useCallback((id: string) => {
    setSessionId(id);
  }, []);

  const fetchSessionDetails = useCallback(async (id: string) => {
    try {
      const res = await fetch(`${API_BASE}/sessions/${id}`);
      if (res.ok) {
        return await res.json();
      }
    } catch (err) {
      console.error("Failed to fetch session details", err);
    }
    return null;
  }, []);

  return {
    sessionId,
    sessionsList,
    fetchSessions,
    createNewSession,
    loadSession,
    fetchSessionDetails
  };
}
