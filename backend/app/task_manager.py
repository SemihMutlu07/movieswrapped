from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional
import uuid
import secrets

from app import supabase_ops
from app.config import settings

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
    queue_wait_seconds: Optional[float] = None
    worker_seconds: Optional[float] = None
    scrape_seconds: Optional[float] = None
    analysis_seconds: Optional[float] = None
    postback_seconds: Optional[float] = None
    error_type: Optional[str] = None
    error_stage: Optional[str] = None
    error_code: Optional[str] = None
    # Per-job TMDB telemetry aggregate (dict of ints + stage timings). None for
    # jobs that never ran a TMDB-enriched pipeline (avatar-only, old workers).
    tmdb: Optional[Dict[str, Any]] = None
    kind: str = "analyze"     # analyze | scrape | watchlist
    username: Optional[str] = None
    avatar_only: bool = False  # scrape jobs: fetch just the profile avatar, skip full pipeline
    usernames: list = field(default_factory=list)  # watchlist jobs
    job_type: str = ""  # watchlist_compare | date_night
    options: Dict[str, Any] = field(default_factory=dict)
    claimed: bool = False     # scrape/watchlist jobs: True once a worker has taken it
    claimed_by: Optional[str] = None  # worker_id that holds the lease
    lease_token: Optional[str] = None  # secret returned at claim; required on postback
    trace_events: list[Dict[str, Any]] = field(default_factory=list)
    poll_token: str = field(default_factory=lambda: secrets.token_urlsafe(32))
    owner_key: Optional[str] = None


# ponytail: in-memory task queue. `_tasks` is process-global — running uvicorn
# with more than one *process* would split state across processes and break
# polling. Multiple *desktop* scrape workers are supported via per-task
# claimed_by + lease_token. Keep uvicorn pinned to 1 worker in production
# (see backend/Dockerfile). Upgrade path for multi-process: Redis or ops_tasks.
_tasks: Dict[str, TaskState] = {}

# Task state is process-local and does not survive a backend restart (Render
# redeploy, crash, etc.) — a restart silently wipes every queued/running task.
# We can't recover the wiped task, but we can tell a genuinely-unknown/expired
# task_id apart from "this 404 is probably because the server just restarted"
# by comparing against how long this process has been up.
_SERVER_STARTED_AT: datetime = datetime.now(timezone.utc)
RECENT_RESTART_WINDOW_SECONDS = 900  # frontend polling gives up after 10 min; add buffer

# Last time *any* desktop scrape worker checked in (enqueue/online gate).
_last_worker_heartbeat: Optional[datetime] = None
# Per-worker last-seen for lease-aware stale requeue (multi-worker safe).
_worker_heartbeats: Dict[str, datetime] = {}
_last_worker_started_at: Optional[datetime] = None
_last_worker_shutdown_at: Optional[datetime] = None
_last_worker_meta: Dict[str, Any] = {}
_last_worker_self_test: Optional[Dict[str, Any]] = None

WORKER_DESIRED_STATES = {"run", "pause"}
SUPERVISOR_LOG_TAIL_MAX_LINES = 80
SUPERVISOR_LOG_LINE_MAX_CHARS = 500

_worker_desired_state: str = "run"
_worker_restart_token: int = 0
_worker_restart_requested_at: Optional[datetime] = None
_last_supervisor_poll_at: Optional[datetime] = None
_last_supervisor_report_at: Optional[datetime] = None
_last_supervisor_status: Dict[str, Any] = {}
_supervisor_log_tail: list[str] = []


# ponytail: always-run queue — jobs are never rejected for capacity. The
# in-memory dict grows only with live traffic and cleanup_loop evicts terminal
# tasks after 1 hour, so memory stays bounded by throughput. Upgrade path if
# abuse ever matters: per-owner rate limiting at the route layer.
def create_task_state(owner_key: Optional[str] = None) -> str:
    task_id = str(uuid.uuid4())
    _tasks[task_id] = TaskState(task_id=task_id, owner_key=owner_key)
    return task_id


def create_scrape_job(
    username: str,
    avatar_only: bool = False,
    owner_key: Optional[str] = None,
    options: Optional[Dict[str, Any]] = None,
) -> str:
    """Queue a username scrape job for the desktop worker to claim."""
    task_id = str(uuid.uuid4())
    task = TaskState(
        task_id=task_id,
        kind="scrape",
        username=username,
        avatar_only=avatar_only,
        owner_key=owner_key,
        options=dict(options or {}),
        stage="queued",
        message="Queued on desktop scraper",
    )
    _tasks[task_id] = task
    append_task_event(task_id, "queued", "Queued on desktop scraper", level="info")
    _persist_task(task)
    return task_id


def create_watchlist_compare_job(usernames: list, owner_key: Optional[str] = None, options: Optional[Dict[str, Any]] = None) -> str:
    """Queue a watchlist comparison job for the desktop worker to claim."""
    task_id = str(uuid.uuid4())
    task = TaskState(
        task_id=task_id,
        kind="watchlist",
        job_type="watchlist_compare",
        usernames=list(usernames),
        owner_key=owner_key,
        options=dict(options or {}),
        stage="queued",
        message="Queued on desktop scraper",
    )
    _tasks[task_id] = task
    append_task_event(task_id, "queued", "Queued on desktop scraper", level="info")
    _persist_task(task)
    return task_id


def create_date_night_job(usernames: list, owner_key: Optional[str] = None, options: Optional[Dict[str, Any]] = None) -> str:
    """Queue a date-night scrape job for the desktop worker to claim."""
    task_id = str(uuid.uuid4())
    task = TaskState(
        task_id=task_id,
        kind="watchlist",
        job_type="date_night",
        usernames=list(usernames),
        owner_key=owner_key,
        options=dict(options or {}),
        stage="queued",
        message="Queued on desktop scraper",
    )
    _tasks[task_id] = task
    append_task_event(task_id, "queued", "Queued on desktop scraper", level="info")
    _persist_task(task)
    return task_id


def create_find_film_job(usernames: list, owner_key: Optional[str] = None, options: Optional[Dict[str, Any]] = None) -> str:
    """Queue a group find-film scrape job for the desktop worker to claim."""
    task_id = str(uuid.uuid4())
    task = TaskState(
        task_id=task_id,
        kind="watchlist",
        job_type="find_film",
        usernames=list(usernames),
        owner_key=owner_key,
        options=dict(options or {}),
        stage="queued",
        message="Queued on desktop scraper",
    )
    _tasks[task_id] = task
    append_task_event(task_id, "queued", "Queued on desktop scraper", level="info")
    _persist_task(task)
    return task_id


def _assign_lease(job: TaskState, worker_id: Optional[str]) -> None:
    """Hand the claimer an exclusive lease on this task."""
    wid = (worker_id or "").strip() or None
    job.claimed = True
    job.status = "running"
    job.stage = "scraping"
    job.message = "Desktop worker is reading Letterboxd"
    job.claimed_at = datetime.now(timezone.utc)
    job.claimed_by = wid
    job.lease_token = secrets.token_urlsafe(32)


def _clear_lease(job: TaskState) -> None:
    job.claimed = False
    job.claimed_by = None
    job.lease_token = None
    job.claimed_at = None


def claim_next_watchlist_job(worker_id: Optional[str] = None) -> Optional[TaskState]:
    """Atomically claim the oldest unclaimed watchlist/date-night job."""
    if is_worker_paused():
        return None
    queued = sorted(
        [t for t in _tasks.values() if t.kind == "watchlist" and t.status == "pending" and not t.claimed],
        key=lambda t: t.created_at,
    )
    if not queued:
        return None
    job = queued[0]
    _assign_lease(job, worker_id)
    _persist_task(job)
    return job


def claim_next_worker_job(worker_id: Optional[str] = None) -> Optional[TaskState]:
    """Claim the oldest pending outbound-worker job, regardless of job kind."""
    if is_worker_paused():
        return None
    queued = sorted(
        [t for t in _tasks.values() if t.kind in {"scrape", "watchlist"} and t.status == "pending" and not t.claimed],
        key=lambda t: t.created_at,
    )
    if not queued:
        return None
    job = queued[0]
    _assign_lease(job, worker_id)
    append_task_event(job.task_id, "claimed", "Desktop worker claimed the job", level="info")
    _persist_task(job)
    return job


def claim_next_scrape_job(worker_id: Optional[str] = None) -> Optional[TaskState]:
    """Atomically claim the oldest unclaimed, pending scrape job (single-process,
    asyncio single-thread — no lock needed). Returns None if the queue is empty."""
    if is_worker_paused():
        return None
    queued = sorted(
        [t for t in _tasks.values() if t.kind == "scrape" and t.status == "pending" and not t.claimed],
        key=lambda t: t.created_at,
    )
    if not queued:
        return None
    job = queued[0]
    _assign_lease(job, worker_id)
    append_task_event(job.task_id, "claimed", "Desktop worker claimed the scrape job", level="info")
    _persist_task(job)
    return job


def _seconds_between(start: Optional[datetime], end: Optional[datetime]) -> Optional[float]:
    if start is None or end is None:
        return None
    return round((end - start).total_seconds(), 1)


def _iso(value: Optional[datetime]) -> Optional[str]:
    return value.isoformat() if value is not None else None


def _parse_iso_datetime(value: Any) -> Optional[datetime]:
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


# Only desktop-worker jobs are mirrored to Supabase. "analyze" (CSV upload)
# tasks read local disk files a restart also wipes, and the worker-job
# timeout in fail_expired_worker_jobs doesn't apply to them — a reloaded
# analyze row could hang forever instead of cleanly 404ing. There's nothing
# to resume for them regardless of what's in Supabase.
PERSISTED_KINDS = {"scrape", "watchlist"}


def _task_row(task: TaskState) -> Dict[str, Any]:
    return {
        "task_id": task.task_id,
        "kind": task.kind,
        "job_type": task.job_type,
        "status": task.status,
        "stage": task.stage,
        "message": task.message,
        "progress": task.progress,
        "total": task.total,
        "username": task.username,
        "avatar_only": task.avatar_only,
        "usernames": task.usernames,
        "options": task.options,
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
        "worker_seconds": task.worker_seconds,
        "scrape_seconds": task.scrape_seconds,
        "analysis_seconds": task.analysis_seconds,
        "postback_seconds": task.postback_seconds,
        "tmdb": task.tmdb,
        "trace_events": task.trace_events,
        "created_at": _iso(task.created_at),
        "claimed_at": _iso(task.claimed_at),
        "completed_at": _iso(task.completed_at),
        "failed_at": _iso(task.failed_at),
    }


def _persist_task(task: TaskState) -> None:
    """Best-effort write-through mirror of a task transition to Supabase, so
    a pending/running desktop-worker job survives a backend restart. Called
    only at create/claim/terminal/requeue transitions, not on every progress
    tick — resuming a job only needs the transition state, and this keeps
    write volume low. Never blocks the caller; a Supabase outage just means
    the next restart loses that one task, same as today."""
    if not settings.supabase_enabled or task.kind not in PERSISTED_KINDS:
        return
    supabase_ops.fire_and_forget(
        supabase_ops.upsert("ops_tasks", _task_row(task), on_conflict="task_id")
    )


def _apply_telemetry(task: TaskState, telemetry: Optional[Dict[str, Any]]) -> None:
    if not telemetry:
        return
    for field_name in (
        "duration_seconds",
        "queue_wait_seconds",
        "worker_seconds",
        "scrape_seconds",
        "analysis_seconds",
        "postback_seconds",
        "error_type",
        "error_stage",
        "error_code",
    ):
        if field_name in telemetry:
            setattr(task, field_name, telemetry.get(field_name))
    # Per-job TMDB telemetry arrives nested under telemetry["tmdb"] (worker
    # postbacks) — optional and backward-compatible (absent = leave as None).
    tmdb = telemetry.get("tmdb")
    if isinstance(tmdb, dict):
        task.tmdb = tmdb


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


def get_last_worker_id() -> Optional[str]:
    """Worker_id from the most recent heartbeat meta, if any.

    Prefer task.claimed_by for run attribution when a lease exists; this helper
    remains for startup/status paths that have no task context.
    """
    worker_id = _last_worker_meta.get("worker_id")
    return str(worker_id) if worker_id else None


def is_worker_id_online(worker_id: Optional[str], max_age_seconds: int) -> bool:
    """True when this specific worker_id heartbeated within max_age_seconds."""
    if not worker_id:
        return False
    seen = _worker_heartbeats.get(worker_id)
    if seen is None:
        return False
    return (datetime.now(timezone.utc) - seen) <= timedelta(seconds=max_age_seconds)


def record_worker_startup(meta: Optional[Dict[str, Any]] = None) -> None:
    global _last_worker_started_at, _last_worker_meta
    _last_worker_started_at = datetime.now(timezone.utc)
    _last_worker_meta = dict(meta or {})
    record_worker_heartbeat()


def record_worker_shutdown(meta: Optional[Dict[str, Any]] = None) -> None:
    global _last_worker_shutdown_at, _last_worker_meta
    _last_worker_shutdown_at = datetime.now(timezone.utc)
    if meta:
        _last_worker_meta = {**_last_worker_meta, **meta}


def record_worker_self_test(result: Dict[str, Any]) -> None:
    global _last_worker_self_test
    _last_worker_self_test = {
        **result,
        "reported_at": datetime.now(timezone.utc),
    }


def is_worker_paused() -> bool:
    return _worker_desired_state == "pause"


def set_worker_desired_state(desired_state: str) -> Dict[str, Any]:
    global _worker_desired_state
    normalized = str(desired_state or "").strip().lower()
    if normalized not in WORKER_DESIRED_STATES:
        raise ValueError("desired_state must be 'run' or 'pause'")
    _worker_desired_state = normalized
    return get_worker_control_state()


def request_worker_restart() -> Dict[str, Any]:
    global _worker_restart_token, _worker_restart_requested_at
    _worker_restart_token += 1
    _worker_restart_requested_at = datetime.now(timezone.utc)
    return get_worker_control_state()


def apply_worker_control_state(control: Dict[str, Any]) -> Dict[str, Any]:
    """Replace in-memory worker controls with a validated persisted snapshot."""
    global _worker_desired_state, _worker_restart_token, _worker_restart_requested_at
    desired_state = str(control.get("desired_state") or "run").strip().lower()
    if desired_state not in WORKER_DESIRED_STATES:
        desired_state = "run"

    restart_token = control.get("restart_token")
    try:
        restart_token_int = max(0, int(restart_token))
    except (TypeError, ValueError):
        restart_token_int = 0

    _worker_desired_state = desired_state
    _worker_restart_token = restart_token_int
    _worker_restart_requested_at = _parse_iso_datetime(control.get("restart_requested_at"))
    return get_worker_control_state()


def get_worker_control_state() -> Dict[str, Any]:
    return {
        "desired_state": _worker_desired_state,
        "restart_token": _worker_restart_token,
        "restart_requested_at": _iso(_worker_restart_requested_at),
    }


def record_supervisor_poll(last_seen_restart_token: Optional[str] = None) -> Dict[str, Any]:
    global _last_supervisor_poll_at
    _last_supervisor_poll_at = datetime.now(timezone.utc)
    control = get_worker_control_state()
    # One-directional: only restart when the backend's token is NEWER than what the
    # supervisor last saw. A plain `!=` would fire a spurious restart (+ git pull,
    # killing in-flight scrapes) after a backend restart resets the token to 0 while
    # the supervisor still holds a higher last-seen value.
    should_restart = False
    if last_seen_restart_token is not None:
        try:
            should_restart = int(last_seen_restart_token) < int(control["restart_token"])
        except (TypeError, ValueError):
            should_restart = False
    return {
        **control,
        "should_restart": should_restart,
        "last_supervisor_poll_at": _iso(_last_supervisor_poll_at),
    }


def _coerce_supervisor_log_tail(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        lines = value.splitlines()
    elif isinstance(value, list):
        lines = [str(item) for item in value]
    else:
        lines = [str(value)]
    clipped: list[str] = []
    for line in lines[-SUPERVISOR_LOG_TAIL_MAX_LINES:]:
        clipped.append(line[-SUPERVISOR_LOG_LINE_MAX_CHARS:])
    return clipped


def record_supervisor_report(payload: Dict[str, Any]) -> Dict[str, Any]:
    global _last_supervisor_report_at, _last_supervisor_status, _supervisor_log_tail
    _last_supervisor_report_at = datetime.now(timezone.utc)
    allowed = {
        "supervisor_version",
        "supervisor_started_at",
        "backend_url",
        "poll_interval_seconds",
        "desired_state",
        "child_status",
        "child_pid",
        "child_started_at",
        "child_exit_code",
        "last_restart_token_seen",
        "last_control_error",
    }
    status = {key: payload.get(key) for key in allowed if key in payload}
    status["reported_at"] = _iso(_last_supervisor_report_at)
    _last_supervisor_status = status
    _supervisor_log_tail = _coerce_supervisor_log_tail(payload.get("log_tail"))
    return get_worker_supervisor_status()


def get_worker_supervisor_status() -> Dict[str, Any]:
    return {
        "last_poll_at": _iso(_last_supervisor_poll_at),
        "last_report_at": _iso(_last_supervisor_report_at),
        "child_status": _last_supervisor_status.get("child_status") or "unknown",
        "child_pid": _last_supervisor_status.get("child_pid"),
        "child_started_at": _last_supervisor_status.get("child_started_at"),
        "last_restart_token_seen": _last_supervisor_status.get("last_restart_token_seen"),
        "last_control_error": _last_supervisor_status.get("last_control_error"),
        "status": dict(_last_supervisor_status),
        "log_tail": list(_supervisor_log_tail),
    }


def is_worker_online(max_age_seconds: int) -> bool:
    """Any-worker online gate (enqueue / version checks). Lease requeue uses is_worker_id_online."""
    if _last_worker_heartbeat is None:
        return False
    return (datetime.now(timezone.utc) - _last_worker_heartbeat) <= timedelta(seconds=max_age_seconds)


def get_worker_version_status(expected_protocol_version: int, backend_git_sha: Optional[str] = None) -> Dict[str, Any]:
    worker_protocol = _last_worker_meta.get("worker_protocol_version")
    try:
        worker_protocol_int = int(worker_protocol) if worker_protocol is not None else None
    except (TypeError, ValueError):
        worker_protocol_int = None
    protocol_match = worker_protocol_int == expected_protocol_version
    return {
        "expected_protocol_version": expected_protocol_version,
        "worker_protocol_version": worker_protocol_int,
        "protocol_match": protocol_match,
        "worker_git_sha": _last_worker_meta.get("worker_git_sha"),
        "worker_branch": _last_worker_meta.get("worker_branch"),
        "backend_git_sha": backend_git_sha,
        "mismatch": not protocol_match,
    }


def get_worker_status(max_age_seconds: int, *, expected_protocol_version: int = 1, backend_git_sha: Optional[str] = None) -> Dict[str, Any]:
    now = datetime.now(timezone.utc)
    heartbeat_age_seconds = (
        round((now - _last_worker_heartbeat).total_seconds(), 1)
        if _last_worker_heartbeat is not None
        else None
    )
    scrape_tasks = [t for t in _tasks.values() if t.kind in {"scrape", "watchlist"}]
    queued = [t for t in scrape_tasks if t.status == "pending" and not t.claimed]
    running = [t for t in scrape_tasks if t.status == "running"]
    completed = [t for t in scrape_tasks if t.status == "done"]
    failed = [t for t in scrape_tasks if t.status == "failed"]

    self_test = dict(_last_worker_self_test) if _last_worker_self_test else None
    if self_test and isinstance(self_test.get("reported_at"), datetime):
        self_test["reported_at"] = self_test["reported_at"].isoformat()

    return {
        "online": is_worker_online(max_age_seconds),
        "control": get_worker_control_state(),
        "supervisor": get_worker_supervisor_status(),
        "last_heartbeat": _iso(_last_worker_heartbeat),
        "heartbeat_age_seconds": heartbeat_age_seconds,
        "max_age_seconds": max_age_seconds,
        "last_started_at": _iso(_last_worker_started_at),
        "last_shutdown_at": _iso(_last_worker_shutdown_at),
        "meta": dict(_last_worker_meta),
        "version": get_worker_version_status(expected_protocol_version, backend_git_sha),
        "self_test": self_test,
        "queue": {
            "queued": len(queued),
            "running": len(running),
            "completed": len(completed),
            "failed": len(failed),
            "watchlist_queued": sum(t.kind == "watchlist" for t in queued),
            "watchlist_running": sum(t.kind == "watchlist" for t in running),
        },
        "current_jobs": [
            {
                "task_id": t.task_id,
                "username": t.username,
                "usernames": t.usernames,
                "job_type": t.job_type,
                "status": t.status,
                "stage": t.stage,
                "message": t.message,
                "created_at": t.created_at.isoformat(),
                "claimed_at": _iso(t.claimed_at),
                "elapsed_seconds": _seconds_between(t.created_at, now),
                "duration_seconds": t.duration_seconds,
                "queue_wait_seconds": t.queue_wait_seconds,
                "worker_seconds": t.worker_seconds,
                "scrape_seconds": t.scrape_seconds,
                "analysis_seconds": t.analysis_seconds,
                "postback_seconds": t.postback_seconds,
                "error_type": t.error_type,
                "error_stage": t.error_stage,
                "error_code": t.error_code,
                "tmdb": t.tmdb,
                "latest_event": t.trace_events[-1] if t.trace_events else None,
            }
            for t in sorted(queued + running, key=lambda task: task.created_at)
        ][:10],
        "recent_failures": [
            {
                "task_id": t.task_id,
                "username": t.username,
                "message": t.error or t.message,
                "error_type": t.error_type,
                "error_stage": t.error_stage,
                "error_code": t.error_code,
                "duration_seconds": t.duration_seconds,
                "queue_wait_seconds": t.queue_wait_seconds,
                "worker_seconds": t.worker_seconds,
                "failed_at": _iso(t.failed_at),
            }
            for t in sorted(failed, key=lambda task: task.failed_at or task.created_at, reverse=True)
        ][:10],
    }


def get_worker_queue_stats() -> Dict[str, Any]:
    """Queue depth + age of the oldest queued job, for health/alerting."""
    now = datetime.now(timezone.utc)
    queued = sorted(
        (t for t in _tasks.values() if t.kind in {"scrape", "watchlist"} and t.status == "pending" and not t.claimed),
        key=lambda t: t.created_at,
    )
    oldest = queued[0].created_at if queued else None
    return {
        "queue_depth": len(queued),
        "oldest_queued_age_seconds": round((now - oldest).total_seconds(), 1) if oldest else 0,
    }


def get_task_state(task_id: str) -> Optional[TaskState]:
    return _tasks.get(task_id)


def get_task_not_found_context() -> Dict[str, Any]:
    """Extra context for a 404 on task lookup, so callers can distinguish a
    genuinely invalid/expired task_id from the in-memory queue having been
    wiped by a backend restart."""
    boot_age_seconds = round((datetime.now(timezone.utc) - _SERVER_STARTED_AT).total_seconds(), 1)
    return {
        "boot_age_seconds": boot_age_seconds,
        "likely_server_restart": boot_age_seconds < RECENT_RESTART_WINDOW_SECONDS,
    }


async def load_pending_tasks() -> int:
    """Reload non-terminal scrape/watchlist tasks from Supabase at startup, so
    an in-flight browser poll or a pending/claimed desktop-worker job survives
    a backend restart. Best-effort: no-ops (returns 0) if Supabase isn't
    configured, or if `ops_tasks` doesn't exist yet — `supabase_ops.select`
    already swallows that and returns []; `check_expected_schema()` is what
    surfaces the missing-table cause in logs, not this function."""
    if not settings.supabase_enabled:
        return 0
    rows = await supabase_ops.select("ops_tasks", {"status": "in.(pending,running)", "select": "*"})
    loaded = 0
    for row in rows:
        task_id = row.get("task_id")
        if not task_id or task_id in _tasks:
            continue
        _tasks[task_id] = TaskState(
            task_id=task_id,
            status=row.get("status") or "pending",
            stage=row.get("stage") or "idle",
            message=row.get("message") or "Queued",
            progress=row.get("progress") or 0,
            total=row.get("total") or 0,
            result=row.get("result"),
            error=row.get("error"),
            created_at=_parse_iso_datetime(row.get("created_at")) or datetime.now(timezone.utc),
            claimed_at=_parse_iso_datetime(row.get("claimed_at")),
            completed_at=_parse_iso_datetime(row.get("completed_at")),
            failed_at=_parse_iso_datetime(row.get("failed_at")),
            duration_seconds=row.get("duration_seconds"),
            queue_wait_seconds=row.get("queue_wait_seconds"),
            worker_seconds=row.get("worker_seconds"),
            scrape_seconds=row.get("scrape_seconds"),
            analysis_seconds=row.get("analysis_seconds"),
            postback_seconds=row.get("postback_seconds"),
            error_type=row.get("error_type"),
            error_stage=row.get("error_stage"),
            error_code=row.get("error_code"),
            kind=row.get("kind") or "scrape",
            username=row.get("username"),
            avatar_only=bool(row.get("avatar_only")),
            usernames=row.get("usernames") or [],
            job_type=row.get("job_type") or "",
            options=row.get("options") or {},
            claimed=bool(row.get("claimed")),
            claimed_by=row.get("claimed_by"),
            lease_token=row.get("lease_token"),
            trace_events=row.get("trace_events") or [],
            poll_token=row.get("poll_token") or secrets.token_urlsafe(32),
            owner_key=row.get("owner_key"),
        )
        loaded += 1
    return loaded


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
        task.queue_wait_seconds = _seconds_between(task.created_at, task.claimed_at)
        task.worker_seconds = _seconds_between(task.claimed_at, task.completed_at)
        _apply_telemetry(task, telemetry)
        _persist_task(task)


def set_task_failed(task_id: str, error: str, telemetry: Optional[Dict[str, Any]] = None) -> None:
    task = _tasks.get(task_id)
    if task:
        task.status = "failed"
        task.error = error
        task.stage = "error"
        task.message = error
        task.failed_at = datetime.now(timezone.utc)
        task.duration_seconds = _seconds_between(task.created_at, task.failed_at)
        task.queue_wait_seconds = _seconds_between(task.created_at, task.claimed_at)
        task.worker_seconds = _seconds_between(task.claimed_at, task.failed_at)
        _apply_telemetry(task, telemetry)
        _persist_task(task)


# ponytail: a scrape running longer than this is treated as a dead worker and
# re-queued; raise it if real scrapes ever legitimately exceed it.
STALE_CLAIM_SECONDS = 300
# Frontend polling stops at 10 minutes. Expire at 9 minutes and check every
# 30 seconds so the browser receives a terminal response before its deadline.
ACTIVE_JOB_TIMEOUT_SECONDS = 540


def requeue_stale_claims(now: Optional[datetime] = None) -> int:
    """Reclaim scrape/watchlist jobs whose lease owner has gone dark.

    Lease invariant: a claim hands one desktop worker (``claimed_by``) an
    exclusive ``lease_token``. Requeue does not fail the task — it invalidates
    the stale lease so a healthy worker can re-claim it.

    A *live* owner (that worker_id's heartbeat within
    ``worker_heartbeat_max_age_seconds``) still owns its lease, so its in-flight
    claim is never stale, even past STALE_CLAIM_SECONDS: a large library can take
    longer than the window to scrape. Another worker being online does **not**
    protect a dead owner's claim. Legacy claims without ``claimed_by`` fall back
    to the global any-worker online gate. Idempotent — a late postback is keyed
    by task_id + lease_token. Returns how many leases were invalidated."""
    now = now or datetime.now(timezone.utc)
    cutoff = now - timedelta(seconds=STALE_CLAIM_SECONDS)
    max_age = settings.worker_heartbeat_max_age_seconds
    count = 0
    for t in _tasks.values():
        if not (
            t.kind in {"scrape", "watchlist"}
            and t.status == "running"
            and t.stage == "scraping"
            and t.claimed_at
            and t.claimed_at < cutoff
        ):
            continue
        if t.claimed_by:
            if is_worker_id_online(t.claimed_by, max_age):
                continue
        elif is_worker_online(max_age):
            # Legacy claim with no owner: keep global single-worker protection.
            continue
        _clear_lease(t)
        t.status = "pending"
        t.stage = "queued"
        t.message = "Re-queued after the worker went away mid-scrape"
        append_task_event(t.task_id, "requeued", "Worker went away mid-scrape; re-queued", level="warning")
        _persist_task(t)
        count += 1
    return count


def fail_worker_job_if_expired(task: TaskState, now: Optional[datetime] = None) -> bool:
    """Fail one active worker job once its public polling deadline passes."""
    now = now or datetime.now(timezone.utc)
    cutoff = now - timedelta(seconds=ACTIVE_JOB_TIMEOUT_SECONDS)
    if not (
        task.kind in {"scrape", "watchlist"}
        and task.status in {"pending", "running"}
        and task.created_at < cutoff
    ):
        return False
    set_task_failed(
        task.task_id,
        "The desktop worker job timed out. Please try again.",
        {"error_type": "WorkerJobTimeout", "error_stage": task.stage, "error_code": "worker_timeout"},
    )
    return True


def fail_expired_worker_jobs(now: Optional[datetime] = None) -> int:
    """Fail worker jobs that never reach a terminal state after retries."""
    now = now or datetime.now(timezone.utc)
    return sum(fail_worker_job_if_expired(task, now) for task in _tasks.values())


async def cleanup_loop() -> None:
    """Re-queue/expire worker jobs, then remove terminal tasks after retention."""
    while True:
        await asyncio.sleep(30)
        now = datetime.now(timezone.utc)
        requeue_stale_claims(now)
        fail_expired_worker_jobs(now)
        cutoff = now - timedelta(hours=1)
        stale = [
            tid
            for tid, t in list(_tasks.items())
            if t.status in {"done", "failed"}
            and (t.completed_at or t.failed_at or t.created_at) < cutoff
        ]
        for tid in stale:
            _tasks.pop(tid, None)
        if settings.supabase_enabled:
            supabase_ops.fire_and_forget(supabase_ops.delete_before("ops_tasks", cutoff.isoformat()))
