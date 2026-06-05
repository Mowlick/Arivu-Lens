import os
from typing import List, Dict, Any

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
        def traverse(node):
            if node.type in ['function_definition', 'class_definition', 'method_definition', 'generator_definition']:
                start_byte = node.start_byte
                end_byte = node.end_byte
                code_snippet = content[start_byte:end_byte]
                
                # Extract node identifier string (e.g. name of function or class)
                name_node = node.child_by_field_name('name')
                name = content[name_node.start_byte:name_node.end_byte] if name_node else "anonymous"

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
                        "dependencies": self._extract_dependencies(node, content)
                    }
                })
            
            for child in node.children:
                traverse(child)

        traverse(root_node)
        return chunks

    def _extract_dependencies(self, node, content: str) -> List[str]:
        """Scans the syntax node for variables, imports, or external calls."""
        deps = []
        
        def find_identifiers(n):
            if n.type in ['call', 'identifier', 'import_from_statement', 'import_statement']:
                name = content[n.start_byte:n.end_byte]
                # Filter noise and short symbols to keep clean graph references
                if len(name) > 3 and name not in deps and not name.startswith(('"', "'")):
                    deps.append(name)
            for c in n.children:
                find_identifiers(c)
                
        find_identifiers(node)
        return deps
