import { useState, useCallback, useRef } from "react";
import { API_BASE } from "../App";

export interface SessionMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  sources?: any[];
}

export interface SessionData {
  session_id: string;
  workspace_path: string;
  created_at: string;
  last_accessed: string;
  title: string | null;
  preview: string;
  message_count: number;
}

export interface FullSessionData extends SessionData {
  chat_history: SessionMessage[];
}

export function useSession(workspacePath: string | null) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionsList, setSessionsList] = useState<SessionData[]>([]);
  // Track whether a fetch is already in flight to avoid duplicate calls
  const fetchingRef = useRef(false);

  /**
   * Fetches all sessions for the current workspace (or all sessions if no
   * workspace is set) and updates the sessions list.
   */
  const fetchSessions = useCallback(async () => {
    if (fetchingRef.current) return;
    fetchingRef.current = true;

    try {
      const url = workspacePath
        ? `${API_BASE}/sessions/list?workspace_path=${encodeURIComponent(workspacePath)}`
        : `${API_BASE}/sessions/list`;

      const res = await fetch(url);
      if (!res.ok) {
        console.warn("[useSession] fetchSessions returned", res.status);
        return;
      }
      const data = await res.json();
      setSessionsList(data.sessions || []);
    } catch (err) {
      console.error("[useSession] fetchSessions error:", err);
    } finally {
      fetchingRef.current = false;
    }
  }, [workspacePath]);

  /**
   * Creates a brand-new session on the backend for the current workspace and
   * sets it as the active session. Returns the new session ID or null on failure.
   */
  const createNewSession = useCallback(async (): Promise<string | null> => {
    if (!workspacePath) {
      console.warn("[useSession] createNewSession called without a workspace path");
      return null;
    }

    try {
      const res = await fetch(`${API_BASE}/sessions/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspace_path: workspacePath }),
      });

      if (!res.ok) {
        console.error("[useSession] Session creation failed:", res.status);
        return null;
      }

      const data = await res.json();
      const newId: string = data.session_id;
      setSessionId(newId);

      // Refresh the list so the new session appears
      await fetchSessions();

      console.log("[useSession] Created session", newId);
      return newId;
    } catch (err) {
      console.error("[useSession] createNewSession error:", err);
      return null;
    }
  }, [workspacePath, fetchSessions]);

  /**
   * Switches the UI to a previously-saved session by its ID.
   * The caller is responsible for loading the chat history from the backend.
   */
  const loadSession = useCallback((id: string) => {
    console.log("[useSession] Loading session", id);
    setSessionId(id);
  }, []);

  /**
   * Clears the active session without deleting it on the backend.
   * Call this when "New Chat" is pressed — then call createNewSession.
   */
  const clearActiveSession = useCallback(() => {
    setSessionId(null);
  }, []);

  /**
   * Fetches the full session object (including chat_history) for a given ID.
   * Returns null if not found or on network error.
   */
  const fetchSessionDetails = useCallback(
    async (id: string): Promise<FullSessionData | null> => {
      try {
        const res = await fetch(`${API_BASE}/sessions/${id}`);
        if (!res.ok) {
          console.warn("[useSession] fetchSessionDetails returned", res.status);
          return null;
        }
        return await res.json();
      } catch (err) {
        console.error("[useSession] fetchSessionDetails error:", err);
        return null;
      }
    },
    []
  );

  /**
   * Deletes a session from the backend and removes it from the local list.
   */
  const deleteSession = useCallback(
    async (id: string): Promise<boolean> => {
      try {
        const res = await fetch(`${API_BASE}/sessions/${id}`, {
          method: "DELETE",
        });
        if (!res.ok) {
          console.warn("[useSession] deleteSession returned", res.status);
          return false;
        }
        // Remove from local list
        setSessionsList((prev) => prev.filter((s) => s.session_id !== id));
        // If we deleted the active session, clear it
        if (id === sessionId) {
          setSessionId(null);
        }
        return true;
      } catch (err) {
        console.error("[useSession] deleteSession error:", err);
        return false;
      }
    },
    [sessionId]
  );

  // Rename a session (updates title/preview)
  const renameSession = useCallback(
    async (id: string, newTitle: string): Promise<boolean> => {
      try {
        const res = await fetch(`${API_BASE}/sessions/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: newTitle }),
        });
        if (!res.ok) {
          console.warn("[useSession] renameSession failed", res.status);
          return false;
        }
        // Update local list with new title/preview
        setSessionsList((prev) =>
          prev.map((s) =>
            s.session_id === id ? { ...s, title: newTitle, preview: newTitle } : s
          )
        );
        return true;
      } catch (err) {
        console.error("[useSession] renameSession error:", err);
        return false;
      }
    },
    []
  );

  return {
    sessionId,
    sessionsList,
    fetchSessions,
    createNewSession,
    loadSession,
    clearActiveSession,
    fetchSessionDetails,
    deleteSession,
    renameSession,
  };
}
