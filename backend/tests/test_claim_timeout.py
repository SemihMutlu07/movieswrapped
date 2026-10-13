"""Silent scrape claims fail open to ZIP. A live worker is left alone."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import pytest
from httpx import ASGITransport, AsyncClient

from app import task_manager
from app.config import settings
from app.routes.analyze import (
    PROGRESS_RATE_LIMIT,
    PROGRESS_RATE_WINDOW_SECONDS,
    SCRAPE_PROGRESS_POLL_INTERVAL_MS,
)

TOKEN = "test-x370-worker-token"


def _hb(worker_id: str = "x370") -> dict:
    return {
        "worker_id": worker_id,
        "protocol_version": settings.worker_protocol_version,
        "git_sha": "",
        "max_concurrency": 1,
    }


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


async def _claimed_job(client: AsyncClient, username: str = "semihmutsuz") -> tuple[str, str, str]:
    hb = await client.post("/api/worker/heartbeat", headers=_headers(), json=_hb())
    assert hb.status_code == 200
    queued = await client.post("/api/scrape-profile", json={"username": username, "period": "lifetime"})
    assert queued.status_code == 202
    body = queued.json()
    claimed = await client.get("/api/worker/next", headers=_headers(), params={"worker_id": "x370"})
    assert claimed.status_code == 200
    job = claimed.json()["job"]
    assert job["task_id"] == body["task_id"]
    return body["task_id"], body["poll_token"], job["lease_token"]


def _age_claim(task_id: str, seconds: float) -> None:
    job = task_manager.get_task_state(task_id)
    assert job is not None
    job.claimed_at = datetime.now(timezone.utc) - timedelta(seconds=seconds)
    task_manager._worker_heartbeats["x370"] = datetime.now(timezone.utc)


@pytest.mark.asyncio
async def test_one_tab_progress_poll_is_not_429(client: AsyncClient):
    """One profile tab at the scrape interval stays under the progress cap."""
    one_tab_polls = PROGRESS_RATE_WINDOW_SECONDS * 1000 // SCRAPE_PROGRESS_POLL_INTERVAL_MS
    assert SCRAPE_PROGRESS_POLL_INTERVAL_MS == 400
    assert one_tab_polls == 150
    assert one_tab_polls < PROGRESS_RATE_LIMIT

    task_id = task_manager.create_task_state("one-tab")
    task = task_manager.get_task_state(task_id)
    assert task is not None
    headers = {"X-Task-Token": task.poll_token}
    for _ in range(one_tab_polls):
        response = await client.get(f"/api/progress/{task_id}", headers=headers)
        assert response.status_code == 200, response.text


@pytest.mark.asyncio
async def test_missing_worker_is_503(client: AsyncClient, worker_auth):
    response = await client.post("/api/scrape-profile", json={"username": "semihmutsuz"})
    assert response.status_code == 503
    detail = response.json()["detail"]
    assert detail["error_code"] == "desktop_worker_offline"
    assert "zip" in detail["message"].lower()


@pytest.mark.asyncio
async def test_silent_claim_fails_open_to_zip_at_90_seconds(client: AsyncClient, worker_auth):
    task_id, poll_token, _lease = await _claimed_job(client)
    _age_claim(task_id, 90)

    progress = await client.get(
        f"/api/progress/{task_id}",
        headers={"X-Task-Token": poll_token},
    )
    assert progress.status_code == 200
    body = progress.json()
    assert body["status"] == "failed"
    assert body["error_code"] == "claim_timeout"
    assert "zip" in (body["error"] or "").lower()
    job = task_manager.get_task_state(task_id)
    assert job is not None
    assert job.claimed is False


@pytest.mark.asyncio
async def test_claim_inside_90_seconds_stays_open(client: AsyncClient, worker_auth):
    task_id, poll_token, _lease = await _claimed_job(client)
    _age_claim(task_id, 89)

    progress = await client.get(
        f"/api/progress/{task_id}",
        headers={"X-Task-Token": poll_token},
    )
    body = progress.json()
    assert body["status"] == "running"
    assert body["error_code"] is None


@pytest.mark.asyncio
async def test_page_events_are_not_killed_at_90_seconds(client: AsyncClient, worker_auth):
    task_id, poll_token, lease = await _claimed_job(client)
    posted = await client.post(
        f"/api/worker/scrape/{task_id}/event",
        headers=_headers(),
        json={
            "lease_token": lease,
            "stage": "diary_page",
            "message": "Diary page 1 parsed",
            "metrics": {"page": 1, "films": 24},
        },
    )
    assert posted.status_code == 200
    _age_claim(task_id, 120)

    progress = await client.get(
        f"/api/progress/{task_id}",
        headers={"X-Task-Token": poll_token},
    )
    body = progress.json()
    assert body["status"] == "running"
    assert body["error_code"] is None
    assert body["progress"] >= 1


@pytest.mark.asyncio
async def test_complete_is_not_killed_when_the_claim_is_already_old(client: AsyncClient, worker_auth):
    task_id, poll_token, lease = await _claimed_job(client)
    _age_claim(task_id, 120)
    done = await client.post(
        f"/api/worker/scrape/{task_id}/complete",
        headers=_headers(),
        json={
            "stats": {"total_films": 12, "scraped_username": "semihmutsuz"},
            "lease_token": lease,
        },
    )
    assert done.status_code == 200

    progress = await client.get(
        f"/api/progress/{task_id}",
        headers={"X-Task-Token": poll_token},
    )
    body = progress.json()
    assert body["status"] == "done"
    assert body["result"]["stats"]["total_films"] == 12
