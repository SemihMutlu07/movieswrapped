"""
Desktop scrape worker — backend API tests.

Covers desktop-worker mode on /api/scrape-profile and the authenticated
/api/worker/* job endpoints. State in app.task_manager is process-global, so
each test resets it.

Run from backend/ directory:
    pytest tests/test_worker.py
"""
import pytest
from httpx import AsyncClient, ASGITransport
from unittest.mock import AsyncMock, patch

from app import task_manager
from app.config import settings
from app.services import dashboard_settings
from app.worker.desktop_scrape_worker import WorkerConfig, _worker_meta

from datetime import datetime, timedelta, timezone

WORKER_TOKEN = "test-worker-secret"
AUTH = {"X-Worker-Token": WORKER_TOKEN}
ADMIN_KEY = "test-admin-secret-rotated"
ADMIN_AUTH = {"Authorization": f"Bearer {ADMIN_KEY}"}


def _with_lease(task_id: str, body: dict) -> dict:
    """Attach the claim lease_token so postbacks pass the lease gate."""
    task = task_manager.get_task_state(task_id)
    if task and task.lease_token:
        return {**body, "lease_token": task.lease_token}
    return body


def test_worker_reports_direct_cloudscraper_transport(monkeypatch):
    monkeypatch.setenv("WORKER_BACKEND_URL", "https://backend.example.com")
    monkeypatch.setenv("WORKER_TOKEN", WORKER_TOKEN)
    cfg = WorkerConfig()
    assert _worker_meta(cfg)["scrape_transport"] == "direct_cloudscraper"


def test_worker_meta_includes_identity_and_load(monkeypatch):
    """Heartbeat payload must carry worker_id/version/active_jobs/max_concurrency."""
    monkeypatch.setenv("WORKER_BACKEND_URL", "https://backend.example.com")
    monkeypatch.setenv("WORKER_TOKEN", WORKER_TOKEN)
    cfg = WorkerConfig()
    meta = _worker_meta(cfg)
    assert meta["worker_id"]
    assert meta["version"]
    assert meta["active_jobs"] == 0
    assert meta["max_concurrency"] == 1


def test_worker_config_identity_is_env_overrideable(monkeypatch):
    monkeypatch.setenv("WORKER_ID", "custom-worker")
    monkeypatch.setenv("WORKER_VERSION", "2.1.0")
    import importlib
    from app.worker import worker_config
    worker_config = importlib.reload(worker_config)
    assert worker_config.WORKER_ID == "custom-worker"
    assert worker_config.WORKER_VERSION == "2.1.0"


def test_requeue_stale_claims_recovers_dead_worker_jobs():
    """A job claimed then abandoned (desktop offline mid-scrape) must be re-queued,
    not left stuck 'running' until it 404s on the user."""
    from datetime import datetime, timedelta, timezone

    task_manager._tasks.clear()
    task_manager._last_worker_heartbeat = None  # worker offline -> lease reclaimable
    task_manager._worker_heartbeats.clear()
    tid = task_manager.create_scrape_job("ghost")
    job = task_manager.claim_next_scrape_job(worker_id="worker-a")
    assert job.task_id == tid and job.status == "running"
    job.claimed_at = datetime.now(timezone.utc) - timedelta(seconds=task_manager.STALE_CLAIM_SECONDS + 60)
    assert task_manager.requeue_stale_claims() == 1
    assert job.status == "pending" and job.claimed is False and job.claimed_at is None
    task_manager.claim_next_scrape_job(worker_id="worker-a")
    assert task_manager.requeue_stale_claims() == 0
    task_manager._tasks.clear()


def test_watchlist_jobs_use_capacity_owner_and_stale_requeue(monkeypatch):
    from datetime import datetime, timedelta, timezone

    task_manager._tasks.clear()
    task_manager._last_worker_heartbeat = None  # worker offline -> lease reclaimable
    task_manager._worker_heartbeats.clear()
    monkeypatch.setattr(task_manager, "MAX_ACTIVE_PER_OWNER", 1)
    tid = task_manager.create_watchlist_compare_job(["one", "two"], owner_key="owner")
    with pytest.raises(RuntimeError, match="queue_full"):
        task_manager.create_date_night_job(["one", "three"], owner_key="owner")
    job = task_manager.claim_next_worker_job(worker_id="worker-a")
    assert job.task_id == tid
    job.claimed_at = datetime.now(timezone.utc) - timedelta(seconds=task_manager.STALE_CLAIM_SECONDS + 1)
    assert task_manager.requeue_stale_claims() == 1
    assert job.status == "pending" and not job.claimed
    task_manager._tasks.clear()


def test_watchlist_processing_is_not_requeued_as_a_stale_worker_claim():
    from datetime import datetime, timedelta, timezone

    task_manager._tasks.clear()
    task_manager._last_worker_heartbeat = None  # worker offline (still, stage!=scraping)
    task_manager._worker_heartbeats.clear()
    tid = task_manager.create_watchlist_compare_job(["one", "two"])
    job = task_manager.claim_next_worker_job()
    assert job is not None
    job.stage = "processing"
    job.claimed_at = datetime.now(timezone.utc) - timedelta(
        seconds=task_manager.STALE_CLAIM_SECONDS + 1
    )

    assert task_manager.requeue_stale_claims() == 0
    assert task_manager.get_task_state(tid).stage == "processing"
    task_manager._tasks.clear()


def test_expired_watchlist_job_fails_instead_of_polling_forever():
    from datetime import datetime, timedelta, timezone

    task_manager._tasks.clear()
    tid = task_manager.create_watchlist_compare_job(["one", "two"])
    task = task_manager.get_task_state(tid)
    task.created_at = datetime.now(timezone.utc) - timedelta(
        seconds=task_manager.ACTIVE_JOB_TIMEOUT_SECONDS + 1
    )

    assert task_manager.fail_expired_worker_jobs() == 1
    assert task.status == "failed"
    assert task.error_code == "worker_timeout"
    task_manager._tasks.clear()


def test_worker_claim_is_oldest_across_scrape_and_watchlist():
    from datetime import datetime, timedelta, timezone

    task_manager._tasks.clear()
    scrape_id = task_manager.create_scrape_job("profile")
    watchlist_id = task_manager.create_watchlist_compare_job(["one", "two"])
    task_manager._tasks[watchlist_id].created_at = datetime.now(timezone.utc) - timedelta(minutes=1)
    assert task_manager.claim_next_worker_job().task_id == watchlist_id
    assert task_manager.claim_next_worker_job().task_id == scrape_id
    task_manager._tasks.clear()


def test_supervisor_verifies_branch_and_venv_interpreter():
    from pathlib import Path

    script = (Path(__file__).parents[1] / "start-worker-supervisor.ps1").read_text(encoding="utf-8")
    assert '.venv\\Scripts\\python.exe' in script
    # Pull target is `main` since desktop_server was deleted upstream (PR-D).
    assert '$PullBranch = "main"' in script
    assert "fetch origin $PullBranch" in script
    assert "checkout $PullBranch" in script
    assert "pull --ff-only origin $PullBranch" in script
    assert "branch --show-current" in script and "rev-parse HEAD" in script


@pytest.fixture
async def client(tmp_path):
    """ASGI client with desktop-worker mode ENABLED (worker_token set)."""
    task_manager._tasks.clear()
    task_manager._last_worker_heartbeat = None
    task_manager._last_worker_started_at = None
    task_manager._last_worker_shutdown_at = None
    task_manager._last_worker_meta = {}
    task_manager._last_worker_self_test = None
    task_manager._worker_desired_state = "run"
    task_manager._worker_restart_token = 0
    task_manager._worker_restart_requested_at = None
    dashboard_settings.reset_cache_for_tests()
    task_manager._last_supervisor_poll_at = None
    task_manager._last_supervisor_report_at = None
    task_manager._last_supervisor_status = {}
    task_manager._supervisor_log_tail = []
    original_token = settings.worker_token
    settings.worker_token = WORKER_TOKEN
    from app.services import run_log  # noqa: PLC0415
    from app import admin  # noqa: PLC0415

    original_runs_dir = run_log.RUNS_DIR
    original_admin_runs_dir = admin.RUNS_DIR
    run_log.RUNS_DIR = tmp_path / "runs"
    admin.RUNS_DIR = run_log.RUNS_DIR
    with patch.dict("os.environ", {"TMDB_API_KEY": "test-key", "ADMIN_SECRET": ADMIN_KEY}):
        from app.main import create_app  # noqa: PLC0415

        app = create_app()
        app.state.aiohttp_session = object()
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            yield ac

    settings.worker_token = original_token
    run_log.RUNS_DIR = original_runs_dir
    admin.RUNS_DIR = original_admin_runs_dir
    task_manager._tasks.clear()
    task_manager._last_worker_heartbeat = None
    task_manager._last_worker_started_at = None
    task_manager._last_worker_shutdown_at = None
    task_manager._last_worker_meta = {}
    task_manager._last_worker_self_test = None
    task_manager._worker_desired_state = "run"
    task_manager._worker_restart_token = 0
    task_manager._worker_restart_requested_at = None
    dashboard_settings.reset_cache_for_tests()
    task_manager._last_supervisor_poll_at = None
    task_manager._last_supervisor_report_at = None
    task_manager._last_supervisor_status = {}
    task_manager._supervisor_log_tail = []


async def _beat(client: AsyncClient):
    r = await client.post(
        "/api/worker/heartbeat",
        headers=AUTH,
        json={"worker_protocol_version": settings.worker_protocol_version, "worker_git_sha": "test-worker"},
    )
    assert r.status_code == 200


@pytest.mark.asyncio
async def test_heartbeat_upserts_ops_workers_not_event_log(client: AsyncClient, monkeypatch):
    """A heartbeat must upsert ops_workers and NOT write ops_worker_events."""
    from app.routes import worker as worker_routes

    upserts = []
    logged = []
    async def fake_upsert(table, row, *, on_conflict):
        upserts.append((table, row, on_conflict))
    async def fake_log(event_type, meta=None):
        logged.append(event_type)
    monkeypatch.setattr(worker_routes.supabase_ops, "upsert", fake_upsert)
    monkeypatch.setattr(worker_routes, "log_worker_event", fake_log)

    r = await client.post(
        "/api/worker/heartbeat",
        headers=AUTH,
        json={"worker_id": "desktop-test", "version": "1.0.0", "active_jobs": 1, "max_concurrency": 1},
    )
    assert r.status_code == 200
    assert len(upserts) == 1
    table, row, on_conflict = upserts[0]
    assert table == "ops_workers"
    assert on_conflict == "worker_id"
    assert row["worker_id"] == "desktop-test"
    assert row["version"] == "1.0.0"
    assert row["active_jobs"] == 1
    assert row["max_concurrency"] == 1
    assert row["status"] == "online"
    assert "last_seen_at" in row
    assert logged == []  # heartbeat must not create an event-log row


@pytest.mark.asyncio
async def test_startup_and_shutdown_log_standard_event_types(client: AsyncClient, monkeypatch):
    """Lifecycle events must use worker_started / worker_stopped, not startup/shutdown."""
    from app.routes import worker as worker_routes

    logged = []
    async def fake_log(event_type, meta=None):
        logged.append((event_type, meta or {}))
    monkeypatch.setattr(worker_routes, "log_worker_event", fake_log)

    r1 = await client.post("/api/worker/startup", headers=AUTH, json={"worker_id": "desktop-test"})
    r2 = await client.post("/api/worker/shutdown", headers=AUTH, json={"worker_id": "desktop-test"})
    assert r1.status_code == 200 and r2.status_code == 200
    assert [et for et, _ in logged] == ["worker_started", "worker_stopped"]


@pytest.mark.asyncio
async def test_job_claim_logs_job_claimed_event(client: AsyncClient, monkeypatch):
    """Claiming a scrape job must log job_claimed with the task id."""
    from app.routes import worker as worker_routes

    logged = []
    async def fake_log(event_type, meta=None):
        logged.append((event_type, meta or {}))
    monkeypatch.setattr(worker_routes, "log_worker_event", fake_log)

    task_id = task_manager.create_scrape_job("someuser")
    claim = await client.get("/api/worker/next", headers=AUTH)
    assert claim.status_code == 200
    assert claim.json()["job"]["task_id"] == task_id
    assert any(et == "job_claimed" for et, _ in logged)
    meta = next(m for et, m in logged if et == "job_claimed")
    assert meta["task_id"] == task_id
    assert meta["username"] == "someuser"


@pytest.mark.asyncio
async def test_health_workers_reports_offline_and_queue_stats(client: AsyncClient, monkeypatch):
    """GET /api/health/workers must return per-worker status + queue stats."""
    from app.routes import worker as worker_routes

    async def fake_select(table, params):
        assert table == "ops_workers"
        now = datetime.now(timezone.utc)
        return [
            {"worker_id": "w1", "last_seen_at": (now - timedelta(minutes=2)).isoformat(), "status": "online"},  # recent
            {"worker_id": "w2", "last_seen_at": (now - timedelta(hours=2)).isoformat(), "status": "offline"},  # stale
        ]
    monkeypatch.setattr(worker_routes.supabase_ops, "select", fake_select)
    # Pretend Supabase is configured so the select path runs (property is
    # read-only on the pydantic model, so patch the class property).
    from unittest.mock import PropertyMock
    monkeypatch.setattr(type(worker_routes.settings), "supabase_enabled", PropertyMock(return_value=True))

    task_manager._tasks.clear()
    task_id = task_manager.create_scrape_job("user1")
    task_manager._tasks[task_id].created_at = datetime.now(timezone.utc) - timedelta(minutes=30)
    task_manager.create_watchlist_compare_job(["u1", "u2"])
    task_manager.create_scrape_job("user2")

    r = await client.get("/api/health/workers")
    assert r.status_code == 200
    body = r.json()
    assert body["queue_depth"] == 3
    assert body["oldest_queued_age_seconds"] >= 29 * 60
    by_id = {w["worker_id"]: w for w in body["workers"]}
    assert by_id["w1"]["status"] == "online"
    assert by_id["w2"]["status"] == "offline"
    task_manager._tasks.clear()


@pytest.mark.asyncio
async def test_test_alert_requires_secret_and_sends(client: AsyncClient, monkeypatch):
    """POST /api/health/test-alert must 401 without the secret and send when authorized."""
    from app.routes import worker as worker_routes

    monkeypatch.setattr(worker_routes.settings, "health_alert_secret", "test-alert-secret")
    sent = []
    async def fake_send_alert(message):
        sent.append(message)
        return True
    monkeypatch.setattr(worker_routes, "send_alert", fake_send_alert)

    # No secret header → 401.
    r = await client.post("/api/health/test-alert")
    assert r.status_code == 401
    assert sent == []

    # Wrong secret → 401.
    r = await client.post("/api/health/test-alert", headers={"X-Health-Alert-Secret": "wrong"})
    assert r.status_code == 401

    # Correct secret → sends.
    r = await client.post("/api/health/test-alert", headers={"X-Health-Alert-Secret": "test-alert-secret"})
    assert r.status_code == 200
    assert r.json()["delivered"] is True
    assert len(sent) == 1
    assert "Test alert" in sent[0]


@pytest.mark.asyncio
async def test_test_alert_disabled_without_secret_config(client: AsyncClient):
    """With no health_alert_secret configured the endpoint must 404 (disabled)."""
    from app.routes import worker as worker_routes

    # Ensure unset for this test.
    original = worker_routes.settings.health_alert_secret
    worker_routes.settings.health_alert_secret = ""
    try:
        r = await client.post("/api/health/test-alert", headers={"X-Health-Alert-Secret": "anything"})
        assert r.status_code == 404
    finally:
        worker_routes.settings.health_alert_secret = original


async def _complete_raw_watchlist_request(client: AsyncClient, request_coro, raw: dict):
    import asyncio

    request_task = asyncio.create_task(request_coro)
    for _ in range(20):
        await asyncio.sleep(0)
        queued = [task for task in task_manager._tasks.values() if task.kind == "watchlist"]
        if queued:
            break
    assert len(queued) == 1
    job = queued[0]
    claim = await client.get("/api/worker/next", headers=AUTH, params={"worker_id": "desktop-test"})
    assert claim.json()["job"]["task_id"] == job.task_id
    complete = await client.post(
        f"/api/worker/watchlist/{job.task_id}/complete",
        headers=AUTH,
        json=_with_lease(job.task_id, raw),
    )
    assert complete.status_code == 200
    return await request_task, job


@pytest.mark.asyncio
async def test_recommend_from_compare_consumes_raw_only_worker_result(client: AsyncClient, monkeypatch):
    from unittest.mock import AsyncMock
    from app.routes import watchlist

    await _beat(client)
    monkeypatch.setattr(watchlist, "enrich_films", AsyncMock(side_effect=lambda session, films, **kwargs: films))
    monkeypatch.setattr(watchlist, "_persist_watchlist_run", lambda *args, **kwargs: None)
    raw = {
        "first_watchlist": [{"title": "Film", "year": "2024", "slug": "/film/film/", "vote_average": 8}],
        "second_watchlist": [{"title": "Film", "year": "2024", "slug": "/film/film/", "vote_average": 8}],
    }
    response, job = await _complete_raw_watchlist_request(
        client,
        client.post(
            "/api/recommend-from-compare",
            json={"usernames": ["one", "two"], "strategy": "highest_rated"},
        ),
        raw,
    )

    assert response.status_code == 200
    assert response.json()["recommendation"]["title"] == "Film"
    assert job.options == {"raw_only": True}
    assert job.owner_key == "127.0.0.1"


@pytest.mark.asyncio
async def test_watchlist_enrich_consumes_raw_only_worker_result(client: AsyncClient, monkeypatch):
    from unittest.mock import AsyncMock
    from app.routes import watchlist

    await _beat(client)
    monkeypatch.setattr(
        watchlist,
        "enrich_films_concurrent",
        AsyncMock(side_effect=lambda session, films, **kwargs: films),
    )
    raw = {
        "first_watchlist": [{"title": "Film", "year": "2024", "slug": "/film/film/"}],
        "second_watchlist": [{"title": "Film", "year": "2024", "slug": "/film/film/"}],
    }
    response, job = await _complete_raw_watchlist_request(
        client,
        client.post("/api/watchlist-enrich", json={"usernames": ["one", "two"]}),
        raw,
    )

    assert response.status_code == 200
    assert response.json()["films"][0]["title"] == "Film"
    assert job.options == {"raw_only": True}
    assert job.owner_key == "127.0.0.1"


@pytest.mark.asyncio
@pytest.mark.parametrize("path,payload", [
    ("/api/recommend-from-compare", {"usernames": ["one", "two"]}),
    ("/api/watchlist-enrich", {"usernames": ["one", "two"]}),
])
async def test_raw_watchlist_endpoints_map_queue_capacity_to_503(client: AsyncClient, monkeypatch, path, payload):
    await _beat(client)
    monkeypatch.setattr(
        task_manager,
        "create_watchlist_compare_job",
        lambda *args, **kwargs: (_ for _ in ()).throw(RuntimeError("queue_full")),
    )
    response = await client.post(path, json=payload)
    assert response.status_code == 503
    assert response.json()["detail"]["error_code"] == "queue_full"


@pytest.mark.asyncio
async def test_raw_watchlist_timeout_releases_capacity_and_late_complete_is_duplicate(client: AsyncClient, monkeypatch):
    from app.routes import watchlist

    await _beat(client)
    monkeypatch.setattr(watchlist, "RAW_HELPER_TIMEOUT_SECONDS", 0)
    monkeypatch.setattr(task_manager, "MAX_ACTIVE_PER_OWNER", 1)

    response = await client.post(
        "/api/watchlist-enrich", json={"usernames": ["one", "two"]}
    )
    assert response.status_code == 504
    task = next(task for task in task_manager._tasks.values() if task.kind == "watchlist")
    assert task.status == "failed"
    assert task.error_code == "worker_timeout"

    replacement_id = task_manager.create_watchlist_compare_job(
        ["one", "three"], owner_key="127.0.0.1"
    )
    assert replacement_id
    late = await client.post(
        f"/api/worker/watchlist/{task.task_id}/complete",
        headers=AUTH,
        json={"first_watchlist": [], "second_watchlist": []},
    )
    assert late.json() == {"ok": True, "duplicate": True}
    assert task.status == "failed" and task.error_code == "worker_timeout"


@pytest.mark.asyncio
async def test_progress_read_expires_aged_worker_task_before_cleanup(client: AsyncClient):
    from datetime import datetime, timedelta, timezone

    task_id = task_manager.create_watchlist_compare_job(["one", "two"])
    task = task_manager.get_task_state(task_id)
    task.created_at = datetime.now(timezone.utc) - timedelta(
        seconds=task_manager.ACTIVE_JOB_TIMEOUT_SECONDS + 1
    )

    response = await client.get(
        f"/api/progress/{task_id}", headers={"X-Task-Token": task.poll_token}
    )
    assert response.status_code == 200
    assert response.json()["status"] == "failed"
    assert response.json()["error_code"] == "worker_timeout"


@pytest.mark.asyncio
async def test_watchlist_compare_enqueue_complete_and_secure_poll(client: AsyncClient, monkeypatch):
    from app.routes import watchlist

    await _beat(client)
    monkeypatch.setattr(watchlist, "_persist_watchlist_run", lambda *args, **kwargs: None)
    queued = await client.post("/api/watchlist-compare", json={"usernames": ["one", "two"]})
    assert queued.status_code == 202
    body = queued.json()
    assert (await client.get(f"/api/progress/{body['task_id']}")).status_code == 403
    claim = await client.get("/api/worker/next", headers=AUTH, params={"worker_id": "desktop-test"})
    assert claim.json()["job"]["task_id"] == body["task_id"]
    # The worker now runs compare_watchlist_sets + TMDB enrichment itself and
    # reports the finished comparison — the backend just persists it.
    raw = {
        "comparison": {
            "counts": {"first_total": 1, "second_total": 1, "common": 1, "first_only": 0, "second_only": 0},
            "returned_counts": {"common": 1, "first_only": 0, "second_only": 0},
            "truncated": {"common": False, "first_only": False, "second_only": False},
            "match_score": 100.0,
            "common": [{"title": "Film", "year": "2024", "slug": "film"}],
            "first_only": [],
            "second_only": [],
        }
    }
    leased = _with_lease(body["task_id"], raw)
    complete = await client.post(f"/api/worker/watchlist/{body['task_id']}/complete", headers=AUTH, json=leased)
    assert complete.status_code == 200
    await __import__("asyncio").sleep(0)
    poll = await client.get(f"/api/progress/{body['task_id']}", headers={"X-Task-Token": body["poll_token"]})
    assert poll.status_code == 200 and poll.json()["status"] == "done"
    assert poll.json()["result"]["counts"]["common"] == 1
    duplicate = await client.post(f"/api/worker/watchlist/{body['task_id']}/complete", headers=AUTH, json=leased)
    assert duplicate.status_code == 200 and duplicate.json()["duplicate"] is True


@pytest.mark.asyncio
async def test_late_failed_watchlist_postback_does_not_override_processing_or_done(client: AsyncClient):
    await _beat(client)
    task_id = task_manager.create_watchlist_compare_job(["one", "two"])
    task = task_manager.get_task_state(task_id)
    task.status = "running"
    task.stage = "processing"

    late = await client.post(
        f"/api/worker/watchlist/{task_id}/failed",
        headers=AUTH,
        json={"message": "late worker failure"},
    )
    assert late.json() == {"ok": True, "duplicate": True}
    assert task.status == "running" and task.stage == "processing"

    task_manager.set_task_done(task_id, {"status": "success"})
    later = await client.post(
        f"/api/worker/watchlist/{task_id}/failed",
        headers=AUTH,
        json={"message": "even later worker failure"},
    )
    assert later.json() == {"ok": True, "duplicate": True}
    assert task.status == "done"


@pytest.mark.asyncio
async def test_finalizer_does_not_overwrite_terminal_state_changed_during_await(monkeypatch):
    from unittest.mock import AsyncMock
    from app.services import watchlist_jobs
    from app.routes import watchlist

    # Uses find_film (not watchlist_compare) because watchlist_compare's
    # compare + TMDB enrichment now runs on the desktop worker — finalize no
    # longer awaits enrich_films_concurrent for that job type. find_film still
    # does, so it's the one that exercises this race-during-await protection.
    task_manager._tasks.clear()
    task_id = task_manager.create_find_film_job(["one", "two"])
    task = task_manager.get_task_state(task_id)
    task.status = "running"
    task.stage = "processing"
    task.result = {"watchlists": {"one": [], "two": []}, "watched": {"one": [], "two": []}}

    async def terminal_during_enrichment(session, films, **kwargs):
        task_manager.set_task_failed(
            task_id,
            "cancelled elsewhere",
            {"error_code": "conflicting_terminal_state"},
        )
        return films

    monkeypatch.setattr(watchlist, "_persist_watchlist_run", lambda *args, **kwargs: None)
    monkeypatch.setattr(
        watchlist_jobs,
        "enrich_films_concurrent",
        AsyncMock(side_effect=terminal_during_enrichment),
    )
    await watchlist_jobs.finalize_watchlist_job(task_id, object())

    assert task.status == "failed"
    assert task.error_code == "conflicting_terminal_state"
    assert task.error == "cancelled elsewhere"
    task_manager._tasks.clear()


@pytest.mark.asyncio
async def test_date_night_no_recommendations_keeps_stable_classification(monkeypatch):
    from unittest.mock import AsyncMock
    from app.services import watchlist_jobs
    from app.routes import recommend

    task_manager._tasks.clear()
    task_id = task_manager.create_date_night_job(["one", "two"])
    task = task_manager.get_task_state(task_id)
    task.status = "running"
    task.stage = "processing"
    task.result = {}
    monkeypatch.setattr(recommend, "_persist_date_night_run", lambda *args, **kwargs: None)
    monkeypatch.setattr(watchlist_jobs, "enrich_films", AsyncMock(return_value=[]))
    monkeypatch.setattr(watchlist_jobs, "build_mutual_profile", lambda *args: {"top_genres": [], "top_directors": [], "era_overlap": "modern"})
    monkeypatch.setattr(watchlist_jobs, "discover_date_night_recommendations", AsyncMock(return_value=[]))

    await watchlist_jobs.finalize_watchlist_job(task_id, object())

    assert task.status == "failed"
    assert task.error_code == "no_recommendations"
    task_manager._tasks.clear()


@pytest.mark.asyncio
async def test_watchlist_finalization_timeout_is_bounded_and_classified(monkeypatch):
    import asyncio
    from app.services import watchlist_jobs
    from app.routes import watchlist

    # find_film, not watchlist_compare — see the comment on
    # test_finalizer_does_not_overwrite_terminal_state_changed_during_await.
    task_manager._tasks.clear()
    task_id = task_manager.create_find_film_job(["one", "two"])
    task = task_manager.get_task_state(task_id)
    task.status = "running"
    task.stage = "processing"
    task.result = {"watchlists": {"one": [], "two": []}, "watched": {"one": [], "two": []}}
    cancelled = []

    async def never_finishes(*args, **kwargs):
        try:
            await asyncio.sleep(60)
        except asyncio.CancelledError:
            cancelled.append(True)
            raise

    monkeypatch.setattr(watchlist, "_persist_watchlist_run", lambda *args, **kwargs: None)
    monkeypatch.setattr(watchlist_jobs, "FIND_FILM_ENRICH_TIMEOUT", 0.001)
    monkeypatch.setattr(watchlist_jobs, "enrich_films_concurrent", never_finishes)

    await watchlist_jobs.finalize_watchlist_job(task_id, object())

    assert task.status == "failed"
    assert task.error_code == "find_film_enrichment_timeout"
    assert len(cancelled) == 1
    task_manager._tasks.clear()


@pytest.mark.asyncio
async def test_date_night_enqueue_complete_and_final_poll(client: AsyncClient, monkeypatch):
    from unittest.mock import AsyncMock
    from app.services import watchlist_jobs
    from app.routes import recommend

    await _beat(client)
    monkeypatch.setattr(recommend, "_persist_date_night_run", lambda *args, **kwargs: None)
    monkeypatch.setattr(watchlist_jobs, "enrich_films", AsyncMock(side_effect=lambda session, films, **kw: films))
    monkeypatch.setattr(watchlist_jobs, "build_mutual_profile", lambda a, b: {"top_genres": [], "top_directors": [], "era_overlap": "modern"})
    monkeypatch.setattr(watchlist_jobs, "discover_date_night_recommendations", AsyncMock(return_value=[{"title": "Film", "year": "2024", "reason": "Shared", "poster_path": ""}]))
    queued = await client.post("/api/date-night", json={"usernames": ["one", "two"]})
    assert queued.status_code == 202
    body = queued.json()
    claim = await client.get("/api/worker/next", headers=AUTH, params={"worker_id": "desktop-test"})
    assert claim.json()["job"]["job_type"] == "date_night"
    raw = {"first_diary": [], "first_grid": [], "second_diary": [], "second_grid": [], "first_watchlist": [], "second_watchlist": []}
    assert (
        await client.post(
            f"/api/worker/watchlist/{body['task_id']}/complete",
            headers=AUTH,
            json=_with_lease(body["task_id"], raw),
        )
    ).status_code == 200
    await __import__("asyncio").sleep(0.01)
    poll = await client.get(f"/api/progress/{body['task_id']}", headers={"X-Task-Token": body["poll_token"]})
    assert poll.json()["status"] == "done"
    assert poll.json()["result"]["recommendations"][0]["title"] == "Film"


# ---- /api/scrape-profile in desktop-worker mode ------------------------------

@pytest.mark.asyncio
async def test_scrape_profile_queues_202_when_worker_online(client: AsyncClient):
    await _beat(client)
    r = await client.post("/api/scrape-profile", json={"username": "semihmutsuz"})
    assert r.status_code == 202
    body = r.json()
    assert body["status"] == "pending"
    assert "task_id" in body
    task = task_manager.get_task_state(body["task_id"])
    assert task is not None
    assert task.kind == "scrape"
    assert task.username == "semihmutsuz"


@pytest.mark.asyncio
async def test_scrape_period_is_forwarded_to_desktop_worker_claim(client: AsyncClient):
    await _beat(client)
    queued = await client.post(
        "/api/scrape-profile",
        json={"username": "semihmutsuz", "analysis_period": "month"},
    )
    assert queued.status_code == 202

    claimed = await client.get("/api/worker/scrape/next", headers=AUTH)
    assert claimed.status_code == 200
    assert claimed.json()["job"]["options"] == {"analysis_period": "month"}


@pytest.mark.asyncio
async def test_scrape_profile_offline_when_no_heartbeat(client: AsyncClient):
    r = await client.post("/api/scrape-profile", json={"username": "semihmutsuz"})
    assert r.status_code == 503
    assert r.json()["detail"]["error_code"] == "desktop_worker_offline"


@pytest.mark.asyncio
async def test_scrape_profile_offline_when_heartbeat_stale(client: AsyncClient):
    await _beat(client)
    # Force the heartbeat to look older than the staleness window.
    from datetime import datetime, timedelta, timezone
    task_manager._last_worker_heartbeat = datetime.now(timezone.utc) - timedelta(
        seconds=settings.worker_heartbeat_max_age_seconds + 5
    )
    r = await client.post("/api/scrape-profile", json={"username": "semihmutsuz"})
    assert r.status_code == 503
    assert r.json()["detail"]["error_code"] == "desktop_worker_offline"


@pytest.mark.asyncio
async def test_scrape_profile_paused_blocks_new_job_even_when_worker_online(client: AsyncClient):
    await _beat(client)
    pause = await client.post("/admin/api/worker/control", headers=ADMIN_AUTH, json={"desired_state": "pause"})
    assert pause.status_code == 200
    assert pause.json()["control"]["desired_state"] == "pause"

    r = await client.post("/api/scrape-profile", json={"username": "semihmutsuz"})
    assert r.status_code == 503
    assert r.json()["detail"]["error_code"] == "desktop_worker_paused"
    assert task_manager._tasks == {}


# ---- worker auth -------------------------------------------------------------

@pytest.mark.asyncio
async def test_worker_endpoints_require_token(client: AsyncClient):
    assert (await client.get("/api/worker/scrape/next")).status_code == 401
    assert (await client.get("/api/worker/control")).status_code == 401
    assert (await client.post("/api/worker/supervisor", json={})).status_code == 401
    assert (await client.post("/api/worker/heartbeat")).status_code == 401
    assert (await client.post("/api/worker/startup", json={})).status_code == 401
    assert (await client.post("/api/worker/self-test", json={})).status_code == 401
    assert (await client.post("/api/worker/scrape/abc/event", json={})).status_code == 401
    assert (await client.get("/api/worker/scrape/next", headers={"X-Worker-Token": "wrong"})).status_code == 401


@pytest.mark.asyncio
async def test_admin_worker_control_requires_admin_key(client: AsyncClient):
    assert (await client.post("/admin/api/worker/control", json={"desired_state": "pause"})).status_code == 403
    assert (await client.post("/admin/api/worker/restart")).status_code == 403


@pytest.mark.asyncio
async def test_worker_lifecycle_and_self_test_status(client: AsyncClient):
    startup = await client.post(
        "/api/worker/startup",
        headers=AUTH,
        json={"self_test_on_start": True, "self_test_username": "semihmutsuz"},
    )
    assert startup.status_code == 200

    self_test = await client.post(
        "/api/worker/self-test",
        headers=AUTH,
        json={"username": "semihmutsuz", "ok": True, "total_films": 394, "message": "Startup scrape self-test passed."},
    )
    assert self_test.status_code == 200

    status = task_manager.get_worker_status(settings.worker_heartbeat_max_age_seconds)
    assert status["online"] is True
    assert status["meta"]["self_test_username"] == "semihmutsuz"
    assert status["self_test"]["ok"] is True
    assert status["self_test"]["total_films"] == 394

    shutdown = await client.post("/api/worker/shutdown", headers=AUTH, json={"reason": "test"})
    assert shutdown.status_code == 200
    assert task_manager.get_worker_status(settings.worker_heartbeat_max_age_seconds)["last_shutdown_at"] is not None


@pytest.mark.asyncio
async def test_admin_worker_status_api(client: AsyncClient):
    await client.post("/api/worker/startup", headers=AUTH, json={"self_test_username": "semihmutsuz"})
    r = await client.get("/admin/api/worker", headers=ADMIN_AUTH)
    assert r.status_code == 200
    body = r.json()
    assert body["enabled"] is True
    assert body["status"]["online"] is True
    assert body["status"]["meta"]["self_test_username"] == "semihmutsuz"
    assert "version" in body["status"]
    assert body["status"]["control"]["desired_state"] == "run"
    assert body["status"]["supervisor"]["child_status"] == "unknown"
    assert body["settings_store"]["source"] == "memory"


@pytest.mark.asyncio
async def test_worker_control_defaults_to_run_and_records_supervisor_poll(client: AsyncClient):
    r = await client.get("/api/worker/control", headers=AUTH)
    assert r.status_code == 200
    body = r.json()
    assert body["desired_state"] == "run"
    assert body["restart_token"] == 0
    assert body["should_restart"] is False

    status = task_manager.get_worker_status(settings.worker_heartbeat_max_age_seconds)
    assert status["control"]["desired_state"] == "run"
    assert status["supervisor"]["last_poll_at"] is not None


@pytest.mark.asyncio
async def test_admin_worker_control_persists_to_supabase_settings(client: AsyncClient):
    with patch.object(settings, "supabase_url", "https://mock.supabase.co"), \
         patch.object(settings, "supabase_anon_key", "mock-key"), \
         patch("app.supabase_ops.upsert", return_value=True) as mock_upsert:
        pause = await client.post("/admin/api/worker/control", headers=ADMIN_AUTH, json={"desired_state": "pause"})

    assert pause.status_code == 200
    body = pause.json()
    assert body["control"]["desired_state"] == "pause"
    assert body["settings_store"]["source"] == "supabase"
    assert body["settings_store"]["last_save_ok"] is True
    mock_upsert.assert_awaited_once()
    _, row = mock_upsert.await_args.args
    assert row["key"] == "worker_control"
    assert row["value"]["desired_state"] == "pause"


@pytest.mark.asyncio
async def test_worker_control_loads_persisted_pause_after_memory_reset(client: AsyncClient):
    task_manager._worker_desired_state = "run"
    task_manager._worker_restart_token = 0
    dashboard_settings.reset_cache_for_tests()

    persisted_rows = [{
        "value": {
            "desired_state": "pause",
            "restart_token": 3,
            "restart_requested_at": "2026-07-02T09:00:00+00:00",
        },
        "updated_at": "2026-07-02T09:00:00+00:00",
    }]
    with patch.object(settings, "supabase_url", "https://mock.supabase.co"), \
         patch.object(settings, "supabase_anon_key", "mock-key"), \
         patch("app.supabase_ops.select", return_value=persisted_rows) as mock_select:
        control = await client.get("/api/worker/control?last_seen_restart_token=2", headers=AUTH)
        status = await client.get("/admin/api/worker", headers=ADMIN_AUTH)

    assert control.status_code == 200
    assert control.json()["desired_state"] == "pause"
    assert control.json()["restart_token"] == 3
    assert control.json()["should_restart"] is True
    assert status.json()["status"]["control"]["desired_state"] == "pause"
    assert status.json()["settings_store"]["persistent"] is True
    mock_select.assert_awaited_once()


@pytest.mark.asyncio
async def test_worker_restart_token_comparison(client: AsyncClient):
    initial = await client.get("/api/worker/control", headers=AUTH)
    assert initial.json()["restart_token"] == 0

    restart = await client.post("/admin/api/worker/restart", headers=ADMIN_AUTH)
    assert restart.status_code == 200
    new_token = restart.json()["control"]["restart_token"]
    assert new_token == 1

    pending = await client.get("/api/worker/control?last_seen_restart_token=0", headers=AUTH)
    assert pending.status_code == 200
    assert pending.json()["should_restart"] is True

    seen = await client.get(f"/api/worker/control?last_seen_restart_token={new_token}", headers=AUTH)
    assert seen.status_code == 200
    assert seen.json()["should_restart"] is False

    # Backend restart resets the in-memory token to 0 while the supervisor still holds
    # last_seen=1. A stale token must NOT trigger a restart (regression: bug_006).
    task_manager._worker_restart_token = 0
    stale = await client.get("/api/worker/control?last_seen_restart_token=1", headers=AUTH)
    assert stale.status_code == 200
    assert stale.json()["should_restart"] is False


@pytest.mark.asyncio
async def test_supervisor_report_does_not_pollute_worker_heartbeat(client: AsyncClient):
    lines = [f"line {i}" for i in range(100)]
    report = await client.post(
        "/api/worker/supervisor",
        headers=AUTH,
        json={
            "child_status": "running",
            "child_pid": 4242,
            "child_started_at": "2026-06-28T10:00:00Z",
            "last_restart_token_seen": 0,
            "log_tail": lines,
        },
    )
    assert report.status_code == 200

    status = task_manager.get_worker_status(settings.worker_heartbeat_max_age_seconds)
    assert status["online"] is False
    assert status["last_heartbeat"] is None
    assert status["supervisor"]["child_status"] == "running"
    assert status["supervisor"]["child_pid"] == 4242
    assert status["supervisor"]["log_tail"][0] == "line 20"
    assert len(status["supervisor"]["log_tail"]) == task_manager.SUPERVISOR_LOG_TAIL_MAX_LINES


@pytest.mark.asyncio
async def test_admin_dashboard_renders_worker_panel(client: AsyncClient):
    await client.post("/api/worker/startup", headers=AUTH, json={"self_test_username": "semihmutsuz"})
    r = await client.get("/admin/worker", headers=ADMIN_AUTH)
    assert r.status_code == 200
    html = r.text
    assert "Desktop Worker" in html
    assert "Worker live" in html
    assert "Startup Self-Test" in html
    assert "Pause Jobs" in html
    assert "Restart Worker" in html
    assert "Settings Store" in html
    assert "Supervisor Log Tail" in html
    assert "refreshWorkerStatus" in html
    assert "/admin/api/worker" in html


@pytest.mark.asyncio
async def test_admin_login_uses_http_only_session_cookie(client: AsyncClient):
    login = await client.post(
        "/admin/session", data={"key": "test-admin-secret-rotated"}, follow_redirects=False
    )
    assert login.status_code == 303
    cookie = login.headers["set-cookie"].lower()
    assert "httponly" in cookie
    assert "samesite=strict" in cookie
    dashboard = await client.get("/admin/dashboard")
    assert dashboard.status_code == 200


# ---- claiming jobs -----------------------------------------------------------

@pytest.mark.asyncio
async def test_worker_claims_one_job(client: AsyncClient):
    await _beat(client)
    submit = await client.post("/api/scrape-profile", json={"username": "semihmutsuz"})
    task_id = submit.json()["task_id"]

    r = await client.get("/api/worker/scrape/next", headers=AUTH)
    assert r.status_code == 200
    job = r.json()["job"]
    assert job["task_id"] == task_id
    assert job["username"] == "semihmutsuz"

    # A second poll with no other queued jobs returns nothing — the worker does
    # not re-claim a job it already took.
    r2 = await client.get("/api/worker/scrape/next", headers=AUTH)
    assert r2.json()["job"] is None


@pytest.mark.asyncio
async def test_paused_worker_claims_no_new_jobs(client: AsyncClient):
    await _beat(client)
    task_id = task_manager.create_scrape_job("semihmutsuz")
    task_manager.create_watchlist_compare_job(["semihmutsuz", "mertefesenturk"])
    await client.post("/admin/api/worker/control", headers=ADMIN_AUTH, json={"desired_state": "pause"})

    scrape = await client.get("/api/worker/scrape/next", headers=AUTH)
    assert scrape.status_code == 200
    assert scrape.json()["job"] is None
    assert scrape.json()["paused"] is True
    assert task_manager.get_task_state(task_id).status == "pending"

    watchlist = await client.get("/api/worker/watchlist/next", headers=AUTH)
    assert watchlist.status_code == 200
    assert watchlist.json()["job"] is None
    assert watchlist.json()["paused"] is True


@pytest.mark.asyncio
async def test_worker_version_mismatch_blocks_claim(client: AsyncClient):
    await client.post("/api/worker/heartbeat", headers=AUTH, json={"worker_protocol_version": 0, "worker_git_sha": "old"})
    submit = await client.post("/api/scrape-profile", json={"username": "semihmutsuz"})
    assert submit.status_code == 202

    r = await client.get("/api/worker/scrape/next", headers=AUTH)
    assert r.status_code == 409
    assert r.json()["detail"]["error_code"] == "worker_version_mismatch"


# ---- worker outbox -------------------------------------------------------------

@pytest.mark.asyncio
async def test_corrupt_outbox_item_is_quarantined_not_retried(tmp_path, monkeypatch):
    """A corrupt/0-byte outbox file (2026-07-02 incident) must be moved to
    quarantine on the first flush — not left in place to re-log the same
    'unreadable' error on every retry cycle forever."""
    from app.worker import desktop_scrape_worker as worker

    monkeypatch.setattr(worker, "OUTBOX_DIR", tmp_path)
    corrupt = tmp_path / "task1-failed.json"
    corrupt.write_bytes(b"")

    post = AsyncMock()
    monkeypatch.setattr(worker, "_post", post)

    await worker._flush_outbox(None, None)

    # Preserved for inspection under quarantine/, gone from the outbox itself.
    quarantined = tmp_path / "quarantine" / "task1-failed.json"
    assert not corrupt.exists()
    assert quarantined.exists()
    assert quarantined.read_bytes() == b""

    # A second flush no longer sees it: nothing is read or posted.
    await worker._flush_outbox(None, None)
    post.assert_not_awaited()


@pytest.mark.asyncio
async def test_valid_outbox_item_still_sent_and_removed(tmp_path, monkeypatch):
    """Quarantine must not touch the happy path: a readable item is posted
    and deleted, never quarantined."""
    import json

    from app.worker import desktop_scrape_worker as worker

    monkeypatch.setattr(worker, "OUTBOX_DIR", tmp_path)
    item = tmp_path / "task2-complete.json"
    item.write_text(json.dumps({"path": "/api/worker/scrape/task2/complete", "payload": {"stats": {}}}), encoding="utf-8")

    post = AsyncMock(return_value=True)
    monkeypatch.setattr(worker, "_post", post)

    await worker._flush_outbox(None, None)

    post.assert_awaited_once()
    assert not item.exists()
    assert not (tmp_path / "quarantine").exists()


# ---- completion / failure ----------------------------------------------------

@pytest.mark.asyncio
async def test_wrong_lease_token_rejected_on_complete(client: AsyncClient):
    await _beat(client)
    submitted = (await client.post("/api/scrape-profile", json={"username": "semihmutsuz"})).json()
    task_id = submitted["task_id"]
    claim = await client.get("/api/worker/scrape/next", headers=AUTH, params={"worker_id": "desktop-test"})
    assert claim.json()["job"]["lease_token"]

    bad = await client.post(
        f"/api/worker/scrape/{task_id}/complete",
        headers=AUTH,
        json={"stats": {"total_films": 1}, "lease_token": "not-the-real-lease"},
    )
    assert bad.status_code == 409
    assert bad.json()["detail"]["error_code"] == "lease_mismatch"
    assert task_manager.get_task_state(task_id).status == "running"


@pytest.mark.asyncio
async def test_worker_completion_makes_progress_done(client: AsyncClient):
    await _beat(client)
    submitted = (await client.post("/api/scrape-profile", json={"username": "semihmutsuz"})).json()
    task_id, poll_token = submitted["task_id"], submitted["poll_token"]
    claim = await client.get("/api/worker/scrape/next", headers=AUTH, params={"worker_id": "desktop-test"})
    assert claim.json()["job"]["lease_token"]

    stats = {"total_films": 394, "scraped_username": "semihmutsuz"}
    event = await client.post(
        f"/api/worker/scrape/{task_id}/event",
        headers=AUTH,
        json=_with_lease(task_id, {"stage": "scrape_started", "message": "Scrape started", "elapsed_seconds": 1.0}),
    )
    assert event.status_code == 200
    done = await client.post(
        f"/api/worker/scrape/{task_id}/complete",
        headers=AUTH,
        json=_with_lease(
            task_id,
            {
                "stats": stats,
                "telemetry": {"duration_seconds": 12.3, "scrape_seconds": 8.1, "analysis_seconds": 3.2},
                "trace_events": [{"stage": "analysis_done", "message": "Analysis completed", "elapsed_seconds": 12.0}],
            },
        ),
    )
    assert done.status_code == 200

    prog = await client.get(f"/api/progress/{task_id}", headers={"X-Task-Token": poll_token})
    body = prog.json()
    assert body["status"] == "done"
    assert body["result"]["status"] == "success"
    assert body["result"]["stats"]["total_films"] == 394
    assert body["trace_events"][0]["stage"] == "queued"
    assert task_manager.get_task_state(task_id).duration_seconds == 12.3
    assert task_manager.get_task_state(task_id).scrape_seconds == 8.1

    runs = await client.get("/admin/api/runs", headers=ADMIN_AUTH)
    assert runs.status_code == 200
    run = runs.json()["runs"][0]
    assert run["task_id"] == task_id
    assert run["source"] == "desktop-worker"
    assert run["duration_seconds"] == 12.3
    assert run["scrape_seconds"] == 8.1
    assert run["bottleneck_stage"] == "scrape"
    assert run["bottleneck_seconds"] == 8.1
    assert run["duration_seconds_per_film"] == 0.031
    assert [event["stage"] for event in run["trace_events"]][-1] == "persisted"


@pytest.mark.asyncio
async def test_worker_failure_makes_progress_failed(client: AsyncClient):
    await _beat(client)
    submitted = (await client.post("/api/scrape-profile", json={"username": "semihmutsuz"})).json()
    task_id, poll_token = submitted["task_id"], submitted["poll_token"]
    await client.get("/api/worker/scrape/next", headers=AUTH, params={"worker_id": "desktop-test"})

    fail = await client.post(
        f"/api/worker/scrape/{task_id}/failed",
        headers=AUTH,
        json=_with_lease(
            task_id,
            {
                "error_code": "scrape_failed",
                "message": "Letterboxd blocked the desktop worker.",
                "telemetry": {
                    "duration_seconds": 7.8,
                    "error_type": "ValueError",
                    "error_stage": "letterboxd_or_scrape",
                },
            },
        ),
    )
    assert fail.status_code == 200

    prog = await client.get(f"/api/progress/{task_id}", headers={"X-Task-Token": poll_token})
    body = prog.json()
    assert body["status"] == "failed"
    assert body["error"] == "Letterboxd blocked the desktop worker."
    task = task_manager.get_task_state(task_id)
    assert task.duration_seconds == 7.8
    assert task.error_type == "ValueError"
    assert task.error_stage == "letterboxd_or_scrape"

    runs = await client.get("/admin/api/runs", headers=ADMIN_AUTH)
    assert runs.status_code == 200
    run = runs.json()["runs"][0]
    assert run["ok"] is False
    assert run["error_stage"] == "letterboxd_or_scrape"
    assert run["error_message"] == "Letterboxd blocked the desktop worker."

    dashboard = await client.get("/admin/analysis", headers=ADMIN_AUTH)
    assert dashboard.status_code == 200
    assert "letterboxd_or_scrape" in dashboard.text


@pytest.mark.asyncio
async def test_worker_complete_unknown_task_404(client: AsyncClient):
    await _beat(client)
    r = await client.post("/api/worker/scrape/does-not-exist/complete", headers=AUTH, json={"stats": {}})
    assert r.status_code == 200
    assert r.json()["orphan"] is True

    runs = await client.get("/admin/api/runs", headers=ADMIN_AUTH)
    assert runs.status_code == 200
    assert runs.json()["runs"][0]["task_id"] == "does-not-exist"


@pytest.mark.asyncio
async def test_worker_fail_unknown_task_persists_orphan_run(client: AsyncClient):
    await _beat(client)
    r = await client.post(
        "/api/worker/scrape/missing-task/failed",
        headers=AUTH,
        json={
            "username": "semihmutsuz",
            "message": "Lost during redeploy",
            "telemetry": {"duration_seconds": 3.4, "error_stage": "postback"},
        },
    )
    assert r.status_code == 200
    assert r.json()["orphan"] is True

    runs = await client.get("/admin/api/runs", headers=ADMIN_AUTH)
    run = runs.json()["runs"][0]
    assert run["ok"] is False
    assert run["username"] == "semihmutsuz"
    assert run["error_stage"] == "postback"


# ---- find film job -------------------------------------------------------------

@pytest.mark.asyncio
async def test_find_film_enqueue_complete_and_secure_poll(client: AsyncClient, monkeypatch):
    from unittest.mock import AsyncMock
    from app.services import watchlist_jobs
    from app.routes import watchlist

    await _beat(client)
    monkeypatch.setattr(watchlist, "_persist_watchlist_run", lambda *args, **kwargs: None)
    monkeypatch.setattr(watchlist_jobs, "_persist_watchlist_run", lambda *args, **kwargs: None, raising=False)

    popularity = {"dune": 5.0, "oppenheimer": 50.0, "barbie": 99.0}

    async def fake_enrich(session, films, **kwargs):
        return [{**film, "popularity": popularity[film["slug"]], "poster_path": f"/{film['slug']}.jpg"} for film in films]

    monkeypatch.setattr(watchlist_jobs, "enrich_films_concurrent", AsyncMock(side_effect=fake_enrich))

    queued = await client.post("/api/find-film", json={"usernames": ["alice", "bob", "carol"]})
    assert queued.status_code == 202
    body = queued.json()
    assert (await client.get(f"/api/progress/{body['task_id']}")).status_code == 403

    claim = await client.get("/api/worker/next", headers=AUTH, params={"worker_id": "desktop-test"})
    job = claim.json()["job"]
    assert job["task_id"] == body["task_id"]
    assert job["job_type"] == "find_film"
    assert job["usernames"] == ["alice", "bob", "carol"]
    assert job["lease_token"]

    shelf = [
        {"title": "Dune", "year": "2021", "slug": "dune"},
        {"title": "Oppenheimer", "year": "2023", "slug": "oppenheimer"},
        {"title": "Barbie", "year": "2023", "slug": "barbie"},
    ]
    raw = {
        "watchlists": {"alice": shelf, "bob": shelf, "carol": shelf},
        # Barbie was watched by exactly one user — it must disappear.
        "watched": {"alice": [], "bob": [{"title": "Barbie", "year": "2023", "slug": "barbie"}], "carol": []},
    }
    complete = await client.post(
        f"/api/worker/watchlist/{body['task_id']}/complete",
        headers=AUTH,
        json=_with_lease(body["task_id"], raw),
    )
    assert complete.status_code == 200
    await __import__("asyncio").sleep(0)

    poll = await client.get(f"/api/progress/{body['task_id']}", headers={"X-Task-Token": body["poll_token"]})
    assert poll.status_code == 200 and poll.json()["status"] == "done"
    result = poll.json()["result"]
    assert result["status"] == "success"
    assert result["users"] == ["alice", "bob", "carol"]
    # popularity-desc, watched film removed
    assert [film["title"] for film in result["films"]] == ["Oppenheimer", "Dune"]
    assert result["counts"]["per_user"] == {"alice": 3, "bob": 3, "carol": 3}
    assert result["counts"]["intersection"] == 3
    assert result["counts"]["watched_removed"] == 1
    assert result["counts"]["returned"] == 2
    assert result["counts"]["truncated"] is False


@pytest.mark.asyncio
async def test_find_film_finalization_failure_surfaces_stable_error_code(client: AsyncClient, monkeypatch):
    from unittest.mock import AsyncMock
    from app.services import watchlist_jobs
    from app.routes import watchlist

    await _beat(client)
    monkeypatch.setattr(watchlist, "_persist_watchlist_run", lambda *args, **kwargs: None)
    monkeypatch.setattr(
        watchlist_jobs,
        "enrich_films_concurrent",
        AsyncMock(side_effect=RuntimeError("tmdb unavailable")),
    )
    queued = await client.post("/api/find-film", json={"usernames": ["alice", "bob"]})
    body = queued.json()
    await client.get("/api/worker/next", headers=AUTH, params={"worker_id": "desktop-test"})
    shelf = [{"title": "Dune", "year": "2021", "slug": "dune"}]
    raw = {"watchlists": {"alice": shelf, "bob": shelf}, "watched": {"alice": [], "bob": []}}
    await client.post(
        f"/api/worker/watchlist/{body['task_id']}/complete",
        headers=AUTH,
        json=_with_lease(body["task_id"], raw),
    )
    await __import__("asyncio").sleep(0)

    poll = await client.get(f"/api/progress/{body['task_id']}", headers={"X-Task-Token": body["poll_token"]})
    assert poll.json()["status"] == "failed"
    assert poll.json()["error_code"] == "find_film_processing_failed"
