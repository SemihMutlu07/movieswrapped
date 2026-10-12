"""
Task queue — in-memory analyze tasks plus scrape persistence.

Run from backend/ directory:
    pytest tests/test_task_persistence.py
"""
from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

import pytest

from app import task_manager


@pytest.fixture(autouse=True)
def _clear_tasks():
    task_manager._tasks.clear()
    yield
    task_manager._tasks.clear()


def test_create_task_state_registers_analyze_task():
    task_id = task_manager.create_task_state(owner_key="client-1")
    task = task_manager.get_task_state(task_id)
    assert task is not None
    assert task.status == "pending"
    assert task.owner_key == "client-1"
    assert task.poll_token


def test_update_task_progress_updates_stage():
    task_id = task_manager.create_task_state()
    task_manager.update_task_progress(task_id, "enriching", "Fetching TMDB metadata", 40, 100)
    task = task_manager.get_task_state(task_id)
    assert task.stage == "enriching"
    assert task.progress == 40
    assert len(task.trace_events) == 1


def test_set_task_done_marks_terminal_state():
    task_id = task_manager.create_task_state()
    task_manager.set_task_running(task_id)
    task_manager.set_task_done(task_id, {"status": "success", "stats": {"total_films": 3}})
    task = task_manager.get_task_state(task_id)
    assert task.status == "done"
    assert task.result["stats"]["total_films"] == 3
    assert task.duration_seconds is not None


def test_set_task_failed_marks_terminal_state():
    task_id = task_manager.create_task_state()
    task_manager.set_task_failed(task_id, "No valid Letterboxd CSV files found")
    task = task_manager.get_task_state(task_id)
    assert task.status == "failed"
    assert task.error == "No valid Letterboxd CSV files found"


def test_get_task_not_found_context_includes_boot_age():
    context = task_manager.get_task_not_found_context()
    assert "boot_age_seconds" in context
    assert "likely_server_restart" in context


def test_scrape_job_row_round_trips_poll_token():
    task_id = task_manager.create_scrape_job("alice", owner_key="client-1", options={"analysis_period": "year"})
    task = task_manager.get_task_state(task_id)
    row = task_manager.task_to_row(task)
    assert row["kind"] == "scrape"
    assert row["username"] == "alice"
    assert row["poll_token"] == task.poll_token
    restored = task_manager.hydrate_task_from_row(row)
    assert restored.task_id == task_id
    assert restored.poll_token == task.poll_token
    assert restored.options["analysis_period"] == "year"


@pytest.mark.asyncio
async def test_load_pending_tasks_restores_queue(monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "supabase_url", "https://example.supabase.co")
    monkeypatch.setattr(settings, "supabase_anon_key", "anon")
    monkeypatch.setattr(settings, "supabase_ops_email", "ops@movieswrapped.internal")
    monkeypatch.setattr(settings, "supabase_ops_password", "x")
    row = {
        "task_id": "restored-1",
        "kind": "scrape",
        "status": "pending",
        "stage": "queued",
        "message": "Queued on live scanner",
        "username": "dave",
        "options": {"analysis_period": "lifetime"},
        "poll_token": "token-abc",
        "claimed": False,
        "trace_events": [],
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    with patch("app.supabase_ops.select", new=AsyncMock(return_value=[row])):
        loaded = await task_manager.load_pending_tasks()
    assert loaded == 1
    task = task_manager.get_task_state("restored-1")
    assert task is not None
    assert task.username == "dave"
    assert task.poll_token == "token-abc"
    assert task.status == "pending"


def test_create_scrape_job_write_through_when_ops_enabled(monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "supabase_url", "https://example.supabase.co")
    monkeypatch.setattr(settings, "supabase_anon_key", "anon")
    monkeypatch.setattr(settings, "supabase_ops_email", "ops@movieswrapped.internal")
    monkeypatch.setattr(settings, "supabase_ops_password", "x")
    upsert = AsyncMock(return_value=True)
    with patch("app.supabase_ops.upsert", upsert):
        task_manager.create_scrape_job("karsten")
    assert upsert.await_count == 1 or upsert.call_count == 1
    row = upsert.call_args.args[1] if upsert.call_args.args else upsert.call_args.kwargs.get("row")
    if row is None and upsert.call_args:
        row = upsert.call_args.args[1] if len(upsert.call_args.args) > 1 else None
    assert upsert.call_args is not None
    assert upsert.call_args.args[0] == "ops_tasks"
