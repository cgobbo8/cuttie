"""Tests never talk to a paid provider.

A test that forgets to fake the model would otherwise spend real credits with
the developer's own key (it happened once). Whatever asks for a provider's
client here gets one that refuses every call.
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
