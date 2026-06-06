import os
import shutil
import tempfile
import zipfile
import json
import datetime
import asyncio
from fastapi import FastAPI, UploadFile, File, HTTPException, status, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
import httpx
from pydantic import BaseModel
from typing import List, Dict, Any

from app.config import settings
from app.core.parser import parse_codebase, get_file_list, chunk_file
from app.core.vector_store import vector_store
from app.core.llm_service import llm_service
from app.schemas.chat import ChatQueryRequest, IngestPathRequest
from app.core.session_manager import session_manager

WORKSPACE_FILE = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "workspace.json"))

def save_workspace(path: str, files_count: int, chunks_count: int, size_bytes: int, files_list: list):
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
            "timestamp": datetime.datetime.now().isoformat()
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
            "ingestions": history[:50]
        }
        with open(WORKSPACE_FILE, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
    except Exception as e:
        print("Failed to save workspace.json:", e)

def get_workspace_data():
    if os.path.exists(WORKSPACE_FILE):
        try:
            with open(WORKSPACE_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
                if os.path.exists(data.get("path", "")):
                    return data
        except Exception:
            pass
    return None

app = FastAPI(
    title=settings.PROJECT_NAME,
    description="Local Codebase Semantic Retrieval and Generation Engine",
    version="1.0.0"
)

@app.on_event("startup")
async def startup_event():
    print(f"Checking Ollama connection at {settings.OLLAMA_BASE_URL}...")
    try:
        response = httpx.get(settings.OLLAMA_BASE_URL, timeout=2.0)
        if response.status_code == 200:
            print("Ollama is online.")
        else:
            print("WARNING: Ollama returned non-200 status.")
    except Exception as e:
        print(f"CRITICAL WARNING: Ollama connection failed. Is Ollama running? Error: {e}")

# Enable CORS for frontend integration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # For local development
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def get_active_workspace():
    data = get_workspace_data()
    return data["path"] if data else None

def set_active_workspace(path):
    pass # Managed by save_workspace now

@app.get("/api/health")
def health_check():
    """Diagnostic health check to verify backend and local Ollama connectivity."""
    ollama_status = "offline"
    try:
        response = httpx.get(settings.OLLAMA_BASE_URL, timeout=2.0)
        if response.status_code == 200:
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
        "active_workspace": get_active_workspace()
    }

@app.post("/api/ingest")
def ingest_directory(payload: IngestPathRequest):
    """Parses and indexes all valid code files in a local directory via Server-Sent Events stream."""
    path = payload.directory_path
    if not os.path.exists(path):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="The specified directory path does not exist on this machine."
        )
    if not os.path.isdir(path):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="The specified path is a file, not a directory."
        )

    async def generate():
        import json
        import asyncio
        try:
            yield json.dumps({"phase": 1, "message": "Phase 1: Scanning and parsing source files..."}) + "\n"
            await asyncio.sleep(0.5)
            # Clear existing DB data for a clean project indexing
            vector_store.clear_db()
            
            # Traverse and chunk files manually to yield progress
            all_chunks = []
            files = get_file_list(path)
            total_files = len(files)
            
            ast_processed = 0
            fallback_processed = 0
            failed = 0
            
            for i, rel_path in enumerate(files):
                yield json.dumps({"phase": 1, "message": f"Phase 1: Parsing file {i+1}/{total_files} ({rel_path})..."}) + "\n"
                await asyncio.sleep(0.01)
                try:
                    file_chunks = chunk_file(path, rel_path)
                    if len(file_chunks) == 0:
                        failed += 1
                    else:
                        all_chunks.extend(file_chunks)
                        if "type" in file_chunks[0]:
                            ast_processed += 1
                        else:
                            fallback_processed += 1
                except Exception as e:
                    print(f"Failed completely on {rel_path}: {e}")
                    failed += 1
                
            chunks = all_chunks
            
            if not chunks:
                yield json.dumps({
                    "phase": 4,
                    "message": "Ingestion completed, but no supported source code files were found.",
                    "files_count": 0,
                    "chunks_count": 0,
                    "files": [],
                    "analytics": {
                        "files_scanned": total_files,
                        "ast_processed": ast_processed,
                        "fallback_processed": fallback_processed,
                        "failed": failed,
                        "chunks_created": 0,
                        "embeddings_created": 0
                    }
                }) + "\n"
                return
                
            yield json.dumps({"phase": 2, "message": "Phase 2: Building relational code graph..."}) + "\n"
            await asyncio.sleep(0.5)
            yield json.dumps({"phase": 3, "message": "Phase 3: Generating embeddings and indexing into ChromaDB..."}) + "\n"
            await asyncio.sleep(0.5)
            
            # Add to vector store
            vector_store.add_chunks(chunks)
            
            size_bytes = sum(len(c.get("content", "").encode('utf-8')) for c in chunks)
            save_workspace(path, len(files), len(chunks), size_bytes, files)
            
            yield json.dumps({
                "phase": 4,
                "message": f"Successfully ingested {len(files)} files into {len(chunks)} semantic chunks.",
                "files_count": len(files),
                "chunks_count": len(chunks),
                "files": files,
                "analytics": {
                    "files_scanned": total_files,
                    "ast_processed": ast_processed,
                    "fallback_processed": fallback_processed,
                    "failed": failed,
                    "chunks_created": len(chunks),
                    "embeddings_created": len(chunks)
                }
            }) + "\n"
        except Exception as e:
            yield json.dumps({"error": f"Ingestion failed: {str(e)}"}) + "\n"

    return StreamingResponse(generate(), media_type="text/event-stream")

@app.post("/api/ingest-zip")
def ingest_zip_file(file: UploadFile = File(...)):
    """Uploads, extracts, and indexes a ZIP repository via Server-Sent Events stream."""
    if not file.filename.endswith('.zip'):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Uploaded file must be a ZIP archive."
        )

    # Set up temp folder inside workspace (so it falls under permitted pathways)
    workspace_temp = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".temp_uploads"))
    
    # Clean previous uploads to prevent disk bloat
    if os.path.exists(workspace_temp):
        try:
            shutil.rmtree(workspace_temp)
        except Exception:
            pass
            
    os.makedirs(workspace_temp, exist_ok=True)
    
    temp_dir = tempfile.mkdtemp(dir=workspace_temp)
    zip_path = os.path.join(temp_dir, "upload.zip")
    extract_path = os.path.join(temp_dir, "extracted")
    
    # Save ZIP upload synchronously before returning the stream
    with open(zip_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
            
    def generate():
        import json
        try:
            yield json.dumps({"phase": 1, "message": "Phase 1: Decompressing ZIP and parsing source files..."}) + "\n"
            # Extract ZIP
            with zipfile.ZipFile(zip_path, 'r') as zip_ref:
                zip_ref.extractall(extract_path)
                
            # Clear existing DB
            vector_store.clear_db()
            
            # Chunk & Index
            all_chunks = []
            files = get_file_list(extract_path)
            total_files = len(files)
            
            ast_processed = 0
            fallback_processed = 0
            failed = 0
            
            for i, rel_path in enumerate(files):
                yield json.dumps({"phase": 1, "message": f"Phase 1: Parsing file {i+1}/{total_files} ({rel_path})..."}) + "\n"
                try:
                    file_chunks = chunk_file(extract_path, rel_path)
                    if len(file_chunks) == 0:
                        failed += 1
                    else:
                        all_chunks.extend(file_chunks)
                        if "type" in file_chunks[0]:
                            ast_processed += 1
                        else:
                            fallback_processed += 1
                except Exception as e:
                    print(f"Failed completely on {rel_path}: {e}")
                    failed += 1
                
            chunks = all_chunks
            
            if not chunks:
                yield json.dumps({
                    "phase": 4,
                    "message": "ZIP extraction done, but no supported files found.",
                    "files_count": 0,
                    "chunks_count": 0,
                    "files": [],
                    "analytics": {
                        "files_scanned": total_files,
                        "ast_processed": ast_processed,
                        "fallback_processed": fallback_processed,
                        "failed": failed,
                        "chunks_created": 0,
                        "embeddings_created": 0
                    }
                }) + "\n"
                return
                
            yield json.dumps({"phase": 2, "message": "Phase 2: Building relational code graph..."}) + "\n"
            yield json.dumps({"phase": 3, "message": "Phase 3: Generating embeddings and indexing into ChromaDB..."}) + "\n"
            
            vector_store.add_chunks(chunks)
            size_bytes = sum(len(c.get("content", "").encode('utf-8')) for c in chunks)
            save_workspace(extract_path, len(files), len(chunks), size_bytes, files)
            
            yield json.dumps({
                "phase": 4,
                "message": f"Successfully extracted and ingested ZIP. Indexed {len(files)} files into {len(chunks)} chunks.",
                "files_count": len(files),
                "chunks_count": len(chunks),
                "files": files,
                "analytics": {
                    "files_scanned": total_files,
                    "ast_processed": ast_processed,
                    "fallback_processed": fallback_processed,
                    "failed": failed,
                    "chunks_created": len(chunks),
                    "embeddings_created": len(chunks)
                }
            }) + "\n"
        except Exception as e:
            yield json.dumps({"error": f"ZIP parsing failed: {str(e)}"}) + "\n"
        finally:
            # Clean up the raw zip file to save space, but leave extracted folders available for code-viewing
            try:
                if os.path.exists(zip_path):
                    os.remove(zip_path)
            except Exception:
                pass

    return StreamingResponse(generate(), media_type="text/event-stream")

@app.get("/api/file-content")
def get_file_content(file_path: str):
    """Retrieves and returns the raw file contents of an indexed file for viewing."""
    active_ws = get_active_workspace()
    if not active_ws:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No codebase has been ingested yet."
        )

    # Safe path checking to prevent path traversal attacks
    abs_workspace = os.path.abspath(active_ws)
    abs_file = os.path.abspath(os.path.join(abs_workspace, file_path))
    
    if not abs_file.startswith(abs_workspace):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied: file pathway lies outside current workspace."
        )
        
    if not os.path.exists(abs_file) or not os.path.isfile(abs_file):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"File not found: {file_path}"
        )
        
    try:
        with open(abs_file, "r", encoding="utf-8", errors="ignore") as f:
            content = f.read()
        return {"file_path": file_path, "content": content}
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to read file content: {str(e)}"
        )

@app.get("/api/files")
def get_files():
    """Returns a list of all successfully ingested relative file paths."""
    files = vector_store.get_all_indexed_files()
    return {"files": files}

@app.get("/api/history")
def get_history():
    """Returns the history of ingested workspaces."""
    data = get_workspace_data()
    if not data:
        return {"history": []}
    return {"history": data.get("ingestions", [])}

@app.get("/api/workspace/restore")
def api_restore_workspace():
    """Returns the currently active workspace metadata to skip re-ingestion on restart."""
    data = get_workspace_data()
    if not data:
        raise HTTPException(status_code=404, detail="No active workspace found.")
        
    return {
        "path": data["path"],
        "files_count": data["files_count"],
        "chunks_count": data["chunks_count"],
        "size_bytes": data["size_bytes"],
        "files": data["files"],
        "chat_history": data.get("chat_history", [])
    }

class SyncWorkspaceRequest(BaseModel):
    chat_history: List[Dict[str, Any]] = []

@app.post("/api/workspace/sync")
def api_sync_workspace(request: SyncWorkspaceRequest):
    """Saves conversation history back to workspace.json."""
    data = get_workspace_data()
    if not data:
        raise HTTPException(status_code=404, detail="No active workspace found to sync.")
        
    try:
        data["chat_history"] = request.chat_history
        data["timestamp"] = datetime.datetime.now().isoformat()
        with open(WORKSPACE_FILE, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
        return {"status": "synced"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/graph")
def get_graph():
    """Returns the codebase relational graph for visualization."""
    try:
        from app.core.graph_rag import code_graph_store
        
        nodes = []
        links = []
        
        # Format nodes
        for node_id, node_data in code_graph_store.nodes.items():
            file_path = ""
            if "metadata" in node_data:
                file_path = node_data["metadata"].get("file_path", "")
                
            group = os.path.dirname(file_path) if file_path else "root"
            if not group: group = "root"
            
            content_len = len(node_data.get("content", ""))
            val = max(1, content_len / 500.0) # Base weight on length for "God Object" detection
            
            nodes.append({
                "id": node_id,
                "name": node_data.get("name", "anonymous"),
                "val": val,
                "group": group,
                "path": file_path
            })
            
            # Format links (dependencies)
            deps = node_data.get("metadata", {}).get("dependencies", [])
            for dep in deps:
                if dep in code_graph_store.name_to_ids:
                    for target_id in code_graph_store.name_to_ids[dep]:
                        if target_id != node_id: # avoid self-links
                            # Check cyclic (target -> node)
                            is_cyclic = False
                            target_deps = code_graph_store.nodes.get(target_id, {}).get("metadata", {}).get("dependencies", [])
                            for t_dep in target_deps:
                                if node_id in code_graph_store.name_to_ids.get(t_dep, []):
                                    is_cyclic = True
                                    break
                            
                            links.append({
                                "source": node_id,
                                "target": target_id,
                                "isCyclic": is_cyclic
                            })
                            
        return {"nodes": nodes, "links": links}
    except Exception as e:
        return {"error": str(e)}

@app.post("/api/clear")
def clear_codebase():
    """Clears the local Vector Database store, history, and sessions."""
    vector_store.clear_db()
    set_active_workspace(None)
    
    # Clear History
    if os.path.exists(WORKSPACE_FILE):
        try:
            os.remove(WORKSPACE_FILE)
        except Exception:
            pass
            
    # Clear Sessions
    sessions_dir = os.path.join(settings.ROOT_STORAGE, "sessions")
    if os.path.exists(sessions_dir):
        try:
            shutil.rmtree(sessions_dir)
            os.makedirs(sessions_dir, exist_ok=True)
        except Exception:
            pass
            
    return {"message": "Database, history, and sessions have been fully cleared."}

class CreateSessionRequest(BaseModel):
    workspace_path: str

@app.post("/api/sessions/create")
def create_session(req: CreateSessionRequest):
    try:
        sid = session_manager.create_session(req.workspace_path)
        return {"session_id": sid}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/sessions/list")
def list_sessions(workspace_path: str = None):
    return {"sessions": session_manager.get_sessions(workspace_path)}

@app.get("/api/sessions/{session_id}")
def get_single_session(session_id: str):
    session = session_manager.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return session

@app.post("/api/chat")
async def chat_with_codebase(request: ChatQueryRequest, background_tasks: BackgroundTasks):
    """Retrieves top similarity source snippets and streams response via JSON Lines."""
    try:
        # Load history from session if provided
        history_context = request.history
        if request.session_id:
            session_data = session_manager.get_session(request.session_id)
            if session_data:
                # Append user prompt to session file immediately
                session_manager.append_message(request.session_id, "user", request.query)
                # Build history context from previous messages
                history_context = [
                    {"role": msg["role"], "content": msg["content"]} 
                    for msg in session_data.get("chat_history", [])
                    if msg["role"] in ("user", "assistant")
                ]

        # 1. Retrieval
        contexts = vector_store.query_similar(
            request.query, 
            n_results=request.n_results, 
            filter_files=request.attached_files
        )
        
        response_state = {"text": ""}
        
        def save_task(session_id: str, accumulated_ref: dict, ctxs: list):
            try:
                session_manager.append_message(session_id, "assistant", accumulated_ref["text"], ctxs)
            except Exception as e:
                print(f"[SessionManager Error] Background task failed: {e}")

        if request.session_id:
            background_tasks.add_task(save_task, request.session_id, response_state, contexts)
        
        if not contexts:
            # Fallback if DB is empty or search failed
            async def empty_generator():
                import json
                yield json.dumps({"type": "sources", "sources": []}) + "\n"
                msg = "The vector store is currently empty. Please ingest a codebase or upload a ZIP folder first."
                response_state["text"] = msg
                yield json.dumps({"type": "content", "text": msg}) + "\n"
            return StreamingResponse(empty_generator(), media_type="text/event-stream")
            
        # 2. Generation & Streaming
        async def response_generator():
            async for chunk in llm_service.stream_answer(request.query, contexts, history=history_context):
                import json
                try:
                    parsed = json.loads(chunk.strip())
                    if parsed.get("type") == "content":
                        response_state["text"] += parsed.get("text", "")
                except Exception:
                    pass
                yield chunk

        return StreamingResponse(
            response_generator(),
            media_type="text/event-stream"
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Retrieval RAG query failed: {str(e)}"
        )
