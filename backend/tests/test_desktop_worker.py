"""
Desktop scrape worker — process loop unit tests.

Exercises _process_job in isolation: the scrape pipeline and the backend POST
are mocked, so we assert the worker reports success vs. failure correctly and
never crashes the loop on a scrape exception.
"""
import pytest
from unittest.mock import AsyncMock, patch

from app.worker import desktop_scrape_worker as worker
from app.services.scrape_pipeline import ScrapeAnalysisEmpty


def _cfg():
    cfg = worker.WorkerConfig()
    cfg.base_url = "http://backend.test"
    cfg.token = "secret"
    return cfg


def test_wakelock_noop_off_windows(monkeypatch):
    """Off Windows the wakelock must be a silent no-op (runs on Fedora/Render)."""
    monkeypatch.setattr(worker.sys, "platform", "linux")
    worker._set_windows_wakelock(True)
    worker._set_windows_wakelock(False)  # no exception == pass


@pytest.mark.asyncio
async def test_process_job_posts_success(tmp_path, monkeypatch):
    monkeypatch.setattr(worker, "OUTBOX_DIR", tmp_path / "outbox")
    job = {"task_id": "abc", "username": "semihmutsuz"}
    stats = {"total_films": 394}

    with (
        patch.object(worker, "scrape_and_analyze", new=AsyncMock(return_value=stats)),
        patch.object(worker, "_post", new=AsyncMock()) as mock_post,
    ):
        await worker._process_job(object(), _cfg(), job)

    assert mock_post.await_count == 2
    args = mock_post.await_args_list[-1].args
    assert args[2] == "/api/worker/scrape/abc/complete"
    assert args[3]["stats"] == stats
    assert "duration_seconds" in args[3]["telemetry"]
    assert args[3]["trace_events"][0]["stage"] == "worker_received"
    assert args[3]["trace_events"][-1]["stage"] == "postback_started"


@pytest.mark.asyncio
async def test_process_job_posts_failure_on_exception(tmp_path, monkeypatch):
    monkeypatch.setattr(worker, "OUTBOX_DIR", tmp_path / "outbox")
    job = {"task_id": "abc", "username": "semihmutsuz"}

    with (
        patch.object(worker, "scrape_and_analyze", new=AsyncMock(side_effect=ScrapeAnalysisEmpty("semihmutsuz", scraper_ok=False))),
        patch.object(worker, "_post", new=AsyncMock()) as mock_post,
    ):
        await worker._process_job(object(), _cfg(), job)

    assert mock_post.await_count == 2
    args = mock_post.await_args_list[-1].args
    assert args[2] == "/api/worker/scrape/abc/failed"
    assert "No public films found" in args[3]["message"]
    assert args[3]["telemetry"]["error_type"] == "ScrapeAnalysisEmpty"
    assert args[3]["telemetry"]["error_stage"] == "scrape_empty"
    assert args[3]["trace_events"][0]["stage"] == "worker_received"
    assert args[3]["trace_events"][-1]["stage"] == "postback_started"


@pytest.mark.asyncio
async def test_process_job_keeps_outbox_when_postback_fails(tmp_path, monkeypatch):
    monkeypatch.setattr(worker, "OUTBOX_DIR", tmp_path / "outbox")
    job = {"task_id": "abc", "username": "semihmutsuz"}
    stats = {"total_films": 394}

    with (
        patch.object(worker, "scrape_and_analyze", new=AsyncMock(return_value=stats)),
        patch.object(worker, "_post", new=AsyncMock(return_value=False)),
    ):
        await worker._process_job(object(), _cfg(), job)

    outbox_files = list((tmp_path / "outbox").glob("*.json"))
    assert len(outbox_files) == 1
    assert "complete" in outbox_files[0].name


@pytest.mark.asyncio
async def test_flush_outbox_deletes_acknowledged_item(tmp_path, monkeypatch):
    monkeypatch.setattr(worker, "OUTBOX_DIR", tmp_path / "outbox")
    cfg = _cfg()
    payload = {"username": "semihmutsuz", "stats": {"total_films": 394}}
    outbox_path = worker._write_outbox("abc", "complete", "/api/worker/scrape/abc/complete", payload)

    with patch.object(worker, "_post", new=AsyncMock(return_value=True)) as mock_post:
        await worker._flush_outbox(object(), cfg)

    mock_post.assert_awaited_once()
    assert not outbox_path.exists()


@pytest.mark.asyncio
@pytest.mark.parametrize("failure", [False, True])
async def test_watchlist_postbacks_use_durable_outbox(tmp_path, monkeypatch, failure):
    monkeypatch.setattr(worker, "OUTBOX_DIR", tmp_path / "outbox")
    job = {"task_id": "wl-1", "job_type": "watchlist_compare", "usernames": ["one", "two"]}
    effect = ValueError("blocked") if failure else [{"title": "Film"}]
    with (
        patch.object(worker, "scrape_watchlist", new=AsyncMock(side_effect=effect) if failure else AsyncMock(return_value=effect)),
        patch.object(worker, "_post", new=AsyncMock(return_value=False)),
    ):
        await worker._process_watchlist_job(object(), _cfg(), job)
    files = list((tmp_path / "outbox").glob("*.json"))
    assert len(files) == 1
    assert ("failed" if failure else "complete") in files[0].name


def test_failure_message_mapping():
    assert "No public films" in worker._failure_message("u", ScrapeAnalysisEmpty("u", scraper_ok=False))
    assert "analysis came back empty" in worker._failure_message("u", ScrapeAnalysisEmpty("u", scraper_ok=True))


def test_watchlist_failure_telemetry_preserves_classified_error_code():
    from app.services.scraper import WatchlistScrapeError

    telemetry = worker._failure_telemetry(
        WatchlistScrapeError("blocked", "watchlist_blocked"), 1.0
    )
    assert telemetry["error_code"] == "watchlist_blocked"
    assert worker._failure_message("u", ValueError("Letterboxd is blocking requests")) == "Letterboxd is blocking requests"


def test_failure_telemetry_mapping():
    telemetry = worker._failure_telemetry(ScrapeAnalysisEmpty("u", scraper_ok=True), 1.2)
    assert telemetry == {
        "duration_seconds": 1.2,
        "error_type": "ScrapeAnalysisEmpty",
        "error_stage": "analysis_empty",
        "error_code": "analysis_failed",
    }


@pytest.mark.asyncio
async def test_find_film_job_posts_watchlists_and_watched_payload(tmp_path, monkeypatch):
    monkeypatch.setattr(worker, "OUTBOX_DIR", tmp_path / "outbox")
    job = {"task_id": "ff-1", "job_type": "find_film", "usernames": ["alice", "bob", "carol"]}
    shelf = [{"title": "Dune", "year": "2021", "slug": "dune"}]
    watched = [{"title": "Heat", "year": "1995", "slug": "heat"}]

    with (
        patch.object(worker, "scrape_watchlist", new=AsyncMock(return_value=list(shelf))) as mock_wl,
        patch.object(worker, "scrape_films_grid", new=AsyncMock(return_value=list(watched))) as mock_grid,
        patch.object(worker, "_post", new=AsyncMock(return_value=True)) as mock_post,
    ):
        await worker._process_watchlist_job(object(), _cfg(), job)

    assert mock_wl.await_count == 3
    assert mock_grid.await_count == 3
    args = mock_post.await_args_list[-1].args
    assert args[2] == "/api/worker/watchlist/ff-1/complete"
    payload = args[3]
    assert set(payload) == {"watchlists", "watched"}
    assert set(payload["watchlists"]) == {"alice", "bob", "carol"}
    assert payload["watchlists"]["alice"] == shelf
    assert payload["watched"]["bob"] == watched


@pytest.mark.asyncio
async def test_find_film_job_skips_watched_scrape_when_intersection_empty(tmp_path, monkeypatch):
    monkeypatch.setattr(worker, "OUTBOX_DIR", tmp_path / "outbox")
    job = {"task_id": "ff-2", "job_type": "find_film", "usernames": ["alice", "bob"]}
    shelves = [
        [{"title": "Dune", "year": "2021", "slug": "dune"}],
        [{"title": "Heat", "year": "1995", "slug": "heat"}],
    ]

    with (
        patch.object(worker, "scrape_watchlist", new=AsyncMock(side_effect=shelves)),
        patch.object(worker, "scrape_films_grid", new=AsyncMock()) as mock_grid,
        patch.object(worker, "_post", new=AsyncMock(return_value=True)) as mock_post,
    ):
        await worker._process_watchlist_job(object(), _cfg(), job)

    mock_grid.assert_not_awaited()
    payload = mock_post.await_args_list[-1].args[3]
    assert payload["watched"] == {"alice": [], "bob": []}


class _FakeHeartbeatResponse:
    def __init__(self, status: int) -> None:
        self.status = status

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False


class _FakeHeartbeatSession:
    """Rejects every heartbeat with the given status; fails fast if the loop
    polls more times than sleeps (the old busy-loop regression)."""

    def __init__(self, status: int, max_calls: int) -> None:
        self.status = status
        self.max_calls = max_calls
        self.calls = 0

    def post(self, *args, **kwargs):
        self.calls += 1
        if self.calls > self.max_calls:
            raise RuntimeError("heartbeat retried without sleeping between attempts")
        return _FakeHeartbeatResponse(self.status)


@pytest.mark.asyncio
async def test_heartbeat_backs_off_on_rejected_status(monkeypatch):
    """A non-200 heartbeat must back off (sleep between retries), not busy-loop."""
    sleeps: list[float] = []

    async def fake_sleep(delay):
        sleeps.append(delay)
        if len(sleeps) >= 3:
            raise KeyboardInterrupt  # deterministic loop exit

    monkeypatch.setattr(worker.asyncio, "sleep", fake_sleep)
    session = _FakeHeartbeatSession(status=503, max_calls=3)

    with pytest.raises(KeyboardInterrupt):
        await worker._heartbeat_loop(session, _cfg())

    # Each rejection doubles the wait before the next sleep: 30 -> 60 -> 120.
    assert sleeps == [60.0, 120.0, 240.0]
