import os
import json
import uuid
import datetime
import logging
from typing import List, Dict, Any, Optional
from app.config import settings

logger = logging.getLogger(__name__)


class SessionManager:
    def __init__(self):
        self.sessions_dir = os.path.join(settings.ROOT_STORAGE, "sessions")
        os.makedirs(self.sessions_dir, exist_ok=True)
        logger.info(f"[SessionManager] Session directory: {self.sessions_dir}")

    def _get_session_path(self, session_id: str) -> str:
        return os.path.join(self.sessions_dir, f"session_{session_id}.json")

    def _atomic_write(self, path: str, data: dict) -> bool:
        """Writes JSON data atomically using a temp file + rename to prevent corruption."""
        tmp_path = path + ".tmp"
        try:
            with open(tmp_path, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2, ensure_ascii=False)
            os.replace(tmp_path, path)
            return True
        except Exception as e:
            logger.error(f"[SessionManager] Atomic write failed for {path}: {e}")
            try:
                if os.path.exists(tmp_path):
                    os.remove(tmp_path)
            except Exception:
                pass
            return False

    def create_session(self, workspace_path: str) -> str:
        """Creates a new session file and returns its ID."""
        session_id = str(uuid.uuid4())
        now = datetime.datetime.utcnow().isoformat() + "Z"
        data = {
            "session_id": session_id,
            "workspace_path": os.path.abspath(workspace_path) if os.path.exists(workspace_path) else workspace_path,
            "created_at": now,
            "last_accessed": now,
            "title": None,
            "chat_history": []
        }
        path = self._get_session_path(session_id)
        if self._atomic_write(path, data):
            logger.info(f"[SessionManager] Created session {session_id} for {workspace_path}")
            return session_id
        raise RuntimeError(f"Failed to create session file at {path}")

    def get_session(self, session_id: str) -> Optional[Dict[str, Any]]:
        """Loads a session by ID. Returns None if not found or corrupt."""
        path = self._get_session_path(session_id)
        if not os.path.exists(path):
            logger.warning(f"[SessionManager] Session file not found: {path}")
            return None
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
            return data
        except json.JSONDecodeError as e:
            logger.error(f"[SessionManager] Corrupt session file {session_id}: {e}")
            return None
        except Exception as e:
            logger.error(f"[SessionManager] Failed to load session {session_id}: {e}")
            return None

    def get_sessions(self, workspace_path: str = None) -> List[Dict[str, Any]]:
        """
        Returns all sessions, optionally filtered by workspace path.
        Strips heavy chat_history from list results for performance.
        """
        sessions = []

        try:
            all_files = os.listdir(self.sessions_dir)
        except Exception as e:
            logger.error(f"[SessionManager] Cannot list sessions directory: {e}")
            return []

        for filename in all_files:
            if not (filename.startswith("session_") and filename.endswith(".json")):
                continue
            # Skip temp files left behind by interrupted writes
            if filename.endswith(".tmp"):
                continue

            path = os.path.join(self.sessions_dir, filename)
            try:
                with open(path, "r", encoding="utf-8") as f:
                    data = json.load(f)
            except Exception as e:
                logger.warning(f"[SessionManager] Skipping unreadable session file {filename}: {e}")
                continue

            # Filter by workspace if provided
            if workspace_path:
                stored_path = data.get("workspace_path", "")
                try:
                    if os.path.abspath(stored_path) != os.path.abspath(workspace_path):
                        continue
                except Exception:
                    if stored_path != workspace_path:
                        continue

            # Build a lightweight preview entry
            history = data.get("chat_history", [])

            # Use saved title, or derive from first user message
            title = data.get("title")
            if not title:
                first_user_msg = next(
                    (m["content"] for m in history if m.get("role") == "user"), None
                )
                if first_user_msg:
                    clean = first_user_msg.replace("\n", " ").strip()
                    title = (clean[:47] + "...") if len(clean) > 47 else clean
                else:
                    title = "Empty Session"

            sessions.append({
                "session_id": data.get("session_id", ""),
                "workspace_path": data.get("workspace_path", ""),
                "created_at": data.get("created_at", ""),
                "last_accessed": data.get("last_accessed", data.get("created_at", "")),
                "title": title,
                "preview": title,   # kept for backward compat
                "message_count": len(history),
            })

        # Sort newest first
        sessions.sort(
            key=lambda x: x.get("last_accessed") or x.get("created_at", ""),
            reverse=True
        )
        return sessions

    def append_message(
        self,
        session_id: str,
        role: str,
        content: str,
        sources: list = None
    ) -> bool:
        """
        Appends a message to the session and updates last_accessed + title.
        Uses atomic write to prevent file corruption.
        """
        session = self.get_session(session_id)
        if session is None:
            logger.warning(f"[SessionManager] append_message: session {session_id} not found")
            return False

        now = datetime.datetime.utcnow().isoformat() + "Z"
        msg: Dict[str, Any] = {
            "role": role,
            "content": content,
            "timestamp": now
        }
        if sources:
            msg["sources"] = sources

        session.setdefault("chat_history", []).append(msg)
        session["last_accessed"] = now

        # Auto-generate title from the first user and assistant messages combined
        if not session.get("title"):
            history = session.get("chat_history", [])
            user_msg = next((m["content"] for m in history if m.get("role") == "user"), "")
            assistant_msg = next((m["content"] for m in history if m.get("role") == "assistant"), "")
            combined = f"{user_msg} {assistant_msg}".strip()
            if combined:
                clean = combined.replace("\n", " ").strip()
                session["title"] = (clean[:35] + "...") if len(clean) > 35 else clean

        path = self._get_session_path(session_id)
        success = self._atomic_write(path, session)
        if not success:
            logger.error(f"[SessionManager] Failed to save message to session {session_id}")
        return success

    def update_session_title(self, session_id: str, title: str) -> bool:
        """Manually override the session title."""
        session = self.get_session(session_id)
        if session is None:
            return False
        session["title"] = title
        session["last_accessed"] = datetime.datetime.utcnow().isoformat() + "Z"
        return self._atomic_write(self._get_session_path(session_id), session)

    def delete_session(self, session_id: str) -> bool:
        """Removes a session file from disk."""
        path = self._get_session_path(session_id)
        try:
            if os.path.exists(path):
                os.remove(path)
                logger.info(f"[SessionManager] Deleted session {session_id}")
                return True
        except Exception as e:
            logger.error(f"[SessionManager] Failed to delete session {session_id}: {e}")
        return False


session_manager = SessionManager()
