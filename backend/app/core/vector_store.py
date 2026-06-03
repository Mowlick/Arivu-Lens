import os
import httpx
import chromadb
from typing import List, Dict, Any, Optional
from app.config import settings
from app.core.graph_rag import code_graph_store

class VectorStore:
    def __init__(self):
        # Ensure directory exists
        os.makedirs(settings.CHROMADB_DIR, exist_ok=True)
        self.chroma_client = chromadb.PersistentClient(path=settings.CHROMADB_DIR)
        self.collection = self.chroma_client.get_or_create_collection(
            name=settings.COLLECTION_NAME
        )
        self.http_client = httpx.Client(timeout=60.0)

    def _get_embedding_ollama_batched(self, texts: List[str]) -> List[List[float]]:
        """Fetch embeddings for a list of texts using Ollama's /api/embed API."""
        try:
            response = self.http_client.post(
                f"{settings.OLLAMA_BASE_URL}/api/embed",
                json={
                    "model": settings.EMBEDDING_MODEL,
                    "input": texts
                }
            )
            if response.status_code == 200:
                data = response.json()
                if "embeddings" in data:
                    return data["embeddings"]
            
            raise Exception(f"Ollama batched embedding failed (status {response.status_code})")
        except httpx.ConnectError:
            raise Exception("Ollama is not running. Please start Ollama locally.")
        except Exception as e:
            raise Exception(f"Ollama batched embedding exception: {e}")

    def _get_embedding_ollama_single(self, text: str) -> Optional[List[float]]:
        """Fetch embedding for a single text using Ollama's /api/embeddings API."""
        try:
            response = self.http_client.post(
                f"{settings.OLLAMA_BASE_URL}/api/embeddings",
                json={
                    "model": settings.EMBEDDING_MODEL,
                    "prompt": text
                }
            )
            if response.status_code == 200:
                return response.json().get("embedding")
            print(f"Failed to get single embedding: {response.text}")
        except Exception as e:
            print(f"Error calling single embedding API: {e}")
        return None

    def add_chunks(self, chunks: List[Dict[str, Any]]):
        """Generates embeddings and adds chunks to ChromaDB and the relational Graph RAG store."""
        if not chunks:
            return

        texts = [chunk["content"] for chunk in chunks]
        metadatas = [chunk["metadata"] for chunk in chunks]
        
        # Resolve distinct node IDs. AST parser chunks have custom unique node IDs.
        ids = []
        for idx, chunk in enumerate(chunks):
            if "id" in chunk:
                ids.append(chunk["id"])
            else:
                ids.append(f"{metadatas[idx]['file_path']}_chunk_{metadatas[idx]['chunk_index']}")

        # Process embeddings in batches of 16 to avoid overflowing request size limits
        batch_size = 16
        all_embeddings = []
        for i in range(0, len(texts), batch_size):
            batch_texts = texts[i:i + batch_size]
            embeddings = self._get_embedding_ollama_batched(batch_texts)
            all_embeddings.extend(embeddings)

        # Upsert into ChromaDB
        self.collection.upsert(
            ids=ids,
            embeddings=all_embeddings,
            documents=texts,
            metadatas=metadatas
        )

        # Upsert into relational code graph store
        for idx, chunk in enumerate(chunks):
            node_id = ids[idx]
            name = chunk.get("name") or "anonymous"
            code_graph_store.add_node(node_id, name, chunk["content"], chunk["metadata"])
            
        code_graph_store.save_graph()

    def query_similar(self, query_text: str, n_results: int = 5) -> List[Dict[str, Any]]:
        """Queries ChromaDB and traverses relational neighbors to return connected Graph RAG context."""
        query_vector = self._get_embedding_ollama_single(query_text)
        if not query_vector:
            return []

        # Fetch seed matches
        results = self.collection.query(
            query_embeddings=[query_vector],
            n_results=n_results
        )

        formatted_results = []
        seed_node_ids = []
        
        if results and "documents" in results and results["documents"]:
            docs = results["documents"][0]
            metas = results["metadatas"][0]
            distances = results["distances"][0] if "distances" in results else [0.0] * len(docs)
            ids = results["ids"][0]

            for idx in range(len(docs)):
                seed_node_ids.append(ids[idx])
                formatted_results.append({
                    "id": ids[idx],
                    "content": docs[idx],
                    "metadata": metas[idx],
                    "distance": float(distances[idx])
                })
        
        # Traverse code graph to fetch 1-hop connected neighbors
        try:
            related_nodes = code_graph_store.get_related_nodes(seed_node_ids, max_neighbors=4)
            
            # Map existing seeds for fast check
            existing_ids = {item["id"] for item in formatted_results}
            
            for node in related_nodes:
                if node["id"] not in existing_ids:
                    formatted_results.append({
                        "id": node["id"],
                        "content": node["content"],
                        "metadata": node["metadata"],
                        "distance": 0.1  # Low default distance to index nicely
                    })
        except Exception as e:
            print(f"Graph RAG traversal failed, returning default similarity matches: {e}")

        return formatted_results[:12]  # Cap total nodes to ensure LLM prompt window limits

    def get_all_indexed_files(self) -> List[str]:
        """Query ChromaDB to find all unique file paths already successfully indexed."""
        try:
            results = self.collection.get(include=["metadatas"])
            if not results or "metadatas" not in results or not results["metadatas"]:
                return []
            
            unique_files = set()
            for meta in results["metadatas"]:
                if meta and "file_path" in meta:
                    unique_files.add(meta["file_path"])
            return sorted(list(unique_files))
        except Exception as e:
            print(f"Error reading indexed files from vector database: {e}")
            return []

    def clear_db(self):
        """Clears all records in the ChromaDB collection and the code graph store."""
        try:
            self.chroma_client.delete_collection(settings.COLLECTION_NAME)
            self.collection = self.chroma_client.get_or_create_collection(
                name=settings.COLLECTION_NAME
            )
            code_graph_store.clear()
        except Exception as e:
            print(f"Error resetting database: {e}")

# Single global instance
vector_store = VectorStore()
