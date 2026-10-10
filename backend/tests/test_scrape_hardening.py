"""Hardening against LESSONS.md: challenge fail-closed, serial grid, cache, handshake."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from bs4 import BeautifulSoup

from app import task_manager
from app.config import settings
from app.services import scrape_cache, scraper
from app.worker import safari_worker


def test_grid_concurrency_is_serial():
    assert scraper.GRID_CONCURRENCY == 1
    assert safari_worker.WORKER_PROTOCOL_VERSION == settings.worker_protocol_version


def test_just_a_moment_200_is_cloudflare_block():
    html = "<html><title>Just a moment...</title><body>Just a moment</body></html>"
    assert scraper._is_cloudflare_block(html) is True


def test_empty_document_is_not_a_success():
    assert scraper._is_empty_document("") is True
    assert scraper._is_empty_document("   ") is True
    soup = BeautifulSoup("<html></html>", "html.parser")
    assert scraper._is_challenge_or_empty_grid("", soup) is True
    assert scraper._is_challenge_or_empty_grid("<html><body></body></html>", soup) is True


def test_real_empty_library_is_not_a_challenge():
    html = """
    <html>
      <div class="profile-header">alice</div>
      <ul class="poster-list"></ul>
    </html>
    """
    soup = BeautifulSoup(html, "html.parser")
    assert scraper._is_challenge_or_empty_grid(html, soup) is False
    assert scraper._parse_grid_items(soup) == []


def test_challenge_grid_page_raises_blocked(monkeypatch):
    html = "<html><title>Just a moment...</title><body>Just a moment</body></html>"
    response = MagicMock(status_code=200, text=html)
    monkeypatch.setattr(scraper, "_fetch", lambda *args, **kwargs: response)
    with pytest.raises(ValueError, match="blocking automated access"):
        scraper._sync_scrape_films_grid("alice", max_pages=1, session=MagicMock())


def test_classify_never_maps_scraper_errors_to_user_not_found():
    assert scraper.classify_letterboxd_error(ValueError("User 'alice' not found")) == "user_not_found"
    assert scraper.classify_letterboxd_error(ValueError(scraper.BLOCKED_MESSAGE)) == "scrape_blocked"
    assert scraper.classify_letterboxd_error(ValueError("Just a moment")) == "scrape_blocked"
    assert scraper.classify_letterboxd_error(ValueError("connection reset")) == "scrape_failed"
    assert scraper.classify_letterboxd_error(ValueError("something not found in html")) == "scrape_failed"


@pytest.mark.asyncio
async def test_run_scrape_generic_valueerror_is_not_user_not_found():
    from app.routes.analyze import _run_scrape

    task_id = task_manager.create_task_state("test-client")
    with patch(
        "app.routes.analyze.scrape_and_analyze",
        new=AsyncMock(side_effect=ValueError("proxy quota exhausted")),
    ):
        await _run_scrape(task_id, object(), "quota_user", "lifetime")
    task = task_manager.get_task_state(task_id)
    assert task is not None
    assert task.error_code == "scrape_failed"
    assert task.result is None


def test_redact_secrets_strips_tokens():
    raw = "WORKER_TOKEN=super-secret TMDB_API_KEY=tmdb-secret Authorization: Bearer abc"
    redacted = safari_worker.redact_secrets(raw)
    assert "super-secret" not in redacted
    assert "tmdb-secret" not in redacted
    assert "<redacted>" in redacted


def test_heartbeat_payload_includes_protocol_and_sha(monkeypatch):
    monkeypatch.setattr(safari_worker, "current_git_sha", lambda: "abc123def")
    payload = safari_worker._heartbeat_payload()
    assert payload["protocol_version"] == safari_worker.WORKER_PROTOCOL_VERSION
    assert payload["git_sha"] == "abc123def"
    assert payload["max_concurrency"] == 1


def test_self_update_pulls_and_restarts(monkeypatch):
    calls: list[list[str]] = []

    def fake_run(cmd, **kwargs):
        calls.append(list(cmd))
        return MagicMock(returncode=0)

    def fake_popen(cmd, **kwargs):
        calls.append(list(cmd))
        return MagicMock()

    monkeypatch.setattr(safari_worker.subprocess, "run", fake_run)
    monkeypatch.setattr(safari_worker.subprocess, "Popen", fake_popen)
    with pytest.raises(SystemExit):
        safari_worker.self_update_and_restart("deadbeef", 5)
    assert any(cmd[:2] == ["git", "pull"] for cmd in calls)
    assert any("systemctl" in cmd[0] and "restart" in cmd for cmd in calls)


def test_install_unit_is_restart_always_with_linger():
    script = Path(__file__).resolve().parents[2] / "scripts" / "install-x370-worker.sh"
    text = script.read_text(encoding="utf-8")
    assert "Restart=always" in text
    assert "Restart=on-failure" not in text
    assert "loginctl enable-linger" in text
    assert "check-x370-worker-health.sh" in text


def test_health_script_never_prints_env_file():
    script = Path(__file__).resolve().parents[2] / "scripts" / "check-x370-worker-health.sh"
    text = script.read_text(encoding="utf-8")
    assert "worker.env" not in text
    assert "TMDB_API_KEY" not in text
    assert "WORKER_TOKEN" not in text
    assert "is-active" in text
    assert "Restart=always" in text or "restart-not-always" in text


@pytest.mark.asyncio
async def test_scrape_cache_lookup_respects_ttl(monkeypatch):
    monkeypatch.setattr(settings, "supabase_url", "https://example.supabase.co")
    monkeypatch.setattr(settings, "supabase_anon_key", "anon")
    monkeypatch.setattr(settings, "supabase_ops_email", "ops@movieswrapped.internal")
    monkeypatch.setattr(settings, "supabase_ops_password", "x")
    rows = [{"stats": {"total_films": 12}}]
    with patch("app.supabase_ops.select", new=AsyncMock(return_value=rows)):
        hit = await scrape_cache.lookup_scrape_cache("Alice", "lifetime")
    assert hit == {"total_films": 12}


@pytest.mark.asyncio
async def test_scrape_cache_miss_is_none(monkeypatch):
    monkeypatch.setattr(settings, "supabase_url", "https://example.supabase.co")
    monkeypatch.setattr(settings, "supabase_anon_key", "anon")
    monkeypatch.setattr(settings, "supabase_ops_email", "ops@movieswrapped.internal")
    monkeypatch.setattr(settings, "supabase_ops_password", "x")
    with patch("app.supabase_ops.select", new=AsyncMock(return_value=[])):
        assert await scrape_cache.lookup_scrape_cache("alice", "lifetime") is None


def test_queue_metrics_count_jobs_ahead():
    task_manager._tasks.clear()
    first = task_manager.create_scrape_job("alice")
    second = task_manager.create_scrape_job("bob")
    older = task_manager.get_task_state(first)
    newer = task_manager.get_task_state(second)
    assert older is not None and newer is not None
    older.created_at = datetime.now(timezone.utc) - timedelta(seconds=30)
    first_metrics = task_manager.scrape_queue_metrics(older)
    second_metrics = task_manager.scrape_queue_metrics(newer)
    assert first_metrics["queue_position"] == 1
    assert second_metrics["queue_position"] == 2
    assert second_metrics["eta_seconds"] == task_manager.SECONDS_PER_SCRAPE_JOB
    task_manager._tasks.clear()


def test_stale_claim_is_requeued():
    task_manager._tasks.clear()
    task_id = task_manager.create_scrape_job("alice")
    job = task_manager.claim_next_scrape_job("x370")
    assert job is not None
    job.claimed_at = datetime.now(timezone.utc) - timedelta(seconds=task_manager.STALE_CLAIM_SECONDS + 5)
    assert task_manager.requeue_stale_scrape_claims() == 1
    restored = task_manager.get_task_state(task_id)
    assert restored is not None
    assert restored.status == "pending"
    assert restored.claimed is False
    task_manager._tasks.clear()
