"""Test the worker HTTP server basics."""

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app


@pytest.fixture
async def client(monkeypatch):
    monkeypatch.setenv("CUTTIE_INTERNAL_SECRET", "test-secret")
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


@pytest.mark.asyncio
async def test_health_endpoint(client):
    response = await client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


@pytest.mark.asyncio
async def test_job_endpoints_require_secret(client):
    response = await client.post("/jobs", json={"job_id": "abc", "url": "https://twitch.tv/videos/1"})
    assert response.status_code == 401

    response = await client.get("/queue", headers={"X-Cuttie-Secret": "wrong"})
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_rejects_invalid_job_id(client):
    response = await client.post(
        "/jobs",
        json={"job_id": "../etc", "url": "https://twitch.tv/videos/1"},
        headers={"X-Cuttie-Secret": "test-secret"},
    )
    assert response.status_code == 400


@pytest.mark.asyncio
async def test_queue_snapshot(client):
    response = await client.get("/queue", headers={"X-Cuttie-Secret": "test-secret"})
    assert response.status_code == 200
    assert response.json() == {"current": None, "items": []}
