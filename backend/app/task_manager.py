from __future__ import annotations

import asyncio
import logging
import secrets
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional

from app.config import settings

logger = logging.getLogger("letterboxd_wrapped.task_manager")

PERSISTABLE_KINDS = frozenset({"scrape"})
SECONDS_PER_SCRAPE_JOB = 15
STALE_CLAIM_SECONDS = 600


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
    queue_wait_seconds: Optional[float] = None
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
    cached: bool = False


# In-memory task queue. Keep uvicorn pinned to 1 worker in production.
# Scrape jobs are also write-through persisted to ops_tasks (mw_new).
_tasks: Dict[str, TaskState] = {}

_SERVER_STARTED_AT: datetime = datetime.now(timezone.utc)
RECENT_RESTART_WINDOW_SECONDS = 900

# Last successful outbound-worker heartbeat. Enqueue gate for username scrapes.
_last_worker_heartbeat: Optional[datetime] = None
_worker_heartbeats: Dict[str, datetime] = {}
_last_worker_meta: Dict[str, Any] = {}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(value: Optional[datetime]) -> Optional[str]:
    return value.isoformat() if value is not None else None


def _parse_dt(value: Any) -> Optional[datetime]:
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        dt = value
    else:
        try:
            dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        except ValueError:
            return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def task_to_row(task: TaskState) -> dict[str, Any]:
    return {
        "task_id": task.task_id,
        "kind": task.kind,
        "status": task.status,
        "stage": task.stage,
        "message": task.message,
        "progress": task.progress,
        "total": task.total,
        "username": task.username,
        "options": task.options or {},
        "claimed": task.claimed,
        "claimed_by": task.claimed_by,
        "lease_token": task.lease_token,
        "owner_key": task.owner_key,
        "poll_token": task.poll_token,
        "result": task.result,
        "error": task.error,
        "error_type": task.error_type,
        "error_stage": task.error_stage,
        "error_code": task.error_code,
        "duration_seconds": task.duration_seconds,
        "queue_wait_seconds": task.queue_wait_seconds,
        "analysis_seconds": task.analysis_seconds,
        "trace_events": task.trace_events or [],
        "created_at": _iso(task.created_at),
        "claimed_at": _iso(task.claimed_at),
        "completed_at": _iso(task.completed_at),
        "failed_at": _iso(task.failed_at),
        "updated_at": _iso(_now()),
    }


def hydrate_task_from_row(row: dict[str, Any]) -> TaskState:
    options = row.get("options") if isinstance(row.get("options"), dict) else {}
    events = row.get("trace_events") if isinstance(row.get("trace_events"), list) else []
    return TaskState(
        task_id=str(row.get("task_id") or ""),
        status=str(row.get("status") or "pending"),
        stage=str(row.get("stage") or "queued"),
        message=str(row.get("message") or "Queued"),
        progress=int(row.get("progress") or 0),
        total=int(row.get("total") or 0),
        result=row.get("result"),
        error=row.get("error"),
        created_at=_parse_dt(row.get("created_at")) or _now(),
        claimed_at=_parse_dt(row.get("claimed_at")),
        completed_at=_parse_dt(row.get("completed_at")),
        failed_at=_parse_dt(row.get("failed_at")),
        duration_seconds=row.get("duration_seconds"),
        analysis_seconds=row.get("analysis_seconds"),
        queue_wait_seconds=row.get("queue_wait_seconds"),
        error_type=row.get("error_type"),
        error_stage=row.get("error_stage"),
        error_code=row.get("error_code"),
        kind=str(row.get("kind") or "scrape"),
        username=row.get("username"),
        options=options,
        claimed=bool(row.get("claimed")),
        claimed_by=row.get("claimed_by"),
        lease_token=row.get("lease_token"),
        trace_events=[e for e in events if isinstance(e, dict)],
        poll_token=str(row.get("poll_token") or secrets.token_urlsafe(32)),
        owner_key=row.get("owner_key"),
    )


def persist_task(task: TaskState) -> None:
    """Write-through scrape jobs to ops_tasks. No-op for analyze / if ops is down."""
    if task.kind not in PERSISTABLE_KINDS:
        return
    if not settings.supabase_enabled:
        return
    from app import supabase_ops

    supabase_ops.fire_and_forget(
        supabase_ops.upsert("ops_tasks", task_to_row(task), on_conflict="task_id")
    )


async def load_pending_tasks() -> int:
    """Reload non-terminal scrape jobs from ops_tasks so a Render restart keeps the queue."""
    if not settings.supabase_enabled:
        return 0
    from app import supabase_ops

    rows = await supabase_ops.select(
        "ops_tasks",
        {
            "kind": "eq.scrape",
            "status": "in.(pending,running)",
            "select": "*",
        },
    )
    loaded = 0
    for row in rows:
        if not isinstance(row, dict) or not row.get("task_id"):
            continue
        task = hydrate_task_from_row(row)
        if not task.task_id:
            continue
        _tasks[task.task_id] = task
        loaded += 1
    if loaded:
        logger.info("Reloaded %d scrape job(s) from ops_tasks", loaded)
    return loaded


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
    task = TaskState(
        task_id=task_id,
        kind="scrape",
        username=username,
        owner_key=owner_key,
        options=dict(options or {}),
        stage="queued",
        message="Queued on live scanner",
    )
    _tasks[task_id] = task
    append_task_event(task_id, "queued", "Queued on live scanner", level="info")
    persist_task(task)
    return task_id


def _assign_lease(job: TaskState, worker_id: Optional[str]) -> None:
    wid = (worker_id or "").strip() or None
    now = _now()
    job.claimed = True
    job.status = "running"
    job.stage = "scraping"
    job.message = "Live scanner is reading Letterboxd"
    job.claimed_at = now
    job.claimed_by = wid
    job.lease_token = secrets.token_urlsafe(32)
    job.queue_wait_seconds = round((now - job.created_at).total_seconds(), 1)


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
    persist_task(job)
    return job


def scrape_queue_metrics(task: TaskState) -> dict[str, Any]:
    """Queue position (1-based) and ETA for the live scanner. ~15s per job ahead."""
    if task.kind != "scrape":
        return {"queue_position": None, "eta_seconds": None, "queue_wait_ms": None}
    if task.status in {"done", "failed"}:
        wait_ms = int(round((task.queue_wait_seconds or 0) * 1000))
        return {"queue_position": 0, "eta_seconds": 0, "queue_wait_ms": wait_ms}

    ahead = [
        other
        for other in _tasks.values()
        if other.kind == "scrape"
        and other.status in {"pending", "running"}
        and other.created_at < task.created_at
    ]
    position = len(ahead) + 1
    if task.status == "running":
        elapsed = (_now() - (task.claimed_at or task.created_at)).total_seconds()
        eta = max(0, int(SECONDS_PER_SCRAPE_JOB - elapsed))
        wait_ms = int(round((task.queue_wait_seconds or 0) * 1000))
    else:
        eta = len(ahead) * SECONDS_PER_SCRAPE_JOB
        wait_ms = int(round((_now() - task.created_at).total_seconds() * 1000))
    return {"queue_position": position, "eta_seconds": eta, "queue_wait_ms": wait_ms}


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
            "timestamp": str(event.get("timestamp") or _now().isoformat()),
        }
    )


def record_worker_heartbeat(meta: Optional[Dict[str, Any]] = None) -> None:
    global _last_worker_heartbeat, _last_worker_meta
    now = _now()
    _last_worker_heartbeat = now
    if meta:
        _last_worker_meta = {**_last_worker_meta, **meta}
        worker_id = str(meta.get("worker_id") or "").strip()
        if worker_id:
            _worker_heartbeats[worker_id] = now
        if settings.supabase_enabled and worker_id:
            from app import supabase_ops

            supabase_ops.fire_and_forget(
                supabase_ops.upsert(
                    "ops_workers",
                    {
                        "worker_id": worker_id,
                        "last_seen_at": now.isoformat(),
                        "version": str(meta.get("version") or meta.get("git_sha") or ""),
                        "git_sha": str(meta.get("git_sha") or ""),
                        "protocol_version": int(meta.get("protocol_version") or 0),
                        "active_jobs": int(meta.get("active_jobs") or 0),
                        "max_concurrency": int(meta.get("max_concurrency") or 1),
                        "status": "online",
                    },
                    on_conflict="worker_id",
                )
            )


def is_worker_online(max_age_seconds: int) -> bool:
    if _last_worker_heartbeat is None:
        return False
    return (_now() - _last_worker_heartbeat) <= timedelta(seconds=max_age_seconds)


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
    return _seconds_between(task.created_at, _now())


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
            "timestamp": _now().isoformat(),
        }
    )


def get_task_state(task_id: str) -> Optional[TaskState]:
    return _tasks.get(task_id)


def get_task_not_found_context() -> Dict[str, Any]:
    boot_age_seconds = round((_now() - _SERVER_STARTED_AT).total_seconds(), 1)
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
        persist_task(task)


def _apply_telemetry(task: TaskState, telemetry: Optional[Dict[str, Any]]) -> None:
    if not telemetry:
        return
    for field_name in (
        "duration_seconds",
        "analysis_seconds",
        "error_type",
        "error_stage",
        "error_code",
        "queue_wait_seconds",
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
        task.completed_at = _now()
        task.duration_seconds = _seconds_between(task.created_at, task.completed_at)
        if task.queue_wait_seconds is None and task.claimed_at is not None:
            task.queue_wait_seconds = _seconds_between(task.created_at, task.claimed_at)
        _apply_telemetry(task, telemetry)
        persist_task(task)


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
        task.failed_at = _now()
        task.duration_seconds = _seconds_between(task.created_at, task.failed_at)
        task.error_code = error_code
        task.error_type = error_type or error_code
        task.error_stage = error_stage or "error"
        _apply_telemetry(task, telemetry)
        persist_task(task)


def requeue_stale_scrape_claims(now: Optional[datetime] = None) -> int:
    """Return running scrape jobs whose lease owner went silent to the pending queue."""
    cutoff = (now or _now()) - timedelta(seconds=STALE_CLAIM_SECONDS)
    requeued = 0
    for task in list(_tasks.values()):
        if task.kind != "scrape" or task.status != "running" or not task.claimed:
            continue
        claimed_at = task.claimed_at or task.created_at
        if claimed_at > cutoff:
            continue
        task.status = "pending"
        task.claimed = False
        task.claimed_by = None
        task.lease_token = None
        task.claimed_at = None
        task.stage = "queued"
        task.message = "Requeued after stale worker claim"
        append_task_event(task.task_id, "requeued", "Stale worker claim released", level="warning")
        persist_task(task)
        requeued += 1
    return requeued


async def cleanup_loop() -> None:
    """Remove terminal tasks after retention; release stale scrape leases."""
    while True:
        await asyncio.sleep(30)
        now = _now()
        requeue_stale_scrape_claims(now)
        cutoff = now - timedelta(hours=1)
        stale = [
            tid
            for tid, t in list(_tasks.items())
            if t.status in {"done", "failed"}
            and (t.completed_at or t.failed_at or t.created_at) < cutoff
        ]
        for tid in stale:
            _tasks.pop(tid, None)
