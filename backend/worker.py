"""
Cuttie worker entry point — runs the local HTTP server defined in app/main.py.

The API starts this process and talks to it over HTTP (127.0.0.1 only).

Run:
    cd backend && uv run python worker.py
"""

import os
import sys

import uvicorn

# Windows: the Visual C++ runtime the desktop app ships (PyTorch and numba need
# it and a fresh Windows doesn't have it). Extension modules don't search the
# PATH, only these folders (the handles are kept: closing one removes it)
_dll_dirs = []
if sys.platform == "win32":
    for folder in filter(None, os.getenv("CUTTIE_DLL_DIRS", "").split(os.pathsep)):
        if os.path.isdir(folder):
            _dll_dirs.append(os.add_dll_directory(folder))

if __name__ == "__main__":
    uvicorn.run(
        "app.main:app",
        host="127.0.0.1",
        port=int(os.getenv("CUTTIE_WORKER_PORT", "3334")),
        log_level="info",
    )
