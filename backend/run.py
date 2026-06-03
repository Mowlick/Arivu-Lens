import os
import sys
import uvicorn
import app.main

if __name__ == "__main__":
    port = int(os.getenv("PORT", 8000))
    is_prod = os.getenv("ARIVU_PRODUCTION") == "TRUE" or getattr(sys, 'frozen', False)
    reload = not is_prod
    
    print(f"Starting Arivu-Lens Backend Server on http://127.0.0.1:{port}...")
    uvicorn.run("app.main:app", host="127.0.0.1", port=port, reload=reload)
