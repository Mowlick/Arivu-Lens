import os
import json
from typing import List, Dict, Any, Set
from app.config import settings

class CodeGraphStore:
    def __init__(self):
        self.nodes: Dict[str, Dict[str, Any]] = {}
        # Maps node symbol name to corresponding vector chunk IDs for fast resolution
        self.name_to_ids: Dict[str, List[str]] = {}
        self.persist_path = os.path.join(settings.CHROMADB_DIR, "code_graph.json")
        self.load_graph()

    def clear(self):
        """Wipes the database and clears the persistent graph file."""
        self.nodes.clear()
        self.name_to_ids.clear()
        if os.path.exists(self.persist_path):
            try:
                os.remove(self.persist_path)
            except Exception:
                pass

    def add_node(self, node_id: str, name: str, content: str, metadata: Dict[str, Any]):
        """Adds a code syntax block as a node in the relational codebase graph."""
        self.nodes[node_id] = {
            "id": node_id,
            "name": name,
            "content": content,
            "metadata": metadata
        }
        if name and name != "anonymous":
            if name not in self.name_to_ids:
                self.name_to_ids[name] = []
            if node_id not in self.name_to_ids[name]:
                self.name_to_ids[name].append(node_id)

    def save_graph(self):
        """Serializes and saves the relational code graph to disk."""
        try:
            os.makedirs(os.path.dirname(self.persist_path), exist_ok=True)
            with open(self.persist_path, "w", encoding="utf-8") as f:
                json.dump({
                    "nodes": self.nodes,
                    "name_to_ids": self.name_to_ids
                }, f, indent=2, ensure_ascii=False)
        except Exception as e:
            print(f"Failed to save relational code graph to disk: {e}")

    def load_graph(self):
        """Restores the code relationship graph from disk."""
        if not os.path.exists(self.persist_path):
            return
        try:
            with open(self.persist_path, "r", encoding="utf-8") as f:
                data = json.load(f)
                self.nodes = data.get("nodes", {})
                self.name_to_ids = data.get("name_to_ids", {})
            print(f"Successfully loaded code relationship graph ({len(self.nodes)} nodes).")
        except Exception as e:
            print(f"Failed to restore code graph from disk: {e}")

    def get_related_nodes(self, seed_node_ids: List[str], max_neighbors: int = 5) -> List[Dict[str, Any]]:
        """Traverses the codebase relationships to fetch 1-hop connected dependencies."""
        related_ids: Set[str] = set(seed_node_ids)
        added_count = 0
        
        # 1. Traversal: outgoing edges (which functions/classes this seed node calls)
        for s_id in seed_node_ids:
            if s_id not in self.nodes:
                continue
            
            node = self.nodes[s_id]
            deps = node["metadata"].get("dependencies", [])
            
            for dep in deps:
                if added_count >= max_neighbors:
                    break
                if dep in self.name_to_ids:
                    for target_id in self.name_to_ids[dep]:
                        if target_id not in related_ids:
                            related_ids.add(target_id)
                            added_count += 1
                            
        # 2. Traversal: incoming edges (which functions/classes inside the repo call this seed node)
        for s_id in seed_node_ids:
            if s_id not in self.nodes:
                continue
            
            node = self.nodes[s_id]
            name = node["name"]
            if not name or name == "anonymous":
                continue
                
            for other_id, other_node in self.nodes.items():
                if added_count >= max_neighbors:
                    break
                if other_id in related_ids:
                    continue
                
                other_deps = other_node["metadata"].get("dependencies", [])
                if name in other_deps:
                    related_ids.add(other_id)
                    added_count += 1
                    
        # Assemble complete node structures matching RAG formats
        result = []
        for r_id in related_ids:
            if r_id in self.nodes:
                n = self.nodes[r_id]
                result.append({
                    "id": n["id"],
                    "content": n["content"],
                    "metadata": n["metadata"]
                })
        return result

# Global single relation instance
code_graph_store = CodeGraphStore()
