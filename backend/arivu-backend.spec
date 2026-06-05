# -*- mode: python ; coding: utf-8 -*-
from PyInstaller.utils.hooks import collect_submodules, collect_data_files, collect_dynamic_libs

# Collect ALL submodules of chromadb dynamically - this handles the
# pkgutil.iter_modules() dynamic import pattern used by embedding_functions
chromadb_hidden = collect_submodules('chromadb')

# tokenizers is a Rust native extension imported by chromadb's ONNX embedding function
tokenizers_hidden = collect_submodules('tokenizers')
tokenizers_datas = collect_data_files('tokenizers')

# Collect tree-sitter languages DLLs
tree_sitter_datas = collect_data_files('tree_sitter_languages')

# Collect chromadb data files (migrations SQL, etc.)
chromadb_datas = collect_data_files('chromadb')

a = Analysis(
    ['run.py'],
    pathex=[],
    binaries=[],
    datas=chromadb_datas + tokenizers_datas + tree_sitter_datas,
    hiddenimports=chromadb_hidden + tokenizers_hidden + [
        # Uvicorn runtime protocol handlers
        'uvicorn.protocols.http.h11_impl',
        'uvicorn.protocols.http.httptools_impl',
        'uvicorn.protocols.websockets.websockets_impl',
        'uvicorn.protocols.websockets.wsproto_impl',
        'uvicorn.lifespan.on',
        'uvicorn.lifespan.off',
        # Pydantic
        'pydantic.deprecated.decorator',
        'pydantic_core',
        # Tree-sitter
        'tree_sitter_languages',
        # FastAPI / Starlette
        'fastapi',
        'starlette.routing',
        'starlette.middleware.cors',
        'anyio',
        'anyio._backends._asyncio',
        'anyio._backends._trio',
        # NumPy - REQUIRED by chromadb; PyInstaller misses these without explicit listing
        'numpy',
        'numpy.core',
        'numpy.core._multiarray_umath',
        'numpy.core.multiarray',
        'numpy.core.numeric',
        'numpy.core._dtype_ctypes',
        'numpy.lib',
        'numpy.lib.stride_tricks',
        'numpy.linalg',
        'numpy.fft',
        'numpy.random',
        'numpy.random._common',
        'numpy.random._bounded_integers',
        'numpy.random._generator',
        'numpy.random.mtrand',
        # ChromaDB embedding function submodules - dynamically imported via pkgutil,
        # so PyInstaller static analysis misses them entirely
        'chromadb.utils.embedding_functions.amazon_bedrock_embedding_function',
        'chromadb.utils.embedding_functions.chroma_langchain_embedding_function',
        'chromadb.utils.embedding_functions.cohere_embedding_function',
        'chromadb.utils.embedding_functions.google_embedding_function',
        'chromadb.utils.embedding_functions.huggingface_embedding_function',
        'chromadb.utils.embedding_functions.instructor_embedding_function',
        'chromadb.utils.embedding_functions.jina_embedding_function',
        'chromadb.utils.embedding_functions.ollama_embedding_function',
        'chromadb.utils.embedding_functions.onnx_mini_lm_l6_v2',
        'chromadb.utils.embedding_functions.open_clip_embedding_function',
        'chromadb.utils.embedding_functions.openai_embedding_function',
        'chromadb.utils.embedding_functions.roboflow_embedding_function',
        'chromadb.utils.embedding_functions.sentence_transformer_embedding_function',
        'chromadb.utils.embedding_functions.text2vec_embedding_function',
        # ONNX Runtime (used by chromadb onnx_mini_lm_l6_v2 embedding function)
        'onnxruntime',
        # Langchain text splitters
        'langchain_text_splitters',
        'langchain_core',
        # httpx transport
        'httpx',
        'httpcore',
        # SQLite3 (chromadb PersistentClient)
        'sqlite3',
        '_sqlite3',
        # ChromaDB executor modules
        'chromadb.execution.executor.local',
        'chromadb.execution.executor.distributed',
        'chromadb.telemetry.product.posthog',
        'chromadb.api.segment',
        # ChromaDB segment modules
        'chromadb.segment.impl.metadata',
        'chromadb.segment.impl.metadata.sqlite',
        'chromadb.segment.impl.vector.local_hnsw',
        'chromadb.segment.impl.vector.local_persistent_hnsw',
        'chromadb.segment.impl.manager.local',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        'matplotlib', 'pandas', 'scipy', 'IPython', 'PIL', 'tkinter',
        'torch', 'tensorflow', 'tensorboard', 'notebook', 'h5py', 'cv2',
        'sklearn', 'scikit-learn', 'nltk', 'keras', 'spacy', 'markdown',
        'torchaudio', 'torchvision'
    ],
    noarchive=False,
)
pyz = PYZ(a.pure)
exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name='compi-backend',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
