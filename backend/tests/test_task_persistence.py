"""
Task queue — in-memory analyze tasks only.

Run from backend/ directory:
    pytest tests/test_task_persistence.py
"""
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
