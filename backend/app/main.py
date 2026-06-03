import os
import shutil
import tempfile
import zipfile
from fastapi import FastAPI, UploadFile, File, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
import httpx

from app.config import settings
from app.core.parser import parse_codebase
from app.core.vector_store import vector_store
from app.core.llm_service import llm_service
from app.schemas.chat import ChatQueryRequest, IngestPathRequest

app = FastAPI(
    title=settings.PROJECT_NAME,
    description="Local Codebase Semantic Retrieval and Generation Engine",
    version="1.0.0"
)

# Enable CORS for frontend integration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # For local development
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def get_active_workspace():
    path_file = os.path.join(settings.ROOT_STORAGE, "active_workspace.txt")
    if os.path.exists(path_file):
        try:
            with open(path_file, "r", encoding="utf-8") as f:
                path = f.read().strip()
                if path and os.path.exists(path):
                    return path
        except Exception:
            pass
    return None

def set_active_workspace(path):
    path_file = os.path.join(settings.ROOT_STORAGE, "active_workspace.txt")
    try:
        os.makedirs(settings.ROOT_STORAGE, exist_ok=True)
        if path:
            with open(path_file, "w", encoding="utf-8") as f:
                f.write(os.path.abspath(path))
        else:
            if os.path.exists(path_file):
                os.remove(path_file)
    except Exception:
        pass

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

    def generate():
        import json
        try:
            yield json.dumps({"phase": 1, "message": "Phase 1: Scanning and parsing source files..."}) + "\n"
            # Clear existing DB data for a clean project indexing
            vector_store.clear_db()
            
            # Traverse and chunk files
            chunks, files = parse_codebase(path)
            
            if not chunks:
                yield json.dumps({
                    "phase": 4,
                    "message": "Ingestion completed, but no supported source code files were found.",
                    "files_count": 0,
                    "chunks_count": 0,
                    "files": []
                }) + "\n"
                return
                
            yield json.dumps({"phase": 2, "message": "Phase 2: Building relational code graph..."}) + "\n"
            yield json.dumps({"phase": 3, "message": "Phase 3: Generating embeddings and indexing into ChromaDB..."}) + "\n"
            
            # Add to vector store
            vector_store.add_chunks(chunks)
            set_active_workspace(path)
            
            yield json.dumps({
                "phase": 4,
                "message": f"Successfully ingested {len(files)} files into {len(chunks)} semantic chunks.",
                "files_count": len(files),
                "chunks_count": len(chunks),
                "files": files
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
            chunks, files = parse_codebase(extract_path)
            
            if not chunks:
                yield json.dumps({
                    "phase": 4,
                    "message": "ZIP extraction done, but no supported files found.",
                    "files_count": 0,
                    "chunks_count": 0,
                    "files": []
                }) + "\n"
                return
                
            yield json.dumps({"phase": 2, "message": "Phase 2: Building relational code graph..."}) + "\n"
            yield json.dumps({"phase": 3, "message": "Phase 3: Generating embeddings and indexing into ChromaDB..."}) + "\n"
            
            vector_store.add_chunks(chunks)
            set_active_workspace(extract_path)
            
            yield json.dumps({
                "phase": 4,
                "message": f"Successfully extracted and ingested ZIP. Indexed {len(files)} files into {len(chunks)} chunks.",
                "files_count": len(files),
                "chunks_count": len(chunks),
                "files": files
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

@app.post("/api/clear")
def clear_codebase():
    """Clears the local Vector Database store."""
    vector_store.clear_db()
    set_active_workspace(None)
    return {"message": "Vector database store has been cleared."}

@app.post("/api/chat")
async def chat_with_codebase(request: ChatQueryRequest):
    """Retrieves top similarity source snippets and streams response via JSON Lines."""
    try:
        # 1. Retrieval
        contexts = vector_store.query_similar(request.query, n_results=request.n_results)
        
        if not contexts:
            # Fallback if DB is empty or search failed
            async def empty_generator():
                import json
                yield json.dumps({"type": "sources", "sources": []}) + "\n"
                yield json.dumps({"type": "content", "text": "The vector store is currently empty. Please ingest a codebase or upload a ZIP folder first."}) + "\n"
            return StreamingResponse(empty_generator(), media_type="text/event-stream")
            
        # 2. Generation & Streaming
        return StreamingResponse(
            llm_service.stream_answer(request.query, contexts),
            media_type="text/event-stream"
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Retrieval RAG query failed: {str(e)}"
        )
