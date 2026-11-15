"""Tests never talk to a paid provider, and never open the worker's database.

A test that forgets to fake the model would otherwise spend real credits with
the developer's own key (it happened once). Whatever asks for a provider's
client here gets one that refuses every call.

The worker's database is the developer's real one on their machine (<repo>/.data)
and does not exist on a clean one (the Windows runner): a test that reads it
passes here and fails there (it happened too). It is refused everywhere.
"""

import pytest


class _Refuses:
    """Stands for a provider's client: any call through it fails the test."""

    def __init__(self, name: str) -> None:
        self._name = name

    def __getattr__(self, attribute: str):
        return _Refuses(f"{self._name}.{attribute}")

    def __call__(self, *args, **kwargs):
        raise AssertionError(f"a test called a real provider ({self._name}): fake the client instead")


@pytest.fixture(autouse=True)
def no_paid_calls(monkeypatch):
    from app.services import openai_client

    monkeypatch.setattr(openai_client, "_client", lambda name, *args, **kwargs: _Refuses(name))
    # The development command would run a real program
    monkeypatch.delenv("CUTTIE_LLM_CMD", raising=False)


@pytest.fixture(autouse=True)
def no_real_database(monkeypatch):
    from app.services import db

    def refuse():
        raise AssertionError("a test opened the worker's database: fake db.get_job (or what it calls) instead")

    monkeypatch.setattr(db, "_get_conn", refuse)
