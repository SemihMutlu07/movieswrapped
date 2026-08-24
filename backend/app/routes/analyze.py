from __future__ import annotations

import asyncio
import logging
import os
import re
import shutil
import uuid
import zipfile
import secrets
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, File, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse

from app import task_manager
from app.config import settings
from app.routes.feedback import _parse_letterboxd_username
from app.services.analysis import process_comprehensive_letterboxd_data
from app.services import dashboard_settings
from app.services.scrape_pipeline import (
    ScrapeAnalysisEmpty,
    normalize_analysis_period,
    scrape_and_analyze,
)
from app.services.run_log import persist_run
from app.security import client_key, enforce_rate_limit

logger = logging.getLogger("letterboxd_wrapped.analyze")

router = APIRouter()

_REQUIRED_FILES = [
    "diary.csv", "ratings.csv", "watched.csv", "reviews.csv",
    "watchlist.csv", "films.csv", "comments.csv", "profile.csv",
]
MAX_UPLOAD_BYTES = 50 * 1024 * 1024
MAX_ARCHIVE_BYTES = 200 * 1024 * 1024
MAX_ARCHIVE_ENTRIES = 30


def _safe_extract_letterboxd_zip(upload, request_dir: Path) -> None:
    with zipfile.ZipFile(upload, "r") as zf:
        infos = zf.infolist()
        if len(infos) > MAX_ARCHIVE_ENTRIES:
            raise HTTPException(status_code=413, detail={"error_code": "too_many_files", "message": "Archive contains too many files."})
        total = 0
        seen: set[str] = set()
        allowed = set(_REQUIRED_FILES)
        for info in infos:
            path = Path(info.filename)
            name = path.name.lower()
            if info.is_dir():
                continue
            mode = info.external_attr >> 16
            if path.is_absolute() or ".." in path.parts or mode & 0o170000 == 0o120000 or info.flag_bits & 0x1:
                raise HTTPException(status_code=400, detail={"error_code": "unsafe_archive", "message": "Archive contains an unsafe entry."})
            if name not in allowed:
                continue
            if name in seen:
                raise HTTPException(status_code=400, detail={"error_code": "unsafe_archive", "message": "Archive contains duplicate Letterboxd files."})
            total += info.file_size
            if info.file_size > MAX_UPLOAD_BYTES or total > MAX_ARCHIVE_BYTES:
                raise HTTPException(status_code=413, detail={"error_code": "archive_too_large", "message": "Archive expands beyond the allowed size."})
            seen.add(name)
            written = 0
            with zf.open(info) as source, (request_dir / name).open("wb") as destination:
                while chunk := source.read(1024 * 1024):
                    written += len(chunk)
                    if written > MAX_UPLOAD_BYTES:
                        raise HTTPException(status_code=413, detail={"error_code": "archive_too_large", "message": "Archive file is too large."})
                    destination.write(chunk)


def _find_csv_files(directory: Path) -> dict:
    csv_found: dict = {}
    for root, _dirs, files in os.walk(directory):
        for file in files:
            if file.lower().endswith(".csv"):
                logger.debug("[upload-debug] Found CSV: %s", file)
                for req in _REQUIRED_FILES:
                    if req not in csv_found and req.split(".")[0] in file.lower():
                        csv_found[req] = os.path.join(root, file)
                        logger.info("[upload-debug] Matched %s → %s", req, file)
                        break
    if not csv_found:
        logger.warning("[upload-debug] No matching CSV files in %s. Files found: %s", directory, list(os.walk(directory)))
    return csv_found


AVATAR_JOB_TIMEOUT_SECONDS = 20
AVATAR_JOB_POLL_SECONDS = 1


async def _fetch_avatar_best_effort(username: str) -> Optional[str]:
    """Queue a lightweight avatar-only job on the desktop worker and wait briefly
    for it. Best-effort: any failure or timeout just yields None (frontend already
    falls back to a placeholder), it must never fail the CSV/ZIP analysis."""
    if not settings.desktop_worker_enabled:
        return None
    if not task_manager.is_worker_online(settings.worker_heartbeat_max_age_seconds):
        return None
    try:
        job_task_id = task_manager.create_scrape_job(username, avatar_only=True)
        loop = asyncio.get_event_loop()
        deadline = loop.time() + AVATAR_JOB_TIMEOUT_SECONDS
        while loop.time() < deadline:
            job = task_manager.get_task_state(job_task_id)
            if job is None or job.status == "failed":
                return None
            if job.status == "done":
                return (job.result or {}).get("stats", {}).get("profile_avatar_url")
            await asyncio.sleep(AVATAR_JOB_POLL_SECONDS)
    except Exception:
        logger.warning("Avatar fetch failed for @%s", username, exc_info=True)
    return None


async def _run_analysis(
    task_id: str,
    session,
    csv_files: dict,
    request_dir: Path,
    username: Optional[str] = None,
) -> None:
    try:
        task_manager.set_task_running(task_id)
        stats = await process_comprehensive_letterboxd_data(session, csv_files, task_id)
        if username:
            stats["profile_avatar_url"] = await _fetch_avatar_best_effort(username)
        task_manager.set_task_done(task_id, {"status": "success", "stats": stats})
        persist_run(username, "upload", stats, ok=True, task_id=task_id)
    except Exception as exc:
        task_manager.set_task_failed(task_id, str(exc))
    finally:
        shutil.rmtree(request_dir, ignore_errors=True)


@router.post("/api/analyze", status_code=202)
async def analyze_data(request: Request, files: List[UploadFile] = File(...)):
    """
    Accept a Letterboxd export (ZIP or CSVs) and start analysis in the background.
    Returns 202 Accepted with a task_id for polling.
    """
    enforce_rate_limit(request, "analyze", limit=3, window=600)
    if not files:
        raise HTTPException(status_code=400, detail={"error_code": "no_files", "message": "No files uploaded."})

    upload_dir = Path("uploads")
    upload_dir.mkdir(exist_ok=True)
    request_dir = upload_dir / str(uuid.uuid4())
    request_dir.mkdir(exist_ok=True)

    csv_files: dict = {}

    try:
        if len(files) == 1 and files[0].filename and files[0].filename.lower().endswith((".zip", ".utc")):
            _safe_extract_letterboxd_zip(files[0].file, request_dir)
        elif all(f.filename and f.filename.lower().endswith(".csv") for f in files):
            for uf in files:
                safe_name = Path(uf.filename).name
                written = 0
                with (request_dir / safe_name).open("wb") as destination:
                    while chunk := await uf.read(1024 * 1024):
                        written += len(chunk)
                        if written > MAX_UPLOAD_BYTES:
                            raise HTTPException(status_code=413, detail={"error_code": "archive_too_large", "message": "Upload is too large."})
                        destination.write(chunk)
        else:
            shutil.rmtree(request_dir, ignore_errors=True)
            raise HTTPException(
                status_code=400,
                detail={"error_code": "invalid_input", "message": "Upload a single ZIP file or multiple CSV files."},
            )

        csv_files = _find_csv_files(request_dir)
        if not csv_files:
            shutil.rmtree(request_dir, ignore_errors=True)
            raise HTTPException(
                status_code=400,
                detail={"error_code": "missing_required_files", "message": "No Letterboxd CSV files found."},
            )

    except zipfile.BadZipFile:
        shutil.rmtree(request_dir, ignore_errors=True)
        raise HTTPException(status_code=400, detail={"error_code": "corrupt_zip", "message": "Invalid ZIP archive."})
    except HTTPException:
        raise

    detected_username: Optional[str] = None
    for uf in files:
        if uf.filename:
            detected_username = _parse_letterboxd_username(uf.filename)
            if detected_username:
                break

    task_id = task_manager.create_task_state(client_key(request))
    session = request.app.state.aiohttp_session
    asyncio.create_task(_run_analysis(task_id, session, csv_files, request_dir, detected_username))

    task = task_manager.get_task_state(task_id)
    return JSONResponse(status_code=202, content={"task_id": task_id, "poll_token": task.poll_token, "status": "pending"})


@router.post("/api/scrape-profile")
async def scrape_profile(request: Request):
    """
    Scrape a public Letterboxd profile and run the same analysis pipeline.

    When DESKTOP-WORKER mode is enabled (settings.worker_token set), this does
    NOT scrape inline. It queues a job for the outbound desktop worker and
    returns 202 {task_id}; the frontend then polls /api/progress/{task_id}.
    Without a worker token it scrapes synchronously (local dev / fallback).
    """
    enforce_rate_limit(request, "scrape_profile", limit=5, window=600)
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(
            status_code=400,
            detail={"error_code": "invalid_json", "message": "Request body must be valid JSON."},
        )
    raw_username = str(body.get("username") or "").strip()
    username = raw_username.lower()
    if not username or not re.match(r"^[a-z0-9_]+$", username):
        logger.warning("scrape-profile invalid_username: raw=%r sanitized=%r", raw_username, username if username else "<empty>")
        raise HTTPException(
            status_code=400,
            detail={"error_code": "invalid_username", "message": "Please enter a valid Letterboxd username."},
        )
    try:
        analysis_period = normalize_analysis_period(body.get("analysis_period"))
    except ValueError as exc:
        raise HTTPException(
            status_code=400,
            detail={"error_code": "invalid_analysis_period", "message": str(exc)},
        ) from exc

    # Desktop-worker mode: route the heavy scrape to the always-on desktop worker.
    if settings.desktop_worker_enabled:
        await dashboard_settings.load_worker_control_state()
        if task_manager.is_worker_paused():
            logger.warning("scrape-profile desktop_worker_paused for %s", username)
            persist_run(
                username,
                "scrape",
                {},
                ok=False,
                error_message="The desktop scraper was paused; scrape was not attempted.",
                error_type="desktop_worker_paused",
                error_stage="desktop_worker_paused",
            )
            raise HTTPException(
                status_code=503,
                detail={
                    "error_code": "desktop_worker_paused",
                    "message": "The desktop scraper is paused for maintenance. Upload your Letterboxd export for a full Wrapped, or try again shortly.",
                },
            )
        if not task_manager.is_worker_online(settings.worker_heartbeat_max_age_seconds):
            logger.warning("scrape-profile desktop_worker_offline for %s", username)
            # Record the rejected attempt so the dashboard shows offline outages,
            # not just successful/worker-reported runs.
            persist_run(
                username,
                "scrape",
                {},
                ok=False,
                error_message="The desktop scraper was offline; scrape was not attempted.",
                error_type="desktop_worker_offline",
                error_stage="desktop_worker_offline",
            )
            raise HTTPException(
                status_code=503,
                detail={
                    "error_code": "desktop_worker_offline",
                    "message": "The desktop scraper is offline right now. Upload your Letterboxd export for a full Wrapped, or try again shortly.",
                },
            )
        task_id = task_manager.create_scrape_job(
            username,
            owner_key=client_key(request),
            options={"analysis_period": analysis_period},
        )
        logger.info("Queued scrape job %s for @%s", task_id, username)
        task = task_manager.get_task_state(task_id)
        return JSONResponse(status_code=202, content={"task_id": task_id, "poll_token": task.poll_token, "status": "pending"})

    # Synchronous fallback: no desktop worker configured (local dev).
    try:
        stats = await scrape_and_analyze(
            request.app.state.aiohttp_session,
            username,
            analysis_period=analysis_period,
        )
    except ScrapeAnalysisEmpty as exc:
        if exc.period_empty:
            raise HTTPException(
                status_code=400,
                detail={
                    "error_code": "no_films_in_period",
                    "message": f"No diary films found for @{username} in the selected period.",
                },
            )
        if exc.scraper_ok:
            raise HTTPException(
                status_code=500,
                detail={"error_code": "analysis_failed", "message": f"Scraped @{username} but analysis pipeline returned empty. Please try again."},
            )
        raise HTTPException(
            status_code=400,
            detail={"error_code": "no_films", "message": f"No public films found for @{username}. The profile may be private, empty, or temporarily blocked by Letterboxd."},
        )
    except ValueError as exc:
        # Re-raise 404s / 403s / rate-limits from scraper as service-unavailable
        # (not 400/404) so the frontend shows the correct guidance message.
        logger.warning("Scrape blocked/value error for %s: %s", username, exc)
        msg = str(exc)
        if "Letterboxd is blocking" in msg:
            raise HTTPException(
                status_code=503,
                detail={"error_code": "scrape_blocked", "message": msg},
            )
        raise HTTPException(
            status_code=404,
            detail={"error_code": "user_not_found", "message": "Letterboxd profile was not found or could not be read."},
        )
    except Exception as exc:
        logger.exception("Scraping failed for %s: %s", username, exc)
        raise HTTPException(
            status_code=502,
            detail={"error_code": "scrape_failed", "message": f"Letterboxd returned an unexpected response for @{username}. Try again later."},
        )

    persist_run(username, "scrape", stats, ok=True)
    return {"status": "success", "stats": stats}


@router.get("/api/progress/{task_id}")
async def get_task_progress(task_id: str, request: Request):
    """Poll analysis progress and retrieve the final result when done."""
    task = task_manager.get_task_state(task_id)
    if task is None:
        raise HTTPException(
            status_code=404,
            detail={
                "error_code": "task_not_found",
                "message": "Task not found or expired.",
                **task_manager.get_task_not_found_context(),
            },
        )
    enforce_rate_limit(request, "progress", limit=120, window=60)
    supplied = request.headers.get("X-Task-Token", "")
    if not supplied or not secrets.compare_digest(supplied, task.poll_token):
        raise HTTPException(status_code=403, detail={"error_code": "invalid_task_token", "message": "Invalid task token."})
    task_manager.fail_worker_job_if_expired(task)
    return {
        "task_id": task.task_id,
        "status": task.status,
        "stage": task.stage,
        "message": task.message,
        "progress": task.progress,
        "total": task.total,
        "result": task.result,
        "error": task.error,
        "duration_seconds": task.duration_seconds,
        "queue_wait_seconds": task.queue_wait_seconds,
        "worker_seconds": task.worker_seconds,
        "scrape_seconds": task.scrape_seconds,
        "analysis_seconds": task.analysis_seconds,
        "postback_seconds": task.postback_seconds,
        "error_type": task.error_type,
        "error_stage": task.error_stage,
        "error_code": task.error_code,
        "trace_events": task.trace_events,
    }
