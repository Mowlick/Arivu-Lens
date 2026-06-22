# compi – Local Code‑base Semantic Search & Chat

## Problem Statement
Software engineers often need to understand large, unfamiliar codebases quickly. Traditional text search tools miss semantic context, and large language models (LLMs) require the entire codebase to be uploaded to external services, raising privacy and latency concerns.

## How compi Solves It
`compi` provides a **self‑hosted** solution that:
1. **Ingests** a directory (or ZIP) of source files.
2. **Parses** each file into logical *chunks* (functions, classes, etc.) using language‑specific parsers and fallback heuristics.
3. Generates **embeddings** via a locally‑run **Ollama** model and stores them in **ChromaDB**.
4. Exposes a **FastAPI** backend with endpoints for:
   - Semantic search and retrieval of relevant chunks.
   - Graph generation that visualises code relationships.
   - Chat interface that answers questions using retrieved context.
5. Serves a modern **React + Vite** frontend (optionally packaged as a desktop app with **Tauri**), allowing interactive file browsing, graph view, and chat.

All processing happens **on‑premises**, keeping proprietary code private and delivering low‑latency responses.

## Core Technologies
| Layer | Technology | Details |
|-------|------------|---------|
| **Backend** | Python 3.11, FastAPI, Pydantic, httpx | REST API, async processing, data validation |
| **Vector Store** | ChromaDB | Persistent on‑disk embeddings collection |
| **LLM / Embeddings** | Ollama (any local model) | Self‑hosted, accessed via HTTP |
| **Parsing / Chunking** | Custom parser (`app/core/parser.py`) – AST for Python, regex fallback for other langs |
| **Graph Generation** | In‑memory graph logic (`graph_rag.py`) | Nodes for files, classes, functions; edges for imports/calls |
| **Frontend** | React, TypeScript, Vite, Tailwind CSS | SPA with file tree, code viewer, graph, chat |
| **Desktop packaging** | Tauri (Rust) | Bundles the web UI as a native Windows app |
| **Persistence** | JSON (`workspace.json`, session files) | Tracks active workspace, chat history, session metadata |

## Key Features
- **Zero‑upload**: All data stays on your machine.
- **Semantic retrieval**: Search by meaning, not just keywords.
- **Interactive graph**: Visualise code structure and dependencies.
- **Session‑based chat**: Preserve conversation context across runs.
- **Multi‑language support**: Python, TypeScript/TSX, JavaScript, etc., with extensible parsers.
- **Desktop ready**: Run as a native app via Tauri.

## Quick Start (Development)
```bash
# Clone repo and navigate
git clone <repo-url> compi && cd compi

# Backend setup
python -m venv venv
venv\Scripts\activate   # PowerShell
pip install -r backend/requirements.txt
uvicorn backend/app/main:app --reload
```
```bash
# Frontend setup
cd frontend
npm install
npm run dev   # Vite dev server (http://localhost:5173)
```
Open the UI, point the **Ingest** dialog at a source folder, and start asking questions!

---
*Generated documentation for the `compi` application.*
