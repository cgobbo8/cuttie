"""User settings written by the API (paths.SETTINGS_PATH), with env var fallbacks.

The file is re-read whenever it changes, so keys saved from the Settings page
apply to the next API call without restarting the worker.
"""

import json
import os
import threading

from app.services.paths import SETTINGS_PATH

_lock = threading.Lock()
_cache: dict = {"mtime": None, "data": {}}


def _load() -> dict:
    try:
        mtime = os.path.getmtime(SETTINGS_PATH)
    except OSError:
        return {}
    with _lock:
        if _cache["mtime"] != mtime:
            try:
                with open(SETTINGS_PATH, encoding="utf-8") as f:
                    data = json.load(f)
                _cache["data"] = data if isinstance(data, dict) else {}
            except (OSError, ValueError):
                _cache["data"] = {}
            _cache["mtime"] = mtime
        return _cache["data"]


def get(key: str, env_var: str | None = None, default: str = "") -> str:
    """Setting value from settings.json, else from `env_var`, else `default`."""
    value = _load().get(key)
    if value:
        return str(value)
    if env_var:
        return os.getenv(env_var, default)
    return default
