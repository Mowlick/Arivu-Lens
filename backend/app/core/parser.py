import os
from typing import List, Dict, Any, Tuple
from langchain_text_splitters import RecursiveCharacterTextSplitter, Language
from app.config import settings
from app.core.ast_parser import CodeGraphParser

# Global syntax parser instance
ast_parser = CodeGraphParser()

# Mapping of file extensions to langchain_text_splitters Languages
EXTENSION_TO_LANGUAGE = {
    ".py": Language.PYTHON,
    ".js": Language.JS,
    ".jsx": Language.JS,
    ".ts": Language.TS,
    ".tsx": Language.TS,
    ".go": Language.GO,
    ".rs": Language.RUST,
    ".c": Language.CPP,
    ".cpp": Language.CPP,
    ".h": Language.CPP,
    ".hpp": Language.CPP,
    ".java": Language.JAVA,
    ".html": Language.HTML,
    ".md": Language.MARKDOWN,
}

def should_ignore(path: str, root_dir: str) -> bool:
    """Check if the file or directory should be ignored during parsing."""
    rel_path = os.path.relpath(path, root_dir)
    if rel_path == ".":
        return False
    parts = os.path.normpath(rel_path).split(os.sep)
    for part in parts:
        if part in settings.IGNORE_DIRECTORIES:
            return True
    return False

def get_file_list(directory: str) -> List[str]:
    """Scan directory and return a list of supported files with relative paths."""
    file_list = []
    abs_root = os.path.abspath(directory)
    
    for root, dirs, files in os.walk(abs_root):
        # Filter directories in-place to avoid traversing ignored ones
        dirs[:] = [d for d in dirs if not should_ignore(os.path.join(root, d), abs_root)]
        
        for file in files:
            file_path = os.path.join(root, file)
            rel_path = os.path.relpath(file_path, abs_root)
            ext = os.path.splitext(file)[1].lower()
            
            if ext in settings.SUPPORTED_EXTENSIONS and not should_ignore(file_path, abs_root):
                file_list.append(rel_path)
                
    return file_list

def chunk_file(base_dir: str, rel_path: str) -> List[Dict[str, Any]]:
    """Reads a file and splits it into logical, language-aware chunks with metadata."""
    abs_path = os.path.abspath(os.path.join(base_dir, rel_path))
    ext = os.path.splitext(rel_path)[1].lower()
    
    try:
        with open(abs_path, 'r', encoding='utf-8', errors='ignore') as f:
            content = f.read()
    except Exception as e:
        print(f"Error reading file {abs_path}: {e}")
        return []
        
    if not content.strip():
        return []

    # 1. Structural AST parsing for supported languages
    if ext in ['.py', '.js', '.jsx', '.ts', '.tsx']:
        try:
            ast_chunks = ast_parser.parse_structure(rel_path, content)
            if ast_chunks:
                return ast_chunks
        except Exception as e:
            print(f"Tree-sitter AST parsing failed on {rel_path}, falling back to character splits: {e}")
        
    lang = EXTENSION_TO_LANGUAGE.get(ext)
    
    if lang:
        splitter = RecursiveCharacterTextSplitter.from_language(
            language=lang,
            chunk_size=1500,
            chunk_overlap=200
        )
    else:
        splitter = RecursiveCharacterTextSplitter(
            chunk_size=1500,
            chunk_overlap=200
        )
        
    # Split content and obtain structural chunks
    documents = splitter.create_documents(
        texts=[content],
        metadatas=[{"file_path": rel_path, "language": lang.value if lang else "text", "file_name": os.path.basename(rel_path)}]
    )
    
    chunks = []
    for idx, doc in enumerate(documents):
        # Identify approximate start/end lines for references
        snippet = doc.page_content
        lines = content.split('\n')
        start_line = 1
        
        # Simple heuristic to find line numbers
        try:
            # Look for snippet starting substring
            first_few_chars = snippet[:100].strip()
            for line_idx, line in enumerate(lines):
                if first_few_chars in line:
                    start_line = line_idx + 1
                    break
        except Exception:
            pass
            
        end_line = start_line + snippet.count('\n')
        
        chunks.append({
            "content": snippet,
            "metadata": {
                "file_path": rel_path,
                "file_name": os.path.basename(rel_path),
                "language": lang.value if lang else "text",
                "chunk_index": idx,
                "start_line": start_line,
                "end_line": end_line
            }
        })
        
    return chunks

def parse_codebase(directory: str) -> Tuple[List[Dict[str, Any]], List[str]]:
    """Traverses a directory, chunks all valid files, and returns chunks and file list."""
    all_chunks = []
    file_list = get_file_list(directory)
    
    for rel_path in file_list:
        file_chunks = chunk_file(directory, rel_path)
        all_chunks.extend(file_chunks)
        
    return all_chunks, file_list
