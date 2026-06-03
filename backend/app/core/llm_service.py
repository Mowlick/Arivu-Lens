import json
import httpx
from typing import List, Dict, Any, AsyncGenerator
from app.config import settings

class LLMService:
    def __init__(self):
        # We use an async client for streaming responses
        self.ollama_url = f"{settings.OLLAMA_BASE_URL}/api/chat"

    def _build_system_prompt(self, contexts: List[Dict[str, Any]]) -> str:
        """Assembles context snippets into a cohesive system instructions prompt."""
        context_str = ""
        for idx, ctx in enumerate(contexts):
            meta = ctx["metadata"]
            context_str += f"\n--- Source File {idx + 1}: {meta.get('file_path')} (Lines {meta.get('start_line')}-{meta.get('end_line')}) ---\n"
            context_str += ctx["content"]
            context_str += "\n"

        prompt = (
            "You are a highly skilled Senior Software Engineer and Architect. "
            "Analyze the provided codebase snippets carefully to answer the user's question.\n\n"
            "Guidelines:\n"
            "1. Rely primarily on the provided source snippets for your answers.\n"
            "2. If the answer cannot be determined or inferred from the context, state clearly that "
            "the provided codebase chunks do not contain enough information to answer, but offer "
            "highly educated engineering suggestions if applicable.\n"
            "3. When referencing functions, classes, or patterns, mention which source file they are located in.\n"
            "4. Provide well-formatted code blocks with syntax highlighting (e.g. ```python, ```javascript) when suggesting changes or illustrating points.\n"
            "5. Keep responses structured, concise, and strictly technical.\n\n"
            "Here is the retrieved codebase context:\n"
            "==================================================\n"
            f"{context_str}"
            "==================================================\n"
        )
        return prompt

    async def stream_answer(self, query: str, contexts: List[Dict[str, Any]]) -> AsyncGenerator[str, None]:
        """Queries Ollama and streams back a JSON-line structure containing source files and tokens."""
        system_prompt = self._build_system_prompt(contexts)
        
        # Prepare list of sources to send as the first JSON-line
        sources = []
        for ctx in contexts:
            meta = ctx["metadata"]
            sources.append({
                "file_path": meta.get("file_path"),
                "file_name": meta.get("file_name"),
                "start_line": meta.get("start_line"),
                "end_line": meta.get("end_line"),
                "language": meta.get("language")
            })

        # Yield sources as the first item
        yield json.dumps({"type": "sources", "sources": sources}) + "\n"

        payload = {
            "model": settings.LLM_MODEL,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": query}
            ],
            "stream": True,
            "options": {
                "temperature": 0.2  # Lower temperature for accurate coding facts
            }
        }

        try:
            async with httpx.AsyncClient(timeout=120.0) as client:
                async with client.stream("POST", self.ollama_url, json=payload) as response:
                    if response.status_code != 200:
                        err_msg = f"Ollama model error (status {response.status_code})"
                        yield json.dumps({"type": "content", "text": f"\n\n*Error: {err_msg}*" }) + "\n"
                        return

                    async for line in response.aiter_lines():
                        if not line.strip():
                            continue
                        
                        try:
                            chunk_data = json.loads(line)
                            message = chunk_data.get("message", {})
                            token = message.get("content", "")
                            if token:
                                yield json.dumps({"type": "content", "text": token}) + "\n"
                        except Exception as json_err:
                            # If individual parsing fails, log and continue
                            print(f"Failed to parse streaming line: {json_err}")
                            
        except Exception as e:
            yield json.dumps({"type": "content", "text": f"\n\n*Ollama connection error: {str(e)}*" }) + "\n"

llm_service = LLMService()
