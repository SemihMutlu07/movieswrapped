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
    kind: str = "analyze"  # analyze | scrape
    username: Optional[str] = None
    options: Dict[str, Any] = field(default_factory=dict)
    claimed: bool = False
    claimed_by: Optional[str] = None
    lease_token: Optional[str] = None
    trace_events: list[Dict[str, Any]] = field(default_factory=list)
    poll_token: str = field(default_factory=lambda: secrets.token_urlsafe(32))
    owner_key: Optional[str] = None


# In-memory task queue. Keep uvicorn pinned to 1 worker in production.
_tasks: Dict[str, TaskState] = {}

_SERVER_STARTED_AT: datetime = datetime.now(timezone.utc)
RECENT_RESTART_WINDOW_SECONDS = 900

# Last successful outbound-worker heartbeat. Enqueue gate for username scrapes.
_last_worker_heartbeat: Optional[datetime] = None
_worker_heartbeats: Dict[str, datetime] = {}
_last_worker_meta: Dict[str, Any] = {}


def create_task_state(owner_key: Optional[str] = None) -> str:
    task_id = str(uuid.uuid4())
    _tasks[task_id] = TaskState(task_id=task_id, owner_key=owner_key)
    return task_id


def create_scrape_job(
    username: str,
    owner_key: Optional[str] = None,
    options: Optional[Dict[str, Any]] = None,
) -> str:
    """Queue a username scrape for the outbound desktop worker to claim."""
    task_id = str(uuid.uuid4())
    _tasks[task_id] = TaskState(
        task_id=task_id,
        kind="scrape",
        username=username,
        owner_key=owner_key,
        options=dict(options or {}),
        stage="queued",
        message="Queued on desktop scraper",
    )
    append_task_event(task_id, "queued", "Queued on desktop scraper", level="info")
    return task_id


def _assign_lease(job: TaskState, worker_id: Optional[str]) -> None:
    wid = (worker_id or "").strip() or None
    job.claimed = True
    job.status = "running"
    job.stage = "scraping"
    job.message = "Desktop worker is reading Letterboxd"
    job.claimed_at = datetime.now(timezone.utc)
    job.claimed_by = wid
    job.lease_token = secrets.token_urlsafe(32)


def claim_next_scrape_job(worker_id: Optional[str] = None) -> Optional[TaskState]:
    queued = sorted(
        [t for t in _tasks.values() if t.kind == "scrape" and t.status == "pending" and not t.claimed],
        key=lambda t: t.created_at,
    )
    if not queued:
        return None
    job = queued[0]
    _assign_lease(job, worker_id)
    append_task_event(job.task_id, "claimed", "Desktop worker claimed the scrape job", level="info")
    return job


def append_task_event_payload(task_id: str, event: Dict[str, Any]) -> None:
    task = _tasks.get(task_id)
    if not task:
        return
    stage = str(event.get("stage") or "event")
    message = str(event.get("message") or "")
    elapsed = event.get("elapsed_seconds")
    key = (stage, message, elapsed)
    for existing in task.trace_events:
        if (existing.get("stage"), existing.get("message"), existing.get("elapsed_seconds")) == key:
            return
    task.trace_events.append(
        {
            "stage": stage,
            "message": message,
            "elapsed_seconds": elapsed if isinstance(elapsed, (int, float)) else _event_elapsed(task),
            "level": str(event.get("level") or "info"),
            "metrics": event.get("metrics") if isinstance(event.get("metrics"), dict) else {},
            "timestamp": str(event.get("timestamp") or datetime.now(timezone.utc).isoformat()),
        }
    )


def record_worker_heartbeat(meta: Optional[Dict[str, Any]] = None) -> None:
    global _last_worker_heartbeat, _last_worker_meta
    now = datetime.now(timezone.utc)
    _last_worker_heartbeat = now
    if meta:
        _last_worker_meta = {**_last_worker_meta, **meta}
        worker_id = str(meta.get("worker_id") or "").strip()
        if worker_id:
            _worker_heartbeats[worker_id] = now


def is_worker_online(max_age_seconds: int) -> bool:
    if _last_worker_heartbeat is None:
        return False
    return (datetime.now(timezone.utc) - _last_worker_heartbeat) <= timedelta(seconds=max_age_seconds)


def reset_worker_runtime() -> None:
    """Test helper: drop queued scrape jobs and heartbeat liveness."""
    global _last_worker_heartbeat, _last_worker_meta
    _last_worker_heartbeat = None
    _last_worker_meta = {}
    _worker_heartbeats.clear()
    for tid, task in list(_tasks.items()):
        if task.kind == "scrape":
            _tasks.pop(tid, None)


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
    *,
    metrics: Optional[Dict[str, Any]] = None,
) -> None:
    task = _tasks.get(task_id)
    event_metrics: Dict[str, Any] = {"progress": progress, "total": total}
    if metrics:
        event_metrics.update(metrics)
    if task:
        task.stage = stage
        task.message = message
        task.progress = progress
        task.total = total
        append_task_event(task_id, stage, message, metrics=event_metrics)
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


def set_task_failed(
    task_id: str,
    error: str,
    telemetry: Optional[Dict[str, Any]] = None,
    *,
    error_code: Optional[str] = None,
    error_type: Optional[str] = None,
    error_stage: Optional[str] = None,
) -> None:
    task = _tasks.get(task_id)
    if task:
        task.status = "failed"
        task.error = error
        task.stage = error_stage or "error"
        task.message = error
        task.failed_at = datetime.now(timezone.utc)
        task.duration_seconds = _seconds_between(task.created_at, task.failed_at)
        task.error_code = error_code
        task.error_type = error_type or error_code
        task.error_stage = error_stage or "error"
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
