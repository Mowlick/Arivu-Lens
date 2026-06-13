import os
import shutil
import tempfile
import zipfile
import json
import datetime
import asyncio
import logging
from fastapi import FastAPI, UploadFile, File, HTTPException, status, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
import httpx
from pydantic import BaseModel
from typing import List, Dict, Any, Optional

from app.config import settings
from app.core.parser import parse_codebase, get_file_list, chunk_file
from app.core.vector_store import vector_store
from app.core.llm_service import llm_service
from app.schemas.chat import ChatQueryRequest, IngestPathRequest
from app.core.session_manager import session_manager

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger(__name__)

WORKSPACE_FILE = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "workspace.json")
)


# ─────────────────────────────────────────────────────────────────────────────
# Workspace helpers
# ─────────────────────────────────────────────────────────────────────────────

def save_workspace(
    path: str,
    files_count: int,
    chunks_count: int,
    size_bytes: int,
    files_list: list,
):
    try:
        history = []
        if os.path.exists(WORKSPACE_FILE):
            try:
                with open(WORKSPACE_FILE, "r", encoding="utf-8") as f:
                    old_data = json.load(f)
                history = old_data.get("ingestions", [])
            except Exception:
                pass

        new_entry = {
            "path": os.path.abspath(path),
            "files_count": files_count,
            "chunks_count": chunks_count,
            "size_bytes": size_bytes,
            "timestamp": datetime.datetime.now().isoformat(),
        }
        history.insert(0, new_entry)

        data = {
            "path": new_entry["path"],
            "files_count": files_count,
            "chunks_count": chunks_count,
            "size_bytes": size_bytes,
            "files": files_list,
            "timestamp": new_entry["timestamp"],
            "chat_history": [],
            "ingestions": history[:50],
        }

        tmp = WORKSPACE_FILE + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
        os.replace(tmp, WORKSPACE_FILE)
        logger.info(f"Workspace saved: {new_entry['path']} ({files_count} files, {chunks_count} chunks)")
    except Exception as e:
        logger.error(f"Failed to save workspace.json: {e}")


def get_workspace_data() -> Optional[Dict[str, Any]]:
    if not os.path.exists(WORKSPACE_FILE):
        return None
    try:
        with open(WORKSPACE_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data
    except Exception:
        return None


def get_active_workspace() -> Optional[str]:
    data = get_workspace_data()
    return data["path"] if data else None


# ─────────────────────────────────────────────────────────────────────────────
# FastAPI app
# ─────────────────────────────────────────────────────────────────────────────

app = FastAPI(
    title=settings.PROJECT_NAME,
    description="Local Codebase Semantic Retrieval and Generation Engine",
    version="1.0.0",
)


@app.on_event("startup")
async def startup_event():
    logger.info(f"Checking Ollama at {settings.OLLAMA_BASE_URL}…")
    try:
        resp = httpx.get(settings.OLLAMA_BASE_URL, timeout=2.0)
        if resp.status_code == 200:
            logger.info("Ollama is online.")
        else:
            logger.warning(f"Ollama returned status {resp.status_code}")
    except Exception as e:
        logger.warning(f"Ollama connection failed: {e}")


app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ─────────────────────────────────────────────────────────────────────────────
# Health
# ─────────────────────────────────────────────────────────────────────────────

@app.get("/api/health")
def health_check():
    ollama_status = "offline"
    try:
        resp = httpx.get(settings.OLLAMA_BASE_URL, timeout=2.0)
        if resp.status_code == 200:
            ollama_status = "online"
    except Exception:
        pass

    return {
        "status": "healthy",
        "project": settings.PROJECT_NAME,
        "ollama_connection": ollama_status,
        "ollama_url": settings.OLLAMA_BASE_URL,
        "embedding_model": settings.EMBEDDING_MODEL,
        "llm_model": settings.LLM_MODEL,
        "active_workspace": get_active_workspace(),
    }


# ─────────────────────────────────────────────────────────────────────────────
# Ingest – directory
# ─────────────────────────────────────────────────────────────────────────────

@app.post("/api/ingest")
def ingest_directory(payload: IngestPathRequest):
    path = payload.directory_path
    if not os.path.exists(path):
        raise HTTPException(400, "The specified directory path does not exist.")
    if not os.path.isdir(path):
        raise HTTPException(400, "The specified path is a file, not a directory.")

    async def generate():
        try:
            yield json.dumps({"phase": 1, "message": "Phase 1: Scanning and parsing source files…"}) + "\n"
            await asyncio.sleep(0.3)

            vector_store.clear_db()

            all_chunks: List[Dict[str, Any]] = []
            files = get_file_list(path)
            total = len(files)
            ast_processed = fallback_processed = failed = 0

            for i, rel_path in enumerate(files):
                yield json.dumps({
                    "phase": 1,
                    "message": f"Phase 1: Parsing file {i+1}/{total} ({rel_path})…",
                }) + "\n"
                await asyncio.sleep(0.005)

                try:
                    file_chunks = chunk_file(path, rel_path)
                    if not file_chunks:
                        failed += 1
                    else:
                        all_chunks.extend(file_chunks)
                        if "type" in file_chunks[0]:
                            ast_processed += 1
                        else:
                            fallback_processed += 1
                except Exception as e:
                    logger.error(f"Chunk error on {rel_path}: {e}")
                    failed += 1

            if not all_chunks:
                yield json.dumps({
                    "phase": 4,
                    "message": "No supported source files were found or all failed to parse.",
                    "files_count": 0,
                    "chunks_count": 0,
                    "files": [],
                    "analytics": {
                        "files_scanned": total,
                        "ast_processed": ast_processed,
                        "fallback_processed": fallback_processed,
                        "failed": failed,
                        "chunks_created": 0,
                        "embeddings_created": 0,
                    },
                }) + "\n"
                return

            yield json.dumps({"phase": 2, "message": "Phase 2: Building relational code graph…"}) + "\n"
            await asyncio.sleep(0.3)
            yield json.dumps({"phase": 3, "message": "Phase 3: Generating embeddings and indexing into ChromaDB…"}) + "\n"
            await asyncio.sleep(0.3)

            vector_store.add_chunks(all_chunks)

            size_bytes = sum(len(c.get("content", "").encode("utf-8")) for c in all_chunks)
            save_workspace(path, len(files), len(all_chunks), size_bytes, files)

            yield json.dumps({
                "phase": 4,
                "message": f"Successfully ingested {len(files)} files into {len(all_chunks)} semantic chunks.",
                "files_count": len(files),
                "chunks_count": len(all_chunks),
                "files": files,
                "analytics": {
                    "files_scanned": total,
                    "ast_processed": ast_processed,
                    "fallback_processed": fallback_processed,
                    "failed": failed,
                    "chunks_created": len(all_chunks),
                    "embeddings_created": len(all_chunks),
                },
            }) + "\n"

        except Exception as e:
            logger.error(f"Ingestion error: {e}")
            yield json.dumps({"error": f"Ingestion failed: {str(e)}"}) + "\n"

    return StreamingResponse(generate(), media_type="text/event-stream")


# ─────────────────────────────────────────────────────────────────────────────
# Ingest – ZIP
# ─────────────────────────────────────────────────────────────────────────────

@app.post("/api/ingest-zip")
def ingest_zip_file(file: UploadFile = File(...)):
    if not file.filename.endswith(".zip"):
        raise HTTPException(400, "Uploaded file must be a .zip archive.")

    workspace_temp = os.path.abspath(
        os.path.join(os.path.dirname(__file__), "..", "..", ".temp_uploads")
    )
    if os.path.exists(workspace_temp):
        try:
            shutil.rmtree(workspace_temp)
        except Exception:
            pass
    os.makedirs(workspace_temp, exist_ok=True)

    temp_dir = tempfile.mkdtemp(dir=workspace_temp)
    zip_path = os.path.join(temp_dir, "upload.zip")
    extract_path = os.path.join(temp_dir, "extracted")

    with open(zip_path, "wb") as buf:
        shutil.copyfileobj(file.file, buf)

    def generate():
        try:
            yield json.dumps({"phase": 1, "message": "Phase 1: Decompressing ZIP and parsing source files…"}) + "\n"

            with zipfile.ZipFile(zip_path, "r") as zf:
                zf.extractall(extract_path)

            vector_store.clear_db()

            all_chunks: List[Dict[str, Any]] = []
            files = get_file_list(extract_path)
            total = len(files)
            ast_processed = fallback_processed = failed = 0

            for i, rel_path in enumerate(files):
                yield json.dumps({
                    "phase": 1,
                    "message": f"Phase 1: Parsing file {i+1}/{total} ({rel_path})…",
                }) + "\n"
                try:
                    file_chunks = chunk_file(extract_path, rel_path)
                    if not file_chunks:
                        failed += 1
                    else:
                        all_chunks.extend(file_chunks)
                        if "type" in file_chunks[0]:
                            ast_processed += 1
                        else:
                            fallback_processed += 1
                except Exception as e:
                    logger.error(f"Chunk error on {rel_path}: {e}")
                    failed += 1

            if not all_chunks:
                yield json.dumps({
                    "phase": 4,
                    "message": "ZIP extracted but no supported files found.",
                    "files_count": 0,
                    "chunks_count": 0,
                    "files": [],
                    "analytics": {
                        "files_scanned": total,
                        "ast_processed": ast_processed,
                        "fallback_processed": fallback_processed,
                        "failed": failed,
                        "chunks_created": 0,
                        "embeddings_created": 0,
                    },
                }) + "\n"
                return

            yield json.dumps({"phase": 2, "message": "Phase 2: Building relational code graph…"}) + "\n"
            yield json.dumps({"phase": 3, "message": "Phase 3: Generating embeddings and indexing into ChromaDB…"}) + "\n"

            vector_store.add_chunks(all_chunks)
            size_bytes = sum(len(c.get("content", "").encode("utf-8")) for c in all_chunks)
            save_workspace(extract_path, len(files), len(all_chunks), size_bytes, files)

            yield json.dumps({
                "phase": 4,
                "message": f"ZIP ingested: {len(files)} files → {len(all_chunks)} chunks.",
                "files_count": len(files),
                "chunks_count": len(all_chunks),
                "files": files,
                "analytics": {
                    "files_scanned": total,
                    "ast_processed": ast_processed,
                    "fallback_processed": fallback_processed,
                    "failed": failed,
                    "chunks_created": len(all_chunks),
                    "embeddings_created": len(all_chunks),
                },
            }) + "\n"

        except Exception as e:
            logger.error(f"ZIP ingest error: {e}")
            yield json.dumps({"error": f"ZIP parsing failed: {str(e)}"}) + "\n"
        finally:
            try:
                if os.path.exists(zip_path):
                    os.remove(zip_path)
            except Exception:
                pass

    return StreamingResponse(generate(), media_type="text/event-stream")


# ─────────────────────────────────────────────────────────────────────────────
# Files / Code Viewer
# ─────────────────────────────────────────────────────────────────────────────

@app.get("/api/file-content")
def get_file_content(file_path: str):
    active_ws = get_active_workspace()
    if not active_ws:
        raise HTTPException(400, "No codebase has been ingested yet.")

    abs_ws = os.path.abspath(active_ws)
    abs_file = os.path.abspath(os.path.join(abs_ws, file_path))

    if not abs_file.startswith(abs_ws):
        raise HTTPException(403, "Access denied: path outside workspace.")
    if not os.path.exists(abs_file) or not os.path.isfile(abs_file):
        raise HTTPException(404, f"File not found: {file_path}")

    try:
        with open(abs_file, "r", encoding="utf-8", errors="ignore") as f:
            content = f.read()
        return {"file_path": file_path, "content": content}
    except Exception as e:
        raise HTTPException(500, f"Failed to read file: {e}")


@app.get("/api/files")
def get_files():
    files = vector_store.get_all_indexed_files()
    return {"files": files}


# ─────────────────────────────────────────────────────────────────────────────
# Ingestion history
# ─────────────────────────────────────────────────────────────────────────────

@app.get("/api/history")
def get_history():
    data = get_workspace_data()
    if not data:
        return {"history": []}
    return {"history": data.get("ingestions", [])}


# ─────────────────────────────────────────────────────────────────────────────
# Workspace restore / sync
# ─────────────────────────────────────────────────────────────────────────────

@app.get("/api/workspace/restore")
def api_restore_workspace():
    data = get_workspace_data()
    if not data:
        raise HTTPException(404, "No active workspace found.")
    return {
        "path": data["path"],
        "files_count": data["files_count"],
        "chunks_count": data["chunks_count"],
        "size_bytes": data["size_bytes"],
        "files": data["files"],
        "chat_history": data.get("chat_history", []),
    }


class SyncWorkspaceRequest(BaseModel):
    chat_history: List[Dict[str, Any]] = []


@app.post("/api/workspace/sync")
def api_sync_workspace(request: SyncWorkspaceRequest):
    data = get_workspace_data()
    if not data:
        raise HTTPException(404, "No active workspace to sync.")
    try:
        data["chat_history"] = request.chat_history
        data["timestamp"] = datetime.datetime.now().isoformat()
        tmp = WORKSPACE_FILE + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
        os.replace(tmp, WORKSPACE_FILE)
        return {"status": "synced"}
    except Exception as e:
        raise HTTPException(500, str(e))


# ─────────────────────────────────────────────────────────────────────────────
# Graph
# ─────────────────────────────────────────────────────────────────────────────

@app.get("/api/graph")
def get_graph():
    try:
        from app.core.graph_rag import code_graph_store
        from collections import Counter
        import math

        nodes = []
        links = []

        # Supported programming language extensions for code graph filtering
        SUPPORTED_CODE_EXTENSIONS = {
            ".py", ".ts", ".tsx", ".js", ".jsx", ".java", ".go", ".rs", ".cpp", ".c", ".h", ".hpp"
        }

        # 1. Filter nodes to keep only code files
        filtered_nodes = {}
        for n_id, n_data in code_graph_store.nodes.items():
            f_path = n_data.get("metadata", {}).get("file_path", "")
            if f_path and any(f_path.lower().endswith(ext) for ext in SUPPORTED_CODE_EXTENSIONS):
                filtered_nodes[n_id] = n_data

        unique_files = {n_data.get("metadata", {}).get("file_path", "") for n_data in filtered_nodes.values()}
        total_files = len(unique_files)
        # Suppress generic symbol links if referenced in > 10% of total files (min threshold of 5)
        suppress_threshold = max(5, int(total_files * 0.10))

        # 2. Count symbol references for frequency suppression
        symbol_counts = Counter()
        for n_data in filtered_nodes.values():
            deps = n_data.get("metadata", {}).get("dependencies", [])
            for dep in deps:
                sym = dep.get("symbol") if isinstance(dep, dict) else dep
                if sym:
                    symbol_counts[sym] += 1

        # 3. Build Folder/Package hierarchies and calculate recursive descendant counts
        folder_files = {}
        for file_path in unique_files:
            parts = file_path.replace("\\", "/").split("/")
            for i in range(1, len(parts)):
                folder_path = "/".join(parts[:i])
                if folder_path not in folder_files:
                    folder_path_key = folder_path
                    folder_files[folder_path_key] = set()
                folder_files[folder_path].add(file_path)

        def get_folder_type(folder_path: str) -> str:
            parts = folder_path.split('/')
            if len(parts) == 1:
                return "package"
            if len(parts) == 2 and parts[0] == "packages":
                return "package"
            return "folder"

        # Add Folder and Package Nodes
        for folder_path, desc_files in folder_files.items():
            f_type = get_folder_type(folder_path)
            # Size folder based on total descendants
            val = 5.0 + math.log(len(desc_files) + 1)
            nodes.append({
                "id": folder_path,
                "name": folder_path.split('/')[-1],
                "type": f_type,
                "val": val,
                "group": folder_path.split('/')[0],
                "path": folder_path,
            })

        # Folder -> Folder containment links
        for folder_path in folder_files.keys():
            parts = folder_path.split('/')
            if len(parts) > 1:
                parent_path = "/".join(parts[:-1])
                if parent_path in folder_files:
                    links.append({
                        "source": parent_path,
                        "target": folder_path,
                        "type": "contains",
                    })

        # Add File Nodes and File containment links
        for file_path in unique_files:
            group = file_path.replace("\\", "/").split("/")[0]
            nodes.append({
                "id": file_path,
                "name": os.path.basename(file_path),
                "type": "file",
                "val": 3.0,
                "group": group,
                "path": file_path,
            })
            
            parts = file_path.replace("\\", "/").split("/")
            if len(parts) > 1:
                parent_folder = "/".join(parts[:-1])
                if parent_folder in folder_files:
                    links.append({
                        "source": parent_folder,
                        "target": file_path,
                        "type": "contains",
                    })

        # 4. Add Class/Function Nodes and containment links
        for node_id, node_data in filtered_nodes.items():
            file_path = node_data.get("metadata", {}).get("file_path", "")
            group = file_path.replace("\\", "/").split("/")[0] if file_path else "root"
            
            meta = node_data.get("metadata", {})
            n_type = meta.get("type", "chunk")
            
            val = 1.2
            if n_type == "class_definition":
                n_type = "class"
                val = 2.0
            elif n_type in ("function_definition", "method_definition", "generator_definition"):
                n_type = "function"
                val = 1.5
            else:
                n_type = "chunk"
                val = 1.0

            nodes.append({
                "id": node_id,
                "name": node_data.get("name", "anonymous"),
                "type": n_type,
                "val": val,
                "group": group,
                "path": file_path,
            })

            parent_class_name = meta.get("parent_class")
            parent_class_id = None
            if parent_class_name:
                for other_id, other_data in filtered_nodes.items():
                    other_meta = other_data.get("metadata", {})
                    if (other_meta.get("file_path") == file_path and
                        other_data.get("name") == parent_class_name and
                        other_meta.get("type") == "class_definition"):
                        parent_class_id = other_id
                        break

            if parent_class_id:
                links.append({
                    "source": parent_class_id,
                    "target": node_id,
                    "type": "contains",
                })
            elif file_path:
                links.append({
                    "source": file_path,
                    "target": node_id,
                    "type": "contains",
                })

        # 5. Resolve Dependency Call Links, External Nodes, and Cycles
        external_nodes = set()
        name_to_ids = {}
        for n_id, n_data in filtered_nodes.items():
            name = n_data.get("name")
            if name and name != "anonymous":
                if name not in name_to_ids:
                    name_to_ids[name] = []
                name_to_ids[name].append(n_id)

        for node_id, node_data in filtered_nodes.items():
            meta = node_data.get("metadata", {})
            file_path = meta.get("file_path", "")
            deps = meta.get("dependencies", [])
            
            for dep in deps:
                is_dict = isinstance(dep, dict)
                sym = dep.get("symbol") if is_dict else dep
                relation = dep.get("relation") if is_dict else "reference"
                
                if not sym:
                    continue
                    
                # Apply frequency-based suppression
                if symbol_counts[sym] > suppress_threshold:
                    continue
                    
                if relation == "external_import":
                    external_nodes.add(sym)
                    links.append({
                        "source": file_path,
                        "target": sym,
                        "type": "depends_on",
                        "relation": "import",
                        "weight": 5,
                        "isCyclic": False
                    })
                elif sym in name_to_ids:
                    for target_id in name_to_ids[sym]:
                        if target_id == node_id:
                            continue
                            
                        weight = 1
                        if relation in ("import", "inheritance"):
                           weight = 5
                        elif relation == "call":
                           weight = 3
                           
                        # Check direct circular dependency
                        is_cyclic = False
                        target_deps = (
                            filtered_nodes.get(target_id, {})
                            .get("metadata", {})
                            .get("dependencies", [])
                        )
                        for td in target_deps:
                            td_sym = td.get("symbol") if isinstance(td, dict) else td
                            if td_sym == node_data.get("name"):
                                is_cyclic = True
                                break
                                
                        links.append({
                            "source": node_id,
                            "target": target_id,
                            "type": "depends_on",
                            "relation": relation,
                            "weight": weight,
                            "isCyclic": is_cyclic
                        })

        # Add External Nodes with type "external"
        for ext in external_nodes:
            nodes.append({
                "id": ext,
                "name": ext,
                "type": "external",
                "val": 2.0,
                "group": "external",
                "path": "External Dependency"
            })

        return {"nodes": nodes, "links": links}
    except Exception as e:
        logger.error(f"Graph generation error: {e}")
        return {"error": str(e)}


# ─────────────────────────────────────────────────────────────────────────────
# Clear
# ─────────────────────────────────────────────────────────────────────────────

@app.post("/api/clear")
def clear_codebase():
    vector_store.clear_db()

    if os.path.exists(WORKSPACE_FILE):
        try:
            os.remove(WORKSPACE_FILE)
        except Exception:
            pass

    sessions_dir = os.path.join(settings.ROOT_STORAGE, "sessions")
    if os.path.exists(sessions_dir):
        try:
            shutil.rmtree(sessions_dir)
            os.makedirs(sessions_dir, exist_ok=True)
        except Exception:
            pass

    return {"message": "Database, history, and sessions cleared."}


# ─────────────────────────────────────────────────────────────────────────────
# Sessions  ← FIXED
# ─────────────────────────────────────────────────────────────────────────────

class CreateSessionRequest(BaseModel):
    workspace_path: str


@app.post("/api/sessions/create")
def create_session(req: CreateSessionRequest):
    try:
        sid = session_manager.create_session(req.workspace_path)
        return {"session_id": sid}
    except Exception as e:
        logger.error(f"Create session error: {e}")
        raise HTTPException(500, str(e))


@app.get("/api/sessions/list")
def list_sessions(workspace_path: Optional[str] = None):
    """
    Returns session previews (no heavy chat_history).
    workspace_path filter is optional — omit to get ALL sessions.
    """
    sessions = session_manager.get_sessions(workspace_path)
    return {"sessions": sessions}


@app.get("/api/sessions/{session_id}")
def get_single_session(session_id: str):
    """Returns the full session including chat_history."""
    session = session_manager.get_session(session_id)
    if not session:
        raise HTTPException(404, "Session not found")
    return session


@app.delete("/api/sessions/{session_id}")
def delete_session(session_id: str):
    """Deletes a session permanently."""
    ok = session_manager.delete_session(session_id)
    if not ok:
        raise HTTPException(404, "Session not found or already deleted")
    return {"deleted": session_id}


class UpdateSessionRequest(BaseModel):
    title: Optional[str] = None


@app.patch("/api/sessions/{session_id}")
def update_session(session_id: str, req: UpdateSessionRequest):
    """Allows updating session metadata (e.g. title)."""
    if req.title is not None:
        ok = session_manager.update_session_title(session_id, req.title)
        if not ok:
            raise HTTPException(404, "Session not found")
    return {"updated": session_id}


# ─────────────────────────────────────────────────────────────────────────────
# Chat
# ─────────────────────────────────────────────────────────────────────────────

@app.post("/api/chat")
async def chat_with_codebase(request: ChatQueryRequest, background_tasks: BackgroundTasks):
    try:
        history_context = request.history or []

        # If session provided, load history from disk
        if request.session_id:
            session_data = session_manager.get_session(request.session_id)
            if session_data:
                # Save the user message now so it appears in future history loads
                session_manager.append_message(request.session_id, "user", request.query)

                history_context = [
                    {"role": msg["role"], "content": msg["content"]}
                    for msg in session_data.get("chat_history", [])
                    if msg.get("role") in ("user", "assistant")
                ]

        # Retrieval
        contexts = vector_store.query_similar(
            request.query,
            n_results=request.n_results or 5,
            filter_files=request.attached_files or [],
        )

        response_state = {"text": ""}

        def save_assistant_message(session_id: str, state: dict, ctxs: list):
            try:
                session_manager.append_message(session_id, "assistant", state["text"], ctxs)
            except Exception as e:
                logger.error(f"Background save failed: {e}")

        if request.session_id:
            background_tasks.add_task(
                save_assistant_message, request.session_id, response_state, contexts
            )

        if not contexts:
            async def empty_gen():
                yield json.dumps({"type": "sources", "sources": []}) + "\n"
                msg = (
                    "The vector store is currently empty or returned no results. "
                    "Please ingest a codebase first."
                )
                response_state["text"] = msg
                yield json.dumps({"type": "content", "text": msg}) + "\n"

            return StreamingResponse(empty_gen(), media_type="text/event-stream")

        async def response_gen():
            async for chunk in llm_service.stream_answer(
                request.query, contexts, history=history_context
            ):
                try:
                    parsed = json.loads(chunk.strip())
                    if parsed.get("type") == "content":
                        response_state["text"] += parsed.get("text", "")
                except Exception:
                    pass
                yield chunk

        return StreamingResponse(response_gen(), media_type="text/event-stream")

    except Exception as e:
        logger.error(f"Chat error: {e}")
        raise HTTPException(500, f"RAG query failed: {e}")
