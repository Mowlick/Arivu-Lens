import os
import keyword
from typing import List, Dict, Any

# Generic keywords, python keywords, and common frontend/backend variable names
BLACKLISTED_DEPENDENCIES = set(keyword.kwlist) | {
    # JS/TS Keywords/Globals
    "const", "let", "var", "function", "class", "return", "import", "export", 
    "default", "from", "extends", "implements", "interface", "type", "string", 
    "number", "boolean", "any", "void", "true", "false", "null", "undefined",
    "console", "log", "error", "warn", "info", "debug", "window", "document",
    "process", "env", "module", "require", "exports", "Object", "Array", "Promise",
    "JSON", "stringify", "parse", "forEach", "length", "split", "join", "replace",
    # Python Globals/Common terms
    "self", "args", "kwargs", "print", "logger", "logging", "None", "dict", "list",
    "set", "tuple", "str", "int", "float", "bool", "open", "read", "write", "close",
    # Generic short/noise variables
    "data", "item", "items", "value", "values", "key", "keys", "name", "id", "type",
    "state", "props", "event", "query", "request", "response", "result", "results",
    "config", "settings", "options", "params", "body", "headers", "status",
    "message", "text", "file", "path", "dir", "index", "count", "size", "width",
    "height", "top", "left", "right", "bottom", "date", "time", "user", "admin"
}

try:
    from tree_sitter import Parser  # type: ignore
    import tree_sitter_languages  # type: ignore
    HAS_TREE_SITTER = True
except ImportError:
    HAS_TREE_SITTER = False

class CodeGraphParser:
    def __init__(self):
        # Parsers are initialized dynamically per file based on compiler rules
        pass
        
    def _get_language(self, file_ext: str) -> Any:
        """Loads tree-sitter binary grammars dynamically based on file extensions."""
        try:
            if file_ext == '.py':
                return tree_sitter_languages.get_language('python')
            elif file_ext in ['.js', '.jsx']:
                return tree_sitter_languages.get_language('javascript')
            elif file_ext in ['.ts', '.tsx']:
                return tree_sitter_languages.get_language('typescript')
        except Exception as e:
            print(f"Error loading tree-sitter grammar for {file_ext}: {e}")
        return None

    def parse_structure(self, file_path: str, content: str) -> List[Dict[str, Any]]:
        """Parses raw text into functional code blocks with semantic dependencies."""
        if not HAS_TREE_SITTER:
            return []
        ext = os.path.splitext(file_path)[1].lower()
        lang = self._get_language(ext)
        if not lang:
            # If language parser is unavailable, return empty list (caller will fall back to text splitter)
            return []

        try:
            parser = Parser()
            try:
                parser.set_language(lang)
            except AttributeError:
                # Compliant with tree-sitter version 0.22.0+ constructor formats
                parser = Parser(lang)
            
            tree = parser.parse(bytes(content, "utf8"))
            root_node = tree.root_node
        except Exception as e:
            print(f"AST parser initialization failed on {file_path}: {e}")
            return []

        chunks = []
        
        # Traverse AST node children recursively to map code bounds
        def traverse(node, current_class=None):
            class_context = current_class
            if node.type in ['function_definition', 'class_definition', 'method_definition', 'generator_definition']:
                start_byte = node.start_byte
                end_byte = node.end_byte
                code_snippet = content[start_byte:end_byte]
                
                # Extract node identifier string (e.g. name of function or class)
                name_node = node.child_by_field_name('name')
                name = content[name_node.start_byte:name_node.end_byte] if name_node else "anonymous"

                if node.type == 'class_definition':
                    class_context = name

                chunks.append({
                    "id": f"{file_path}_{name}_{node.start_point[0]}",
                    "type": node.type,
                    "name": name,
                    "content": code_snippet,
                    "metadata": {
                        "file_path": file_path,
                        "file_name": os.path.basename(file_path),
                        "language": ext.lstrip('.'),
                        "chunk_index": len(chunks),
                        "start_line": node.start_point[0] + 1,
                        "end_line": node.end_point[0] + 1,
                        "dependencies": self._extract_dependencies(node, content),
                        "parent_class": current_class if node.type != 'class_definition' else None,
                        "type": node.type
                    }
                })
            
            for child in node.children:
                traverse(child, class_context)

        traverse(root_node)
        return chunks

    def _extract_dependencies(self, node, content: str) -> List[Dict[str, str]]:
        """Scans the syntax node for variables, imports, or external calls."""
        deps = []
        seen = set()
        
        def find_identifiers(n, relation="reference"):
            nonlocal deps, seen
            current_relation = relation
            
            if n.type in ('import_statement', 'import_from_statement'):
                # Extract string literal path source for external imports (e.g., from 'react')
                source_str = None
                for child in n.children:
                    if child.type in ('string', 'string_literal'):
                        val = content[child.start_byte:child.end_byte].strip('\'"')
                        if val and not val.startswith('.'):
                            source_str = val.split('/')[0]
                            break
                if source_str and source_str not in seen:
                    deps.append({"symbol": source_str, "relation": "external_import"})
                    seen.add(source_str)
                current_relation = "import"
            elif n.type == 'call':
                current_relation = "call"
            elif n.type == 'class_definition':
                current_relation = "inheritance"

            if n.type == 'identifier':
                name = content[n.start_byte:n.end_byte]
                if (len(name) > 3 and 
                    name not in seen and 
                    name not in BLACKLISTED_DEPENDENCIES and 
                    not name.startswith(('"', "'"))):
                    deps.append({"symbol": name, "relation": current_relation})
                    seen.add(name)
                    
            for c in n.children:
                find_identifiers(c, current_relation)
                
        find_identifiers(node)
        return deps
