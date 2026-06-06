import os
import json
import uuid
import datetime
from typing import List, Dict, Any, Optional
from app.config import settings

class SessionManager:
    def __init__(self):
        self.sessions_dir = os.path.join(settings.ROOT_STORAGE, "sessions")
        os.makedirs(self.sessions_dir, exist_ok=True)
        
    def _get_session_path(self, session_id: str) -> str:
        return os.path.join(self.sessions_dir, f"session_{session_id}.json")

    def create_session(self, workspace_path: str) -> str:
        session_id = str(uuid.uuid4())
        now = datetime.datetime.utcnow().isoformat() + "Z"
        data = {
            "session_id": session_id,
            "workspace_path": os.path.abspath(workspace_path),
            "created_at": now,
            "last_accessed": now,
            "chat_history": []
        }
        path = self._get_session_path(session_id)
        tmp_path = path + ".tmp"
        with open(tmp_path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
        os.replace(tmp_path, path)
        return session_id

    def get_session(self, session_id: str) -> Optional[Dict[str, Any]]:
        path = self._get_session_path(session_id)
        if not os.path.exists(path):
            return None
        try:
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            print(f"Failed to load session {session_id}: {e}")
            return None

    def get_sessions(self, workspace_path: str = None) -> List[Dict[str, Any]]:
        sessions = []
        for filename in os.listdir(self.sessions_dir):
            if filename.startswith("session_") and filename.endswith(".json"):
                path = os.path.join(self.sessions_dir, filename)
                try:
                    with open(path, "r", encoding="utf-8") as f:
                        data = json.load(f)
                        
                        # Store only a preview of the first user message instead of the full array
                        first_user_msg = next((m["content"] for m in data.get("chat_history", []) if m.get("role") == "user"), None)
                        data["preview"] = first_user_msg[:50] + "..." if first_user_msg else "Empty Session"
                        data.pop("chat_history", None) # Strip massive history from memory
                        
                        if workspace_path:
                            # Compare paths safely
                            if os.path.abspath(data.get("workspace_path", "")) == os.path.abspath(workspace_path):
                                sessions.append(data)
                        else:
                            sessions.append(data)
                except Exception:
                    pass
        
        # Sort by last_accessed descending
        sessions.sort(key=lambda x: x.get("last_accessed", x.get("created_at", "")), reverse=True)
        return sessions

    def append_message(self, session_id: str, role: str, content: str, sources: list = None):
        try:
            session = self.get_session(session_id)
            if not session:
                return False
                
            now = datetime.datetime.utcnow().isoformat() + "Z"
            msg = {
                "role": role,
                "content": content,
                "timestamp": now
            }
            if sources:
                msg["sources"] = sources
                
            session["chat_history"].append(msg)
            session["last_accessed"] = now
            
            # Generate title from first user message if not present
            if role == "user" and not session.get("title"):
                clean_content = content.replace("\n", " ")
                session["title"] = clean_content[:40] + "..." if len(clean_content) > 40 else clean_content
            
            # Atomic write
            path = self._get_session_path(session_id)
            tmp_path = path + ".tmp"
            with open(tmp_path, "w", encoding="utf-8") as f:
                json.dump(session, f, indent=2)
            os.replace(tmp_path, path)
            return True
        except Exception as e:
            # Safety Buffer requested by user
            print(f"[SessionManager Error] Failed to write message to session {session_id}: {e}")
            return False

session_manager = SessionManager()
