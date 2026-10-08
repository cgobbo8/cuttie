"""
Cuttie worker entry point — runs the local HTTP server defined in app/main.py.

The API starts this process and talks to it over HTTP (127.0.0.1 only).

Run:
    cd backend && uv run python worker.py
"""

import os

import uvicorn

if __name__ == "__main__":
    uvicorn.run(
        "app.main:app",
        host="127.0.0.1",
        port=int(os.getenv("CUTTIE_WORKER_PORT", "3334")),
        log_level="info",
    )
