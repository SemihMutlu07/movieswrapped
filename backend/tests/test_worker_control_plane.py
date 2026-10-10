"""Minimal outbound-worker control plane: token, heartbeat, claim, postback."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

import pytest
from httpx import ASGITransport, AsyncClient

from app import task_manager
from app.config import settings


TOKEN = "test-x370-worker-token"


@pytest.fixture
async def client():
    with patch.dict("os.environ", {"TMDB_API_KEY": "test-key"}):
        from app.main import create_app

        app = create_app()
        app.state.aiohttp_session = object()
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            yield ac


@pytest.fixture
def worker_auth():
    original = settings.worker_token
    settings.worker_token = TOKEN
    task_manager.reset_worker_runtime()
    yield TOKEN
    settings.worker_token = original
    task_manager.reset_worker_runtime()


def _headers(token: str = TOKEN) -> dict[str, str]:
    return {"X-Worker-Token": token}


@pytest.mark.asyncio
async def test_worker_routes_reject_missing_and_wrong_token(client, worker_auth):
    r = await client.post("/api/worker/heartbeat")
    assert r.status_code == 401
    r = await client.post("/api/worker/heartbeat", headers=_headers("nope"), json={"worker_id": "x"})
    assert r.status_code == 401
    r = await client.get("/api/worker/next", headers=_headers("nope"))
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_scrape_without_worker_token_still_runs_inline(client):
    original = settings.worker_token
    settings.worker_token = ""
    try:
        assert not settings.desktop_worker_enabled
        with patch("app.routes.analyze._run_scrape", new=AsyncMock()):
            r = await client.post("/api/scrape-profile", json={"username": "alice"})
        assert r.status_code == 202
        assert r.json()["status"] == "pending"
    finally:
        settings.worker_token = original


@pytest.mark.asyncio
async def test_scrape_fails_fast_to_zip_when_worker_offline(client, worker_auth):
    r = await client.post("/api/scrape-profile", json={"username": "alice"})
    assert r.status_code == 503
    detail = r.json()["detail"]
    assert detail["error_code"] == "desktop_worker_offline"
    assert "export" in detail["message"].lower()


@pytest.mark.asyncio
async def test_stale_heartbeat_fails_fast_to_zip(client, worker_auth):
    await client.post("/api/worker/heartbeat", headers=_headers(), json={"worker_id": "x370"})
    task_manager._last_worker_heartbeat = datetime.now(timezone.utc) - timedelta(seconds=120)
    r = await client.post("/api/scrape-profile", json={"username": "alice"})
    assert r.status_code == 503
    assert r.json()["detail"]["error_code"] == "desktop_worker_offline"


@pytest.mark.asyncio
async def test_heartbeat_enqueue_claim_complete(client, worker_auth):
    hb = await client.post("/api/worker/heartbeat", headers=_headers(), json={"worker_id": "x370"})
    assert hb.status_code == 200

    queued = await client.post("/api/scrape-profile", json={"username": "semihmutsuz", "period": "year"})
    assert queued.status_code == 202
    task_id = queued.json()["task_id"]
    poll_token = queued.json()["poll_token"]

    claimed = await client.get("/api/worker/next", headers=_headers(), params={"worker_id": "x370"})
    assert claimed.status_code == 200
    job = claimed.json()["job"]
    assert job["task_id"] == task_id
    assert job["username"] == "semihmutsuz"
    assert job["options"]["analysis_period"] == "year"
    assert job["lease_token"]

    bad = await client.post(
        f"/api/worker/scrape/{task_id}/complete",
        headers=_headers(),
        json={"stats": {"total_films": 12}, "lease_token": "wrong"},
    )
    assert bad.status_code == 409
    assert bad.json()["detail"]["error_code"] == "lease_mismatch"

    done = await client.post(
        f"/api/worker/scrape/{task_id}/complete",
        headers=_headers(),
        json={"stats": {"total_films": 12, "scraped_username": "semihmutsuz"}, "lease_token": job["lease_token"]},
    )
    assert done.status_code == 200

    progress = await client.get(f"/api/progress/{task_id}", headers={"X-Task-Token": poll_token})
    assert progress.status_code == 200
    body = progress.json()
    assert body["status"] == "done"
    assert body["result"]["stats"]["total_films"] == 12


@pytest.mark.asyncio
async def test_worker_failed_postback(client, worker_auth):
    await client.post("/api/worker/heartbeat", headers=_headers(), json={"worker_id": "x370"})
    queued = await client.post("/api/scrape-profile", json={"username": "blockeduser"})
    task_id = queued.json()["task_id"]
    poll_token = queued.json()["poll_token"]
    job = (await client.get("/api/worker/next", headers=_headers(), params={"worker_id": "x370"})).json()["job"]

    failed = await client.post(
        f"/api/worker/scrape/{task_id}/failed",
        headers=_headers(),
        json={
            "message": "Letterboxd is blocking automated access to this profile.",
            "lease_token": job["lease_token"],
            "telemetry": {"error_code": "scrape_blocked", "error_stage": "scrape"},
        },
    )
    assert failed.status_code == 200
    progress = await client.get(f"/api/progress/{task_id}", headers={"X-Task-Token": poll_token})
    assert progress.json()["status"] == "failed"
    assert progress.json()["error_code"] == "scrape_blocked"


@pytest.mark.asyncio
async def test_next_returns_null_when_queue_empty(client, worker_auth):
    await client.post("/api/worker/heartbeat", headers=_headers(), json={"worker_id": "x370"})
    r = await client.get("/api/worker/next", headers=_headers())
    assert r.status_code == 200
    assert r.json() == {"job": None}
