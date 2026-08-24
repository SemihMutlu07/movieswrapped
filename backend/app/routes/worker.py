"""
Authenticated endpoints for the outbound desktop scrape worker.

The desktop machine is not publicly exposed; it runs a long-lived process that
polls these endpoints to claim queued scrape jobs, runs the local scrape +
analysis pipeline, and posts results back. All endpoints require a shared secret
in the `X-Worker-Token` header matching settings.worker_token.
"""
from __future__ import annotations

import asyncio

import logging
import secrets
from datetime import datetime, timezone

from fastapi import APIRouter, Header, HTTPException, Request

from app import supabase_ops, task_manager
from app.config import backend_git_sha, settings
from app.services import dashboard_settings
from app.services.run_log import persist_run
from app.services.worker_alerts import send_alert
from app.services.worker_monitor import log_worker_event

logger = logging.getLogger("letterboxd_wrapped.worker")

router = APIRouter(prefix="/api/worker")
health_router = APIRouter(prefix="/api/health")


@health_router.get("/workers")
async def worker_health():
    """Worker fleet + queue health snapshot.

    status per worker: "online" if last_seen_at < 5 min ago, else "offline".
    Best-effort: if Supabase is not configured the workers list is empty but
    queue stats still come from the in-memory task manager.
    """
    from datetime import datetime, timezone

    now = datetime.now(timezone.utc)
    workers: list[dict] = []
    if settings.supabase_enabled:
        rows = await supabase_ops.select(
            "ops_workers",
            {"select": "worker_id,last_seen_at,version,active_jobs,max_concurrency,status", "order": "last_seen_at.desc"},
        )
        for row in rows:
            last_seen = row.get("last_seen_at")
            try:
                last_seen_dt = datetime.fromisoformat(str(last_seen).replace("Z", "+00:00"))
                age = (now - last_seen_dt).total_seconds()
            except (ValueError, TypeError):
                age = float("inf")
            workers.append({
                "worker_id": row.get("worker_id"),
                "last_seen_at": last_seen,
                "status": "online" if age < settings.worker_offline_after_seconds else "offline",
            })
    queue = task_manager.get_worker_queue_stats()
    return {
        "workers": workers,
        "queue_depth": queue["queue_depth"],
        "oldest_queued_age_seconds": queue["oldest_queued_age_seconds"],
    }


@health_router.post("/test-alert")
async def test_alert(x_health_alert_secret: str | None = Header(default=None)):
    """Send a test message to the ntfy topic to verify end-to-end delivery.

    Protected by a shared secret in the X-Health-Alert-Secret header
    (settings.health_alert_secret). If the secret is not configured the
    endpoint is disabled (404).
    """
    if not settings.health_alert_secret:
        raise HTTPException(
            status_code=404,
            detail={"error_code": "not_configured", "message": "Health alert secret is not configured."},
        )
    supplied = x_health_alert_secret or ""
    if not secrets.compare_digest(supplied, settings.health_alert_secret):
        raise HTTPException(
            status_code=401,
            detail={"error_code": "unauthorized", "message": "Invalid or missing health alert secret."},
        )
    ok = await send_alert("Test alert from Letterboxd Wrapped backend ✅")
    return {"ok": ok, "delivered": ok, "message": "Test alert sent" if ok else "Test alert failed — check backend logs"}


def _require_worker_token(x_worker_token: str | None) -> None:
    """Reject the request unless a worker token is configured and matches."""
    supplied = x_worker_token or ""
    valid = bool(settings.worker_token) and secrets.compare_digest(supplied, settings.worker_token)
    if settings.worker_token_previous:
        valid = valid or secrets.compare_digest(supplied, settings.worker_token_previous)
    if not valid:
        raise HTTPException(
            status_code=401,
            detail={"error_code": "unauthorized", "message": "Invalid or missing worker token."},
        )


def _merge_worker_trace(task_id: str, body: dict) -> None:
    events = body.get("trace_events")
    if isinstance(events, list):
        for event in events:
            if isinstance(event, dict):
                task_manager.append_task_event_payload(task_id, event)


def _task_telemetry(task: task_manager.TaskState) -> dict:
    return {
        "duration_seconds": task.duration_seconds,
        "queue_wait_seconds": task.queue_wait_seconds,
        "worker_seconds": task.worker_seconds,
        "scrape_seconds": task.scrape_seconds,
        "analysis_seconds": task.analysis_seconds,
        "postback_seconds": task.postback_seconds,
        "error_type": task.error_type,
        "error_stage": task.error_stage,
        "error_code": task.error_code,
        "tmdb": task.tmdb,
        "job_type": task.job_type,
        "worker_id": task.claimed_by or task_manager.get_last_worker_id(),
    }


def _resolve_tmdb_telemetry(
    telemetry: dict,
    stats: dict | None,
    body: dict | None = None,
) -> dict | None:
    """Pick the per-job TMDB aggregate from whichever carrier carried it.

    Priority: postback telemetry.tmdb (authoritative worker snapshot), then
    stats.tmdb_telemetry (embedded by the pipeline). Returns None when neither
    is present so old-worker payloads stay byte-compatible in the run log.
    """
    candidate = telemetry.get("tmdb")
    if isinstance(candidate, dict):
        return candidate
    if isinstance(stats, dict):
        embedded = stats.get("tmdb_telemetry")
        if isinstance(embedded, dict):
            return embedded
    return None


def _require_lease(task: task_manager.TaskState, body: dict) -> None:
    """Reject postbacks that do not present the claim's lease_token.

    Legacy rows without a lease_token (pre-migration in-flight claims) skip the
    check so a rolling deploy does not strand a nearly-finished scrape.
    """
    expected = task.lease_token
    if not expected:
        return
    provided = body.get("lease_token") if isinstance(body, dict) else None
    if not isinstance(provided, str) or not secrets.compare_digest(provided, expected):
        raise HTTPException(
            status_code=409,
            detail={
                "error_code": "lease_mismatch",
                "message": "Stale or foreign worker lease for this task.",
            },
        )


def _job_lease_fields(job: task_manager.TaskState) -> dict:
    return {
        "lease_token": job.lease_token,
        "claimed_by": job.claimed_by,
    }


def _request_telemetry(body: dict) -> dict:
    telemetry = body.get("telemetry")
    return telemetry if isinstance(telemetry, dict) else {}


def _request_trace_events(body: dict) -> list[dict]:
    events = body.get("trace_events")
    return [event for event in events if isinstance(event, dict)] if isinstance(events, list) else []


def _request_username(body: dict, stats: dict | None = None) -> str | None:
    username = body.get("username")
    if isinstance(username, str) and username.strip():
        return username.strip().lower()
    if stats:
        scraped_username = stats.get("scraped_username")
        if isinstance(scraped_username, str) and scraped_username.strip():
            return scraped_username.strip().lower()
    return None


def _worker_version_mismatch() -> dict | None:
    if not task_manager.is_worker_online(settings.worker_heartbeat_max_age_seconds):
        return None
    version = task_manager.get_worker_version_status(settings.worker_protocol_version, backend_git_sha())
    return version if version.get("mismatch") else None


@router.post("/heartbeat")
async def worker_heartbeat(request: Request, x_worker_token: str | None = Header(default=None)):
    """Worker liveness ping — upserts one row into ops_workers.

    Every 30s heartbeat writes a single row per worker_id (no event-log
    growth). Only real lifecycle/job events go to ops_worker_events.
    """
    _require_worker_token(x_worker_token)
    try:
        body = await request.json()
    except Exception:
        body = {}
    body = body if isinstance(body, dict) else {}
    task_manager.record_worker_heartbeat(body)
    worker_id = str(body.get("worker_id") or "").strip()
    if worker_id:
        ok = await supabase_ops.upsert(
            "ops_workers",
            {
                "worker_id": worker_id,
                "last_seen_at": datetime.now(timezone.utc).isoformat(),
                "version": str(body.get("version") or ""),
                "active_jobs": body.get("active_jobs", 0),
                "max_concurrency": body.get("max_concurrency", 1),
                "status": "online",
            },
            on_conflict="worker_id",
        )
        if not ok:
            # Loud failure: a heartbeat that never lands means health tracking
            # is blind. supabase_ops.upsert already logged the root cause.
            logger.error(
                "Heartbeat upsert to ops_workers FAILED for worker_id=%s — "
                "/api/health/workers will report it offline. Check Supabase "
                "connectivity and that migration 007 ran.",
                worker_id,
            )
    return {"ok": True}


@router.post("/startup")
async def worker_startup(request: Request, x_worker_token: str | None = Header(default=None)):
    """Record a worker process startup so the admin dashboard can show lifecycle."""
    _require_worker_token(x_worker_token)
    try:
        body = await request.json()
    except Exception:
        body = {}
    body = body if isinstance(body, dict) else {}
    task_manager.record_worker_startup(body)
    await log_worker_event("worker_started", {**body, "severity": "info"})
    return {"ok": True}


@router.post("/shutdown")
async def worker_shutdown(request: Request, x_worker_token: str | None = Header(default=None)):
    """Record graceful worker shutdown. Abrupt power/network loss is inferred by heartbeat expiry."""
    _require_worker_token(x_worker_token)
    try:
        body = await request.json()
    except Exception:
        body = {}
    body = body if isinstance(body, dict) else {}
    task_manager.record_worker_shutdown(body)
    await log_worker_event("worker_stopped", {**body, "severity": "info"})
    return {"ok": True}


@router.post("/self-test")
async def worker_self_test(request: Request, x_worker_token: str | None = Header(default=None)):
    """Record the result of an optional desktop-side real scrape smoke test."""
    _require_worker_token(x_worker_token)
    body = await request.json()
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail={"error_code": "invalid_body", "message": "Body must be an object."})
    task_manager.record_worker_self_test(body)
    return {"ok": True}


@router.get("/control")
async def worker_control(
    last_seen_restart_token: str | None = None,
    x_worker_token: str | None = Header(default=None),
):
    """Supervisor control poll. Does not update Python worker heartbeat."""
    _require_worker_token(x_worker_token)
    await dashboard_settings.load_worker_control_state()
    return task_manager.record_supervisor_poll(last_seen_restart_token)


@router.post("/supervisor")
async def worker_supervisor_report(request: Request, x_worker_token: str | None = Header(default=None)):
    """Record launcher/supervisor status without marking the scraper child online."""
    _require_worker_token(x_worker_token)
    body = await request.json()
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail={"error_code": "invalid_body", "message": "Body must be an object."})
    return {"ok": True, "supervisor": task_manager.record_supervisor_report(body)}


@router.get("/scrape/next")
async def claim_next_scrape(
    worker_id: str | None = None,
    x_worker_token: str | None = Header(default=None),
):
    """Claim the oldest queued scrape job, or return {job: null} if none."""
    _require_worker_token(x_worker_token)
    await dashboard_settings.load_worker_control_state()
    if task_manager.is_worker_paused():
        return {"job": None, "paused": True, "desired_state": "pause"}
    mismatch = _worker_version_mismatch()
    if mismatch:
        raise HTTPException(
            status_code=409,
            detail={
                "error_code": "worker_version_mismatch",
                "message": "Desktop worker must be updated before claiming new jobs.",
                "version": mismatch,
            },
        )
    job = task_manager.claim_next_scrape_job(worker_id=worker_id)
    if job is None:
        return {"job": None}
    logger.info("Worker claimed scrape job %s for @%s by %s", job.task_id, job.username, job.claimed_by)
    await log_worker_event("job_claimed", {
        "task_id": job.task_id,
        "username": job.username,
        "worker_id": job.claimed_by,
        "severity": "info",
    })
    return {
        "job": {
            "task_id": job.task_id,
            "username": job.username,
            "avatar_only": job.avatar_only,
            "options": job.options,
            **_job_lease_fields(job),
        }
    }


@router.post("/scrape/{task_id}/event")
async def record_scrape_event(task_id: str, request: Request, x_worker_token: str | None = Header(default=None)):
    """Append worker/scraper timeline events to the backend task state."""
    _require_worker_token(x_worker_token)
    task = task_manager.get_task_state(task_id)
    if task is None or task.kind != "scrape":
        raise HTTPException(status_code=404, detail={"error_code": "task_not_found", "message": "Scrape job not found or expired."})
    body = await request.json()
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail={"error_code": "invalid_body", "message": "Body must be an object."})
    _require_lease(task, body)

    events = body.get("events")
    if isinstance(events, list):
        for event in events:
            if isinstance(event, dict):
                task_manager.append_task_event_payload(task_id, event)
    else:
        stage = str(body.get("stage") or "").strip()
        if not stage:
            raise HTTPException(status_code=400, detail={"error_code": "invalid_event", "message": "Body must include a stage."})
        task_manager.append_task_event(
            task_id,
            stage,
            str(body.get("message") or ""),
            elapsed_seconds=body.get("elapsed_seconds") if isinstance(body.get("elapsed_seconds"), (int, float)) else None,
            level=str(body.get("level") or "info"),
            metrics=body.get("metrics") if isinstance(body.get("metrics"), dict) else None,
        )
    return {"ok": True}


@router.post("/scrape/{task_id}/complete")
async def complete_scrape(task_id: str, request: Request, x_worker_token: str | None = Header(default=None)):
    """Store final stats for a scrape job so /api/progress/{task_id} returns done."""
    _require_worker_token(x_worker_token)
    body = await request.json()
    stats = body.get("stats")
    if not isinstance(stats, dict):
        raise HTTPException(status_code=400, detail={"error_code": "invalid_stats", "message": "Body must include a stats object."})
    telemetry = _request_telemetry(body)
    task = task_manager.get_task_state(task_id)
    if task is None or task.kind != "scrape":
        persist_run(
            _request_username(body, stats),
            "desktop-worker",
            stats,
            ok=True,
            task_id=task_id,
            trace_events=_request_trace_events(body),
            telemetry=telemetry,
            tmdb=_resolve_tmdb_telemetry(telemetry, stats, body),
        )
        logger.warning("Worker completed orphan scrape job %s; persisted run without task state", task_id)
        return {"ok": True, "orphan": True}

    _require_lease(task, body)
    _merge_worker_trace(task_id, body)
    task_manager.append_task_event(task_id, "completed", "Worker posted final stats", level="info")
    task_manager.set_task_done(
        task_id,
        {"status": "success", "stats": stats},
        telemetry,
    )
    # Carry the postback TMDB aggregate onto the task even when the worker's
    # snapshot is missing but the pipeline embedded one in stats.
    resolved_tmdb = _resolve_tmdb_telemetry(telemetry, stats, body)
    if resolved_tmdb and task.tmdb is None:
        task.tmdb = resolved_tmdb
    elif not resolved_tmdb:
        resolved_tmdb = task.tmdb
    task = task_manager.get_task_state(task_id)
    if task:
        task_manager.append_task_event(task_id, "persisted", "Run log persisted on backend", level="info")
        persist_run(
            task.username,
            "desktop-worker",
            stats,
            ok=True,
            task_id=task_id,
            trace_events=task.trace_events,
            telemetry=_task_telemetry(task),
            tmdb=resolved_tmdb or task.tmdb,
        )
    logger.info("Worker completed scrape job %s", task_id)
    await log_worker_event("job_completed", {
        "task_id": task_id,
        "username": task.username if task else _request_username(body, stats),
        "total_films": stats.get("total_films"),
        "duration_seconds": telemetry.get("duration_seconds"),
    })
    return {"ok": True}


@router.post("/scrape/{task_id}/failed")
async def fail_scrape(task_id: str, request: Request, x_worker_token: str | None = Header(default=None)):
    """Mark a scrape job failed with a frontend-readable error message."""
    _require_worker_token(x_worker_token)
    body = await request.json()
    message = str(body.get("message") or "Desktop worker failed to scrape this profile.")
    telemetry = _request_telemetry(body)
    task = task_manager.get_task_state(task_id)
    if task is None or task.kind != "scrape":
        persist_run(
            _request_username(body),
            "desktop-worker",
            {},
            ok=False,
            error_message=message,
            task_id=task_id,
            trace_events=_request_trace_events(body),
            telemetry=telemetry,
            tmdb=_resolve_tmdb_telemetry(telemetry, None, body),
        )
        logger.warning("Worker failed orphan scrape job %s; persisted run without task state: %s", task_id, message)
        return {"ok": True, "orphan": True}

    _require_lease(task, body)
    _merge_worker_trace(task_id, body)
    error_stage = telemetry.get("error_stage")
    task_manager.append_task_event(task_id, error_stage or "failed", message, level="error")
    task_manager.set_task_failed(task_id, message, telemetry)
    task = task_manager.get_task_state(task_id)
    if task:
        task_manager.append_task_event(task_id, "persisted", "Failure run log persisted on backend", level="info")
        persist_run(
            task.username,
            "desktop-worker",
            {},
            ok=False,
            error_message=message,
            task_id=task_id,
            trace_events=task.trace_events,
            telemetry=_task_telemetry(task),
            tmdb=_resolve_tmdb_telemetry(_task_telemetry(task), None, body),
        )
    logger.warning("Worker reported scrape job %s failed: %s", task_id, message)
    await log_worker_event("job_failed", {
        "task_id": task_id,
        "username": task.username if task else _request_username(body),
        "error_message": message,
        "error_type": telemetry.get("error_type"),
        "error_stage": telemetry.get("error_stage"),
        "error_code": telemetry.get("error_code"),
        "duration_seconds": telemetry.get("duration_seconds"),
    })
    return {"ok": True}


@router.get("/watchlist/next")
async def claim_next_watchlist(
    worker_id: str | None = None,
    x_worker_token: str | None = Header(default=None),
):
    """Claim the oldest queued watchlist/date-night scrape job, or return {job: null}."""
    _require_worker_token(x_worker_token)
    await dashboard_settings.load_worker_control_state()
    if task_manager.is_worker_paused():
        return {"job": None, "paused": True, "desired_state": "pause"}
    mismatch = _worker_version_mismatch()
    if mismatch:
        raise HTTPException(
            status_code=409,
            detail={
                "error_code": "worker_version_mismatch",
                "message": "Desktop worker must be updated before claiming new jobs.",
                "version": mismatch,
            },
        )
    job = task_manager.claim_next_watchlist_job(worker_id=worker_id)
    if job is None:
        return {"job": None}
    logger.info("Worker claimed watchlist job %s type=%s users=%s by %s", job.task_id, job.job_type, job.usernames, job.claimed_by)
    await log_worker_event("job_claimed", {
        "task_id": job.task_id,
        "job_type": job.job_type,
        "usernames": job.usernames,
        "worker_id": job.claimed_by,
        "severity": "info",
    })
    return {
        "job": {
            "task_id": job.task_id,
            "job_type": job.job_type,
            "usernames": job.usernames,
            **_job_lease_fields(job),
        }
    }


@router.get("/next")
async def claim_next_worker(
    worker_id: str | None = None,
    x_worker_token: str | None = Header(default=None),
):
    """Claim the oldest profile or watchlist job to prevent queue starvation."""
    _require_worker_token(x_worker_token)
    await dashboard_settings.load_worker_control_state()
    if task_manager.is_worker_paused():
        return {"job": None, "paused": True}
    mismatch = _worker_version_mismatch()
    if mismatch:
        raise HTTPException(status_code=409, detail={"error_code": "worker_version_mismatch", "version": mismatch})
    job = task_manager.claim_next_worker_job(worker_id=worker_id)
    if job is None:
        return {"job": None}
    if job.kind == "watchlist":
        await log_worker_event("job_claimed", {
            "task_id": job.task_id,
            "job_type": job.job_type,
            "usernames": job.usernames,
            "worker_id": job.claimed_by,
            "severity": "info",
        })
        return {
            "job": {
                "kind": "watchlist",
                "task_id": job.task_id,
                "job_type": job.job_type,
                "usernames": job.usernames,
                **_job_lease_fields(job),
            }
        }
    await log_worker_event("job_claimed", {
        "task_id": job.task_id,
        "username": job.username,
        "worker_id": job.claimed_by,
        "severity": "info",
    })
    return {
        "job": {
            "kind": "scrape",
            "task_id": job.task_id,
            "username": job.username,
            "avatar_only": job.avatar_only,
            "options": job.options,
            **_job_lease_fields(job),
        }
    }


@router.post("/watchlist/{task_id}/complete")
async def complete_watchlist(task_id: str, request: Request, x_worker_token: str | None = Header(default=None)):
    """Receive raw scraped film lists from the worker so the backend can finish processing."""
    _require_worker_token(x_worker_token)
    body = await request.json()
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail={"error_code": "invalid_body", "message": "Body must be an object."})
    task = task_manager.get_task_state(task_id)
    if task is None or task.kind != "watchlist":
        raise HTTPException(status_code=404, detail={"error_code": "task_not_found", "message": "Watchlist job not found."})
    if task.status in {"done", "failed"} or task.stage == "processing":
        return {"ok": True, "duplicate": True}
    _require_lease(task, body)
    if task.options.get("raw_only"):
        task_manager.set_task_done(task_id, body)
        logger.info("Worker completed raw watchlist job %s", task_id)
        await log_worker_event("job_completed", {
            "task_id": task_id,
            "job_type": task.job_type,
            "usernames": task.usernames,
            "severity": "info",
        })
        return {"ok": True}
    task.result = body
    task.status = "running"
    task.stage = "processing"
    task.message = "Preparing recommendations"
    from app.services.watchlist_jobs import finalize_watchlist_job
    asyncio.create_task(finalize_watchlist_job(task_id, request.app.state.aiohttp_session))
    logger.info("Worker stored raw watchlist job %s", task_id)
    return {"ok": True}


@router.post("/watchlist/{task_id}/failed")
async def fail_watchlist(task_id: str, request: Request, x_worker_token: str | None = Header(default=None)):
    """Mark a watchlist scrape job as failed."""
    _require_worker_token(x_worker_token)
    body = await request.json()
    message = str(body.get("message") or "Desktop worker failed to scrape watchlist.")
    task = task_manager.get_task_state(task_id)
    if task is None or task.kind != "watchlist":
        raise HTTPException(status_code=404, detail={"error_code": "task_not_found", "message": "Watchlist job not found."})
    if task.status in {"done", "failed"} or task.stage == "processing":
        return {"ok": True, "duplicate": True}
    _require_lease(task, body)
    task_manager.set_task_failed(task_id, message, _request_telemetry(body))
    logger.warning("Worker reported watchlist job %s failed: %s", task_id, message)
    await log_worker_event("job_failed", {
        "task_id": task_id,
        "job_type": task.job_type,
        "usernames": task.usernames,
        "source": "desktop_worker",
        "severity": "error",
        "message": message,
        "error_type": _request_telemetry(body).get("error_type"),
        "error_stage": _request_telemetry(body).get("error_stage"),
        "error_code": _request_telemetry(body).get("error_code"),
    })
    return {"ok": True}
