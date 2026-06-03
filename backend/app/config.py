import os
import sys
from pathlib import Path

class Settings:
    # API Settings
    API_V1_STR: str = "/api"
    PROJECT_NAME: str = "Arivu-Lens"
    
    # Production Path Resolution
    IS_PRODUCTION: bool = os.getenv("ARIVU_PRODUCTION") == "TRUE"
    
    if IS_PRODUCTION:
        # Resolve platform-agnostic OS local application data directories
        if sys.platform == "win32":
            base_dir = Path(os.getenv("LOCALAPPDATA", os.path.expanduser("~\\AppData\\Local")))
        elif sys.platform == "darwin":
            base_dir = Path(os.path.expanduser("~/Library/Application Support"))
        else:
            base_dir = Path(os.getenv("XDG_DATA_HOME", os.path.expanduser("~/.local/share")))
        
        ROOT_STORAGE = base_dir / "ArivuLens"
    else:
        ROOT_STORAGE = Path(os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))
    
    # Ensure deep recursive storage paths exist
    os.makedirs(str(ROOT_STORAGE), exist_ok=True)
    
    # Ollama Settings
    OLLAMA_BASE_URL: str = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434").rstrip("/")
    EMBEDDING_MODEL: str = os.getenv("EMBEDDING_MODEL", "nomic-embed-text")
    LLM_MODEL: str = os.getenv("LLM_MODEL", "qwen2.5-coder:7b")
    
    # ChromaDB Settings
    CHROMADB_DIR: str = str(ROOT_STORAGE / ".chromadb_store")
    COLLECTION_NAME: str = "compi_lens_codebase"
    
    # File Processing Settings
    SUPPORTED_EXTENSIONS: set = {
        ".py", ".js", ".ts", ".tsx", ".jsx", ".dart", ".go", 
        ".rs", ".java", ".cpp", ".c", ".h", ".hpp", ".css", 
        ".html", ".md", ".json", ".yml", ".yaml", ".sh"
    }
    
    IGNORE_DIRECTORIES: set = {
        "node_modules", ".git", "venv", ".venv", "env", ".env", 
        "__pycache__", "build", "dist", "out", ".next", ".gradle", 
        ".idea", ".vscode", "target", ".chromadb_store"
    }

settings = Settings()
