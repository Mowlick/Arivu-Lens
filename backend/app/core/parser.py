import os
import logging
from typing import List, Dict, Any, Tuple, Optional
from langchain_text_splitters import RecursiveCharacterTextSplitter, Language
from app.config import settings
from app.core.ast_parser import CodeGraphParser

logger = logging.getLogger(__name__)

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

# Encodings to attempt when reading a file, in order of preference
ENCODING_ATTEMPTS = ["utf-8", "utf-8-sig", "latin-1", "cp1252", "ascii"]


def should_ignore(path: str, root_dir: str) -> bool:
    """Returns True if the path (file or dir) should be skipped during traversal."""
    try:
        rel_path = os.path.relpath(path, root_dir)
    except ValueError:
        # On Windows, relpath can fail across drives
        return True
    if rel_path == ".":
        return False
    parts = os.path.normpath(rel_path).split(os.sep)
    for part in parts:
        if part in settings.IGNORE_DIRECTORIES:
            return True
    return False


def get_file_list(directory: str) -> List[str]:
    """Recursively scans a directory and returns relative paths of supported source files."""
    file_list = []
    abs_root = os.path.abspath(directory)

    for root, dirs, files in os.walk(abs_root):
        # Prune ignored subdirectories in-place so os.walk skips them entirely
        dirs[:] = [
            d for d in dirs
            if not should_ignore(os.path.join(root, d), abs_root)
        ]

        for file in files:
            file_path = os.path.join(root, file)
            rel_path = os.path.relpath(file_path, abs_root)
            ext = os.path.splitext(file)[1].lower()

            if ext not in settings.SUPPORTED_EXTENSIONS:
                logger.debug(f"[SKIP - unsupported ext] {rel_path}")
                continue

            if should_ignore(file_path, abs_root):
                logger.debug(f"[SKIP - ignored path] {rel_path}")
                continue

            file_list.append(rel_path)

    logger.info(f"[SCAN] Found {len(file_list)} supported files in {directory}")
    return file_list


def _read_file(abs_path: str, rel_path: str) -> Optional[str]:
    """
    Attempts to read a file using multiple encodings.
    Returns the file content as a string, or None on complete failure.
    """
    for enc in ENCODING_ATTEMPTS:
        try:
            with open(abs_path, "r", encoding=enc, errors="strict") as f:
                content = f.read()
            logger.debug(f"[READ] {rel_path} → encoding={enc}")
            return content
        except UnicodeDecodeError:
            continue
        except PermissionError:
            logger.warning(f"[SKIP - permission denied] {rel_path}")
            return None
        except FileNotFoundError:
            logger.warning(f"[SKIP - file not found] {rel_path}")
            return None
        except OSError as e:
            logger.warning(f"[SKIP - OS error] {rel_path}: {e}")
            return None

    # Last-resort: read with error replacement to capture at least something
    try:
        with open(abs_path, "r", encoding="utf-8", errors="replace") as f:
            content = f.read()
        logger.warning(f"[READ - lossy fallback] {rel_path}: some characters replaced")
        return content
    except Exception as e:
        logger.error(f"[FAILED - unreadable] {rel_path}: {e}")
        return None


def _plain_text_chunks(
    content: str,
    rel_path: str,
    ext: str,
    lang: Optional[Language],
) -> List[Dict[str, Any]]:
    """
    Splits content using RecursiveCharacterTextSplitter with optional language awareness.
    This is the fallback path when AST parsing is unavailable or fails.
    """
    if lang:
        try:
            splitter = RecursiveCharacterTextSplitter.from_language(
                language=lang,
                chunk_size=1500,
                chunk_overlap=200,
            )
        except Exception as e:
            logger.warning(f"[FALLBACK] Language splitter failed for {ext}, using generic: {e}")
            splitter = RecursiveCharacterTextSplitter(chunk_size=1500, chunk_overlap=200)
    else:
        splitter = RecursiveCharacterTextSplitter(chunk_size=1500, chunk_overlap=200)

    documents = splitter.create_documents(
        texts=[content],
        metadatas=[{
            "file_path": rel_path,
            "language": lang.value if lang else "text",
            "file_name": os.path.basename(rel_path),
        }],
    )

    lines = content.split("\n")
    chunks = []
    for idx, doc in enumerate(documents):
        snippet = doc.page_content
        start_line = 1

        # Best-effort line number estimation
        try:
            first_line = snippet[:120].split("\n")[0].strip()
            if first_line:
                for line_idx, line in enumerate(lines):
                    if first_line in line:
                        start_line = line_idx + 1
                        break
        except Exception:
            pass

        end_line = start_line + snippet.count("\n")

        chunks.append({
            "content": snippet,
            "metadata": {
                "file_path": rel_path,
                "file_name": os.path.basename(rel_path),
                "language": lang.value if lang else "text",
                "chunk_index": idx,
                "start_line": start_line,
                "end_line": end_line,
            },
        })

    return chunks


def chunk_file(base_dir: str, rel_path: str) -> List[Dict[str, Any]]:
    """
    Reads a single file and returns semantic chunks with metadata.

    Strategy:
      1. Read file content (try multiple encodings).
      2. For Python / JS / TS files → try AST-based chunking first.
      3. If AST fails or returns nothing → fall back to language-aware text splitting.
      4. For all other supported types → plain text splitting directly.
      5. Any exception at any stage is caught; returns [] rather than crashing.
    """
    abs_path = os.path.abspath(os.path.join(base_dir, rel_path))
    ext = os.path.splitext(rel_path)[1].lower()

    # --- Step 1: Read file ---
    content = _read_file(abs_path, rel_path)
    if content is None:
        return []

    if not content.strip():
        logger.info(f"[SKIP - empty] {rel_path}")
        return []

    # --- Step 2: AST parsing for supported languages ---
    if ext in (".py", ".js", ".jsx", ".ts", ".tsx"):
        try:
            ast_chunks = ast_parser.parse_structure(rel_path, content)
            if ast_chunks:
                logger.info(f"[AST] {rel_path} → {len(ast_chunks)} chunks")
                return ast_chunks
            else:
                logger.info(f"[AST → 0 chunks] {rel_path}: falling back to text splitter")
        except Exception as e:
            logger.warning(f"[AST FAIL] {rel_path}: {e} — falling back to text splitter")

    # --- Step 3/4: Text-based splitting ---
    lang = EXTENSION_TO_LANGUAGE.get(ext)
    try:
        chunks = _plain_text_chunks(content, rel_path, ext, lang)
    except Exception as e:
        logger.error(f"[CHUNK FAIL] {rel_path}: {e}")
        return []

    if not chunks:
        logger.warning(f"[FALLBACK - 0 chunks] Text splitter produced nothing for {rel_path}")
    else:
        logger.info(f"[TEXT SPLIT] {rel_path} → {len(chunks)} chunks (lang={lang})")

    return chunks


def parse_codebase(directory: str) -> Tuple[List[Dict[str, Any]], List[str]]:
    """
    Entry point: traverse a directory, chunk all valid files, return (chunks, file_list).
    Individual file failures are logged and skipped — they never crash the whole ingest.
    """
    all_chunks: List[Dict[str, Any]] = []
    file_list = get_file_list(directory)

    success = 0
    failed = 0

    for rel_path in file_list:
        try:
            file_chunks = chunk_file(directory, rel_path)
            if file_chunks:
                all_chunks.extend(file_chunks)
                success += 1
            else:
                failed += 1
        except Exception as e:
            logger.error(f"[PARSE FAIL] Unexpected error on {rel_path}: {e}")
            failed += 1

    logger.info(
        f"[PARSE DONE] {directory}: "
        f"{success} files chunked, {failed} failed, "
        f"{len(all_chunks)} total chunks"
    )
    return all_chunks, file_list
