from __future__ import annotations

import asyncio
import logging
import secrets
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional

logger = logging.getLogger("letterboxd_wrapped.task_manager")


@dataclass
class TaskState:
    task_id: str
    status: str = "pending"   # pending | running | done | failed
    stage: str = "idle"
    message: str = "Queued"
    progress: int = 0
    total: int = 0
    result: Optional[Any] = None
    error: Optional[str] = None
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    claimed_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    failed_at: Optional[datetime] = None
    duration_seconds: Optional[float] = None
    analysis_seconds: Optional[float] = None
    error_type: Optional[str] = None
    error_stage: Optional[str] = None
    error_code: Optional[str] = None
    tmdb: Optional[Dict[str, Any]] = None
    trace_events: list[Dict[str, Any]] = field(default_factory=list)
    poll_token: str = field(default_factory=lambda: secrets.token_urlsafe(32))
    owner_key: Optional[str] = None


# In-memory task queue. Keep uvicorn pinned to 1 worker in production.
_tasks: Dict[str, TaskState] = {}

_SERVER_STARTED_AT: datetime = datetime.now(timezone.utc)
RECENT_RESTART_WINDOW_SECONDS = 900


def create_task_state(owner_key: Optional[str] = None) -> str:
    task_id = str(uuid.uuid4())
    _tasks[task_id] = TaskState(task_id=task_id, owner_key=owner_key)
    return task_id


def _seconds_between(start: Optional[datetime], end: Optional[datetime]) -> Optional[float]:
    if start is None or end is None:
        return None
    return round((end - start).total_seconds(), 1)


def _event_elapsed(task: TaskState) -> Optional[float]:
    return _seconds_between(task.created_at, datetime.now(timezone.utc))


def append_task_event(
    task_id: str,
    stage: str,
    message: str,
    *,
    elapsed_seconds: Optional[float] = None,
    level: str = "info",
    metrics: Optional[Dict[str, Any]] = None,
) -> None:
    task = _tasks.get(task_id)
    if not task:
        return
    task.trace_events.append(
        {
            "stage": stage,
            "message": message,
            "elapsed_seconds": elapsed_seconds if elapsed_seconds is not None else _event_elapsed(task),
            "level": level,
            "metrics": metrics or {},
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
    )


def get_task_state(task_id: str) -> Optional[TaskState]:
    return _tasks.get(task_id)


def get_task_not_found_context() -> Dict[str, Any]:
    boot_age_seconds = round((datetime.now(timezone.utc) - _SERVER_STARTED_AT).total_seconds(), 1)
    return {
        "boot_age_seconds": boot_age_seconds,
        "likely_server_restart": boot_age_seconds < RECENT_RESTART_WINDOW_SECONDS,
    }


def update_task_progress(
    task_id: str,
    stage: str,
    message: str,
    progress: int = 0,
    total: int = 0,
) -> None:
    task = _tasks.get(task_id)
    if task:
        task.stage = stage
        task.message = message
        task.progress = progress
        task.total = total
        append_task_event(task_id, stage, message, metrics={"progress": progress, "total": total})
    logger.info("[%s] %s: %s (%d/%d)", task_id[:8], stage, message, progress, total)


def set_task_running(task_id: str) -> None:
    task = _tasks.get(task_id)
    if task:
        task.status = "running"


def _apply_telemetry(task: TaskState, telemetry: Optional[Dict[str, Any]]) -> None:
    if not telemetry:
        return
    for field_name in (
        "duration_seconds",
        "analysis_seconds",
        "error_type",
        "error_stage",
        "error_code",
    ):
        if field_name in telemetry:
            setattr(task, field_name, telemetry.get(field_name))
    tmdb = telemetry.get("tmdb")
    if isinstance(tmdb, dict):
        task.tmdb = tmdb


def set_task_done(task_id: str, result: Any, telemetry: Optional[Dict[str, Any]] = None) -> None:
    task = _tasks.get(task_id)
    if task:
        task.status = "done"
        task.result = result
        task.stage = "complete"
        task.message = "Analysis complete!"
        task.progress = 100
        task.total = 100
        task.completed_at = datetime.now(timezone.utc)
        task.duration_seconds = _seconds_between(task.created_at, task.completed_at)
        _apply_telemetry(task, telemetry)


def set_task_failed(task_id: str, error: str, telemetry: Optional[Dict[str, Any]] = None) -> None:
    task = _tasks.get(task_id)
    if task:
        task.status = "failed"
        task.error = error
        task.stage = "error"
        task.message = error
        task.failed_at = datetime.now(timezone.utc)
        task.duration_seconds = _seconds_between(task.created_at, task.failed_at)
        _apply_telemetry(task, telemetry)


async def cleanup_loop() -> None:
    """Remove terminal tasks after retention."""
    while True:
        await asyncio.sleep(30)
        now = datetime.now(timezone.utc)
        cutoff = now - timedelta(hours=1)
        stale = [
            tid
            for tid, t in list(_tasks.items())
            if t.status in {"done", "failed"}
            and (t.completed_at or t.failed_at or t.created_at) < cutoff
        ]
        for tid in stale:
            _tasks.pop(tid, None)
