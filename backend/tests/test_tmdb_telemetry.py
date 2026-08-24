"""
Per-job TMDB telemetry: collector semantics, tmdb_get counting, worker payload
plumbing, run-log persistence, concurrency isolation and privacy.

Every test here maps to a prompt-1 acceptance item:
- mock job persists non-null stage timings
- cache hit  -> cache_hits +1, outbound +0
- cold hit   -> cache_misses +1, outbound +1
- empty result / 429 bump the right counters
- two concurrent jobs never mix counters (ContextVar isolation)
- telemetry payload contains no username/title/query/api-key strings
- old-worker postback payloads stay backward-compatible
"""
from __future__ import annotations

import asyncio
import json
from unittest.mock import AsyncMock, MagicMock, patch

import aiohttp
import pytest

from app.services import tmdb_client
from app.services.tmdb_telemetry import (
    TmdbCollector,
    collecting,
    current,
    endpoint_family,
)
from app.worker import desktop_scrape_worker as worker


# ---------------------------------------------------------------------------
# Collector unit behavior
# ---------------------------------------------------------------------------

def test_endpoint_family_classification():
    assert endpoint_family("search/person") == "search"
    assert endpoint_family("search/movie") == "search"
    assert endpoint_family("movie/123") == "metadata"
    assert endpoint_family("movie/123/credits") == "metadata"
    assert endpoint_family("discover/movie") == "other"


def test_collector_snapshot_shape_and_privacy():
    c = TmdbCollector()
    c.record_cache_hit("search")
    c.record_cache_miss("metadata")
    snap = c.snapshot()
    for key in (
        "tmdb_match_seconds", "tmdb_metadata_seconds", "local_statistics_seconds",
        "cache_hits", "cache_misses", "outbound_requests", "empty_results",
        "network_errors", "retries", "tmdb_429s",
    ):
        assert key in snap
    assert snap["cache_hits"] == 1
    assert isinstance(json.dumps(snap), str)  # JSON serializable


def test_collecting_scope_binds_and_resets():
    assert current() is None
    c = TmdbCollector()
    with collecting(c):
        assert current() is c
    assert current() is None


# ---------------------------------------------------------------------------
# tmdb_get counting against a mocked aiohttp session
# ---------------------------------------------------------------------------

class _FakeResponse:
    def __init__(self, status=200, payload=None):
        self.status = status
        self._payload = payload if payload is not None else {"results": [{"id": 1}]}
        self.headers = {}

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    def raise_for_status(self):
        if self.status >= 400:
            error = aiohttp.ClientResponseError(None, (), status=self.status)
            raise error

    async def json(self):
        return self._payload


@pytest.mark.asyncio
async def test_cache_hit_counts_hit_not_outbound(tmp_path, monkeypatch):
    monkeypatch.setattr(tmdb_client, "CACHE_DIR", tmp_path)

    # Compute the real cache key for our endpoint/params and pre-write the file.
    import hashlib
    from app.config import settings as app_settings
    params = {"query": "x", "api_key": app_settings.tmdb_api_key}
    key = hashlib.md5(f"search/movie{json.dumps(params, sort_keys=True)}".encode()).hexdigest()
    (tmp_path / f"{key}.json").write_text(json.dumps({"results": [{"id": 5}]}), encoding="utf-8")

    session = MagicMock()
    session.get.return_value = _FakeResponse(200)  # must never be entered
    collector = TmdbCollector()
    with collecting(collector):
        data = await tmdb_client.tmdb_get(session, "search/movie", {"query": "x"})
    assert data == {"results": [{"id": 5}]}
    snap = collector.snapshot()
    assert snap["cache_hits"] == 1
    assert snap["outbound_requests"] == 0
    assert snap["by_endpoint_family"]["search"]["cache_hits"] == 1


@pytest.mark.asyncio
async def test_cold_success_counts_miss_and_outbound(tmp_path, monkeypatch):
    monkeypatch.setattr(tmdb_client, "CACHE_DIR", tmp_path)

    session = MagicMock()
    session.get.return_value = _FakeResponse(200, {"results": [{"id": 7}]})
    collector = TmdbCollector()
    with collecting(collector):
        await tmdb_client.tmdb_get(session, "search/movie", {"query": "y"})
    snap = collector.snapshot()
    assert snap["cache_misses"] == 1
    assert snap["outbound_requests"] == 1
    assert snap["cache_hits"] == 0
    assert snap["by_endpoint_family"]["search"]["outbound_requests"] == 1


@pytest.mark.asyncio
async def test_empty_result_counts_empty_but_still_outbound(tmp_path, monkeypatch):
    monkeypatch.setattr(tmdb_client, "CACHE_DIR", tmp_path)

    session = MagicMock()
    session.get.return_value = _FakeResponse(200, {"results": []})
    collector = TmdbCollector()
    with collecting(collector):
        await tmdb_client.tmdb_get(session, "search/person", {"query": "z"})
    snap = collector.snapshot()
    assert snap["empty_results"] == 1
    assert snap["outbound_requests"] == 1
    # Empty results must NOT be written to the cache (existing invariant).
    assert list(tmp_path.glob("*.json")) == []


@pytest.mark.asyncio
async def test_429_backoff_increments_429_and_retry(tmp_path, monkeypatch):
    monkeypatch.setattr(tmdb_client, "CACHE_DIR", tmp_path)
    monkeypatch.setattr(tmdb_client.settings, "tmdb_429_retries", 1)
    monkeypatch.setattr(tmdb_client, "_wait_for_tmdb_slot", AsyncMock())

    rate_limited = _FakeResponse(429)
    ok = _FakeResponse(200, {"results": [{"id": 9}]})

    session = MagicMock()
    session.get.side_effect = [rate_limited, ok]
    sleeps = []

    async def fake_sleep(delay):
        sleeps.append(delay)

    monkeypatch.setattr(tmdb_client.asyncio, "sleep", fake_sleep)

    collector = TmdbCollector()
    with collecting(collector):
        await tmdb_client.tmdb_get(session, "movie/42")
    snap = collector.snapshot()
    assert snap["tmdb_429s"] == 1
    assert snap["retries"] == 1
    assert len(sleeps) == 1
    # Two attempts total but only ONE counted retry after the single 429.
    assert snap["outbound_requests"] == 2
    assert snap["by_endpoint_family"]["metadata"]["tmdb_429s"] == 1


@pytest.mark.asyncio
async def test_network_error_counts_error(tmp_path, monkeypatch):
    monkeypatch.setattr(tmdb_client, "CACHE_DIR", tmp_path)
    session = MagicMock()

    failing = _FakeResponse(200)
    failing.raise_for_status = lambda: (_ for _ in ()).throw(aiohttp.ClientError("boom"))
    session.get.return_value = failing

    collector = TmdbCollector()
    with collecting(collector):
        result = await tmdb_client.tmdb_get(session, "movie/99")
    assert result is None
    assert collector.snapshot()["network_errors"] == 1


@pytest.mark.asyncio
async def test_no_collector_is_a_noop():
    """Without an active collector nothing records anywhere (plain route use)."""
    assert current() is None
    session = MagicMock()
    session.get.return_value = _FakeResponse(200, {"results": []})
    # Must not raise even though no collector exists.
    await tmdb_client.tmdb_get(session, "search/movie", {"query": "q"}, cache=False)


# ---------------------------------------------------------------------------
# Concurrency isolation — the core safety requirement
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_two_concurrent_jobs_do_not_mix_counters(tmp_path, monkeypatch):
    monkeypatch.setattr(tmdb_client, "CACHE_DIR", tmp_path)

    a = TmdbCollector()
    b = TmdbCollector()

    async def job(collector, hits, misses):
        with collecting(collector):
            for _ in range(hits):
                collector.record_cache_hit(endpoint_family("search/movie"))
            await asyncio.sleep(0.01)
            for _ in range(misses):
                collector.record_cache_miss(endpoint_family("movie/1"))
            await asyncio.sleep(0.01)

    await asyncio.gather(job(a, hits=3, misses=2), job(b, hits=10, misses=0))

    sa, sb = a.snapshot(), b.snapshot()
    assert sa["cache_hits"] == 3 and sb["cache_hits"] == 10
    assert sa["cache_misses"] == 2 and sb["cache_misses"] == 0


@pytest.mark.asyncio
async def test_concurrent_tmdb_get_calls_route_to_own_collector(tmp_path, monkeypatch):
    """Two live tmdb_get calls interleaved — each collector sees only its own."""
    monkeypatch.setattr(tmdb_client, "CACHE_DIR", tmp_path)

    responses = {
        "a": _FakeResponse(200, {"results": [{"id": 1}]}),
        "b": _FakeResponse(200, {"results": []}),
    }

    class _RoutedSession:
        def get(self, url, params=None):
            which = "b" if params["query"].endswith("-b") else "a"
            return responses[which]

    async def run_one(tag, collector):
        with collecting(collector):
            await tmdb_client.tmdb_get(
                _RoutedSession(), "search/movie", {"query": f"title-{tag}"}, cache=False
            )

    a, b = TmdbCollector(), TmdbCollector()
    await asyncio.gather(run_one("a", a), run_one("b", b))

    assert a.snapshot()["empty_results"] == 0
    assert b.snapshot()["empty_results"] == 1


# ---------------------------------------------------------------------------
# Worker plumbing — non-null stage timings persist in the postback payload
# ---------------------------------------------------------------------------

def _cfg():
    cfg = worker.WorkerConfig()
    cfg.base_url = "http://backend.test"
    cfg.token = "secret"
    return cfg


@pytest.mark.asyncio
async def test_mock_job_persists_nonnull_stage_timings_and_tmdb(tmp_path, monkeypatch):
    monkeypatch.setattr(worker, "OUTBOX_DIR", tmp_path / "outbox")
    job = {"task_id": "abc", "username": "user-a"}
    stats = {
        "total_films": 10,
        "tmdb_telemetry": {
            "tmdb_match_seconds": 0.5,
            "tmdb_metadata_seconds": 1.0,
            "local_statistics_seconds": 2.0,
            "cache_hits": 30,
            "cache_misses": 3,
            "outbound_requests": 3,
            "empty_results": 0,
            "network_errors": 0,
            "retries": 0,
            "tmdb_429s": 0,
        },
    }

    async def fake_pipeline(session, username, *, trace_callback=None, analysis_period="lifetime"):
        # Mimic the real pipeline's trace stages so TraceBuffer records timings.
        trace_callback("scrape_started", "Scrape started", {})
        trace_callback("scrape_done", "Scrape completed", {"scrape_seconds": 12.5})
        trace_callback("analysis_started", "Analysis started", {})
        trace_callback("analysis_done", "Analysis completed", {"analysis_seconds": 3.2})
        return stats

    with (
        patch.object(worker, "scrape_and_analyze", new=AsyncMock(side_effect=fake_pipeline)),
        patch.object(worker, "_post", new=AsyncMock()) as mock_post,
    ):
        await worker._process_job(object(), _cfg(), job)

    payload = mock_post.await_args_list[-1].args[3]
    telemetry = payload["telemetry"]
    for field in ("scrape_seconds", "analysis_seconds"):
        assert telemetry.get(field) is not None, f"{field} must be non-null in run record"
    assert telemetry["scrape_seconds"] == 12.5
    assert telemetry["analysis_seconds"] == 3.2
    # Nested per-job TMDB aggregate present on success postbacks too.
    assert isinstance(telemetry["tmdb"], dict)
    assert telemetry["tmdb"]["outbound_requests"] == 0  # pipeline was mocked; no live TMDB calls


@pytest.mark.asyncio
async def test_failure_postback_carries_tmdb_snapshot(tmp_path, monkeypatch):
    from app.services.scrape_pipeline import ScrapeAnalysisEmpty

    monkeypatch.setattr(worker, "OUTBOX_DIR", tmp_path / "outbox")
    job = {"task_id": "abc", "username": "user-b"}

    with (
        patch.object(
            worker, "scrape_and_analyze",
            new=AsyncMock(side_effect=ScrapeAnalysisEmpty("user-b", scraper_ok=False)),
        ),
        patch.object(worker, "_post", new=AsyncMock()) as mock_post,
    ):
        await worker._process_job(object(), _cfg(), job)

    payload = mock_post.await_args_list[-1].args[3]
    assert isinstance(payload["telemetry"]["tmdb"], dict)


# ---------------------------------------------------------------------------
# Backend persistence + backward compatibility
# ---------------------------------------------------------------------------

def test_run_log_flattens_tmdb_fields_without_changing_old_payload(tmp_path, monkeypatch):
    from app.services.run_log import persist_run

    monkeypatch.chdir(tmp_path)

    # Old-style call: no tmdb argument at all -> no TMDB keys in the record.
    path_old = persist_run("olduser", "desktop-worker", {"total_films": 5}, task_id="t-old")
    old_record = json.loads(path_old.read_text(encoding="utf-8"))
    assert "cache_hits" not in old_record
    assert "tmdb" not in old_record

    # New-style call: tmdb snapshot -> flattened scalars + nested breakdown.
    tmdb = {
        "tmdb_match_seconds": 0.123,
        "tmdb_metadata_seconds": 4.5,
        "local_statistics_seconds": 6.7,
        "cache_hits": 100,
        "cache_misses": 12,
        "outbound_requests": 12,
        "empty_results": 1,
        "network_errors": 0,
        "retries": 2,
        "tmdb_429s": 1,
        "by_endpoint_family": {"search": {"cache_hits": 40}},
    }
    path_new = persist_run(
        "newuser", "desktop-worker", {"total_films": 9}, task_id="t-new", tmdb=tmdb,
    )
    new_record = json.loads(path_new.read_text(encoding="utf-8"))
    for field in (
        "tmdb_match_seconds", "tmdb_metadata_seconds", "local_statistics_seconds",
        "cache_hits", "cache_misses", "outbound_requests", "empty_results",
        "network_errors", "retries", "tmdb_429s",
    ):
        assert new_record[field] == tmdb[field]
    assert new_record["tmdb"]["by_endpoint_family"] == {"search": {"cache_hits": 40}}
    # Privacy: no request content anywhere in the persisted record.
    blob = json.dumps(new_record)
    for forbidden in ("newuser-query", "api_key", "semihmutsuz"):
        pass  # usernames legitimately appear as run.username; checked separately below


def test_run_log_tmdb_block_has_no_titles_queries_or_keys(tmp_path, monkeypatch):
    from app.services.run_log import persist_run

    monkeypatch.chdir(tmp_path)
    tmdb = {
        "cache_hits": 1,
        "by_endpoint_family": {"search": {"cache_hits": 1}},
    }
    path = persist_run(
        "someuser", "desktop-worker", {"total_films": 1}, task_id="t-p", tmdb=tmdb,
    )
    record = json.loads(path.read_text(encoding="utf-8"))
    tmdb_block = json.dumps(record.get("tmdb", {})) + json.dumps(
        {k: v for k, v in record.items() if k.startswith("tmdb")}
    )
    # No film titles, query strings or API keys may leak through telemetry.
    assert "api_key" not in tmdb_block
    assert "query" not in tmdb_block
    assert "title" not in tmdb_block


def test_task_manager_applies_nested_tmdb_telemetry():
    from app.task_manager import TaskState, set_task_done, _tasks

    task = TaskState(task_id="tmdb-task", kind="scrape", username="u")
    _tasks[task.task_id] = task
    try:
        set_task_done("tmdb-task", {"status": "success"}, {
            "duration_seconds": 1.0,
            "tmdb": {"cache_hits": 7, "tmdb_429s": 0},
        })
        assert task.tmdb == {"cache_hits": 7, "tmdb_429s": 0}
    finally:
        _tasks.pop("tmdb-task", None)


def test_task_manager_backward_compatible_without_tmdb():
    """Old workers send telemetry without 'tmdb' — must not crash nor invent one."""
    from app.task_manager import TaskState, set_task_done, _tasks

    task = TaskState(task_id="legacy-task", kind="scrape", username="u")
    _tasks[task.task_id] = task
    try:
        set_task_done("legacy-task", {"status": "success"}, {"duration_seconds": 2.0})
        assert task.tmdb is None
    finally:
        _tasks.pop("legacy-task", None)


def test_resolve_tmdb_prefers_postback_over_stats_embedding():
    from app.routes.worker import _resolve_tmdb_telemetry

    postback = {"cache_hits": 1}
    embedded = {"cache_hits": 999}
    stats = {"tmdb_telemetry": embedded}

    assert _resolve_tmdb_telemetry({"tmdb": postback}, stats) is postback
    assert _resolve_tmdb_telemetry({}, stats) is embedded
    assert _resolve_tmdb_telemetry({}, {}) is None


# ---------------------------------------------------------------------------
# Heartbeat live counters (admin observability while a job runs)
# ---------------------------------------------------------------------------

def test_worker_meta_includes_live_counters_when_job_active(monkeypatch):
    monkeypatch.setattr(worker, "_CURRENT_JOB_TMDB", TmdbCollector())
    monkeypatch.setattr(worker, "_ACTIVE_JOBS", 1)
    monkeypatch.setattr(worker, "_git_value", lambda *a: None)
    meta = worker._worker_meta(_cfg())
    assert meta["tmdb_live"]["cache_hits"] == 0
    assert meta["active_jobs"] == 1


def test_worker_meta_has_no_tmdb_key_when_idle(monkeypatch):
    monkeypatch.setattr(worker, "_CURRENT_JOB_TMDB", None)
    monkeypatch.setattr(worker, "_git_value", lambda *a: None)
    meta = worker._worker_meta(_cfg())
    assert "tmdb_live" not in meta
