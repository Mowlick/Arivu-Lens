# Compi-Lens 🔍

Compi-Lens is an enterprise-grade, privacy-first **Local Codebase Search & AI engineering assistant**. It allows you to point the app to a local directory or drag-and-drop a ZIP folder, processes and indexes the files into a local semantic vector database, and lets you chat with an open-source model—**all without a single byte of your code ever leaving your machine**.

---

## 🛠️ Technology Stack

* **Frontend**: React (TypeScript), Vite, Tailwind CSS, Lucide Icons, React Markdown.
* **Backend API**: FastAPI (Python), Uvicorn.
* **Vector Store**: ChromaDB (Local Persistent Storage).
* **Embeddings Model**: `nomic-embed-text` (running locally via Ollama).
* **LLM Inference**: `qwen2.5-coder:7b` or `llama3` (running locally via Ollama).

---

## 🚀 Setup Instructions

Follow these steps to run Compi-Lens completely locally.

### Step 1: Install & Set Up Ollama

1. Download and install [Ollama](https://ollama.com/) on your local machine.
2. Open a terminal and pull the required embedding and coding models:
   ```bash
   # Pull embedding model (768 dimensions, highly optimized for code/text)
   ollama pull nomic-embed-text
   
   # Pull the local reasoning LLM (perfect for code interpretation)
   ollama pull qwen2.5-coder:7b
   ```
3. Make sure the Ollama server is running (default port is `11434`).

### Step 2: Run the Backend API

1. Navigate to the `backend/` directory:
   ```bash
   cd backend
   ```
2. Create a virtual environment (optional but recommended):
   ```bash
   python -m venv venv
   # On Windows:
   venv\Scripts\activate
   # On macOS/Linux:
   source venv/bin/activate
   ```
3. Install required Python packages:
   ```bash
   pip install -r requirements.txt
   ```
4. Start the FastAPI server:
   ```bash
   python run.py
   ```
   The backend will run on [http://127.0.0.1:8000](http://127.0.0.1:8000). You can check Swagger docs at `/docs`.

### Step 3: Run the Frontend Application

1. Open a new terminal and navigate to the `frontend/` directory:
   ```bash
   cd frontend
   ```
2. Make sure dependencies are installed (already scaffolded):
   ```bash
   npm install
   ```
3. Launch the local dev server:
   ```bash
   npm run dev
   ```
   The user interface will be available at [http://localhost:5173](http://localhost:5173).

---

## 💡 How It Works (RAG Flow)

1. **Ingest**: Specify a local folder path or upload a `.zip`. Files are loaded, ignoring directories like `.git`, `node_modules`, etc.
2. **Chunk**: Code files are parsed and chunked using **Language-Aware Recursive Separators** (keeping classes and functions contextually together).
3. **Embed**: Chunks are sent to the local Ollama `/api/embed` endpoint using `nomic-embed-text`.
4. **Store**: Vectors are written directly to a local, persistent **ChromaDB** store.
5. **Retrieve**: When you ask a question, your query is embedded, ChromaDB retrieves the top 3-5 most mathematically relevant source snippets.
6. **Synthesize & Stream**: The retrieved code chunks are injected into a system developer prompt, and the `qwen2.5-coder:7b` model streams the answer back to your chat window, highlighting the files utilized as sources.

---

## 🔒 100% Privacy Guard

Compi-Lens runs entirely within your localhost environment:
* No external API keys required.
* Zero external network calls are made.
* Code indexing, chunking, embedding, vector search, and model inference are strictly local.
