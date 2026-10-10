"""Outbound desktop-worker control plane.

The X370 polls these endpoints. It is never exposed inbound. Every route
requires `X-Worker-Token` == settings.worker_token.
"""
from __future__ import annotations

import logging
import secrets

from fastapi import APIRouter, Header, HTTPException, Request

from app import task_manager
from app.config import settings
from app.services.run_log import persist_run

logger = logging.getLogger("letterboxd_wrapped.worker")

router = APIRouter(prefix="/api/worker")

WORKER_OFFLINE_MESSAGE = (
    "The desktop scraper is offline. Please download your Letterboxd export "
    "and upload it for the best experience."
)


def _constant_time_equal(supplied: str, expected: str) -> bool:
    if not supplied or not expected or len(supplied) != len(expected):
        return False
    return secrets.compare_digest(supplied, expected)


def require_worker_token(x_worker_token: str | None) -> None:
    supplied = x_worker_token or ""
    expected = settings.worker_token or ""
    if not _constant_time_equal(supplied, expected):
        raise HTTPException(
            status_code=401,
            detail={"error_code": "unauthorized", "message": "Invalid or missing worker token."},
        )


def _require_lease(task: task_manager.TaskState, body: dict) -> None:
    expected = task.lease_token
    if not expected:
        return
    provided = body.get("lease_token") if isinstance(body, dict) else None
    if not isinstance(provided, str) or not _constant_time_equal(provided, expected):
        raise HTTPException(
            status_code=409,
            detail={
                "error_code": "lease_mismatch",
                "message": "Stale or foreign worker lease for this task.",
            },
        )


def _lease_fields(job: task_manager.TaskState) -> dict:
    return {"lease_token": job.lease_token, "claimed_by": job.claimed_by}


def _request_telemetry(body: dict) -> dict:
    telemetry = body.get("telemetry")
    return telemetry if isinstance(telemetry, dict) else {}


@router.post("/heartbeat")
async def worker_heartbeat(request: Request, x_worker_token: str | None = Header(default=None)):
    require_worker_token(x_worker_token)
    try:
        body = await request.json()
    except Exception:
        body = {}
    body = body if isinstance(body, dict) else {}
    task_manager.record_worker_heartbeat(body)
    return {"ok": True}


@router.get("/next")
async def claim_next(
    worker_id: str | None = None,
    x_worker_token: str | None = Header(default=None),
):
    require_worker_token(x_worker_token)
    job = task_manager.claim_next_scrape_job(worker_id=worker_id)
    if job is None:
        return {"job": None}
    logger.info("Worker claimed scrape job %s for @%s", job.task_id, job.username)
    return {
        "job": {
            "task_id": job.task_id,
            "kind": "scrape",
            "username": job.username,
            "options": job.options,
            **_lease_fields(job),
        }
    }


@router.post("/scrape/{task_id}/event")
async def record_scrape_event(
    task_id: str,
    request: Request,
    x_worker_token: str | None = Header(default=None),
):
    require_worker_token(x_worker_token)
    task = task_manager.get_task_state(task_id)
    if task is None or task.kind != "scrape":
        raise HTTPException(
            status_code=404,
            detail={"error_code": "task_not_found", "message": "Scrape job not found or expired."},
        )
    body = await request.json()
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail={"error_code": "invalid_body", "message": "Body must be an object."})
    _require_lease(task, body)

    events = body.get("events")
    if isinstance(events, list):
        last_stage = ""
        last_message = ""
        for event in events:
            if isinstance(event, dict):
                task_manager.append_task_event_payload(task_id, event)
                last_stage = str(event.get("stage") or last_stage)
                last_message = str(event.get("message") or last_message)
        if last_stage:
            task.stage = last_stage
            task.message = last_message or last_stage
        return {"ok": True}

    stage = str(body.get("stage") or "").strip()
    if not stage:
        raise HTTPException(status_code=400, detail={"error_code": "invalid_event", "message": "Body must include a stage."})
    message = str(body.get("message") or "")
    task_manager.append_task_event(
        task_id,
        stage,
        message,
        elapsed_seconds=body.get("elapsed_seconds") if isinstance(body.get("elapsed_seconds"), (int, float)) else None,
        level=str(body.get("level") or "info"),
        metrics=body.get("metrics") if isinstance(body.get("metrics"), dict) else None,
    )
    task.stage = stage
    task.message = message or stage
    return {"ok": True}


@router.post("/scrape/{task_id}/complete")
async def complete_scrape(
    task_id: str,
    request: Request,
    x_worker_token: str | None = Header(default=None),
):
    require_worker_token(x_worker_token)
    body = await request.json()
    stats = body.get("stats")
    if not isinstance(stats, dict):
        raise HTTPException(
            status_code=400,
            detail={"error_code": "invalid_stats", "message": "Body must include a stats object."},
        )
    telemetry = _request_telemetry(body)
    task = task_manager.get_task_state(task_id)
    if task is None or task.kind != "scrape":
        persist_run(body.get("username"), "desktop-worker", stats, ok=True, task_id=task_id, telemetry=telemetry)
        return {"ok": True, "orphan": True}

    _require_lease(task, body)
    events = body.get("trace_events")
    if isinstance(events, list):
        for event in events:
            if isinstance(event, dict):
                task_manager.append_task_event_payload(task_id, event)
    task_manager.append_task_event(task_id, "completed", "Worker posted final stats", level="info")
    task_manager.set_task_done(task_id, {"status": "success", "stats": stats}, telemetry)
    persist_run(task.username, "desktop-worker", stats, ok=True, task_id=task_id, telemetry=telemetry)
    logger.info("Worker completed scrape job %s", task_id)
    return {"ok": True}


@router.post("/scrape/{task_id}/failed")
async def fail_scrape(
    task_id: str,
    request: Request,
    x_worker_token: str | None = Header(default=None),
):
    require_worker_token(x_worker_token)
    body = await request.json()
    message = str(body.get("message") or "Desktop worker failed to scrape this profile.")
    telemetry = _request_telemetry(body)
    error_code = str(telemetry.get("error_code") or "scrape_failed")
    task = task_manager.get_task_state(task_id)
    if task is None or task.kind != "scrape":
        persist_run(
            body.get("username"),
            "desktop-worker",
            {},
            ok=False,
            error_message=message,
            task_id=task_id,
            telemetry=telemetry,
        )
        return {"ok": True, "orphan": True}

    _require_lease(task, body)
    task_manager.append_task_event(task_id, telemetry.get("error_stage") or "failed", message, level="error")
    task_manager.set_task_failed(
        task_id,
        message,
        telemetry,
        error_code=error_code,
        error_type=str(telemetry.get("error_type") or error_code),
        error_stage=str(telemetry.get("error_stage") or "scrape"),
    )
    persist_run(
        task.username,
        "desktop-worker",
        {},
        ok=False,
        error_message=message,
        task_id=task_id,
        telemetry=telemetry,
    )
    logger.warning("Worker reported scrape job %s failed: %s", task_id, message)
    return {"ok": True}
