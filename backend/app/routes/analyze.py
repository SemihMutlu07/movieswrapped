from __future__ import annotations

import asyncio
import csv
import io
import logging
import os
import re
import shutil
import uuid
import zipfile
import secrets
from pathlib import Path
from typing import Any, List, Optional

from fastapi import APIRouter, File, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse

from app import task_manager
from app.config import settings
from app.routes.feedback import _parse_letterboxd_username
from app.routes.worker import WORKER_OFFLINE_MESSAGE
from app.services.analysis import process_comprehensive_letterboxd_data
from app.services.run_log import persist_run
from app.services.scrape_cache import lookup_scrape_cache, store_scrape_cache
from app.services.scrape_pipeline import (
    ScrapeAnalysisEmpty,
    normalize_analysis_period,
    scrape_and_analyze,
)
from app.services.scraper import classify_letterboxd_error, sources_from_bookmarklet
from app.security import client_key, enforce_rate_limit

logger = logging.getLogger("letterboxd_wrapped.analyze")

router = APIRouter()

_ALLOWED_CSV_NAMES = frozenset({
    "diary.csv", "ratings.csv", "watched.csv", "reviews.csv",
    "watchlist.csv", "comments.csv", "profile.csv",
})
MAX_UPLOAD_BYTES = 50 * 1024 * 1024
MAX_ARCHIVE_BYTES = 200 * 1024 * 1024
MAX_ARCHIVE_ENTRIES = 500
_SKIP_ZIP_PREFIXES = frozenset({"deleted", "orphaned", "likes", "lists", "__macosx"})
_LETTERBOXD_EXPORT_RE = re.compile(r"^letterboxd-.+-utc(?:\.zip)?$", re.IGNORECASE)


def _is_zip_bytes(data: bytes) -> bool:
    return len(data) >= 2 and data[:2] == b"PK"


def _is_zip_content_type(content_type: Optional[str]) -> bool:
    lowered = (content_type or "").lower()
    return "zip" in lowered


def _is_letterboxd_export_name(filename: str) -> bool:
    """Letterboxd downloads are often named letterboxd-user-YYYY-MM-DD-HH-MM-utc (no .zip)."""
    name = Path(filename).name
    lowered = name.lower()
    return (
        lowered.endswith(".zip")
        or lowered.endswith("-utc")
        or bool(_LETTERBOXD_EXPORT_RE.match(name))
    )


def _looks_like_zip_upload(filename: Optional[str], content_type: Optional[str], data: bytes) -> bool:
    if _is_zip_bytes(data):
        return True
    if filename and _is_letterboxd_export_name(filename):
        return True
    return _is_zip_content_type(content_type)


def _zip_path(filename: str) -> Path:
    return Path(filename.replace("\\", "/"))


def _is_skipped_zip_dir(path: Path) -> bool:
    return any(part.lower() in _SKIP_ZIP_PREFIXES for part in path.parts[:-1])


def _zip_entry_priority(path: Path) -> int:
    """Prefer shallower paths so nested export folders still flatten to basename."""
    return len(path.parts)


def _safe_extract_letterboxd_zip(upload: io.BytesIO, request_dir: Path) -> None:
    with zipfile.ZipFile(upload, "r") as zf:
        infos = zf.infolist()
        if len(infos) > MAX_ARCHIVE_ENTRIES:
            raise HTTPException(status_code=413, detail={"error_code": "too_many_files", "message": "Archive contains too many files."})
        chosen: dict[str, zipfile.ZipInfo] = {}
        chosen_priority: dict[str, int] = {}

        for info in infos:
            path = _zip_path(info.filename)
            name = path.name.lower()
            if info.is_dir() or name not in _ALLOWED_CSV_NAMES or _is_skipped_zip_dir(path):
                continue
            mode = info.external_attr >> 16
            if path.is_absolute() or ".." in path.parts or mode & 0o170000 == 0o120000 or info.flag_bits & 0x1:
                raise HTTPException(status_code=400, detail={"error_code": "unsafe_archive", "message": "Archive contains an unsafe entry."})

            priority = _zip_entry_priority(path)
            if name not in chosen or priority < chosen_priority[name]:
                chosen[name] = info
                chosen_priority[name] = priority

        total = 0
        for info in chosen.values():
            total += info.file_size
            if info.file_size > MAX_UPLOAD_BYTES or total > MAX_ARCHIVE_BYTES:
                raise HTTPException(status_code=413, detail={"error_code": "archive_too_large", "message": "Archive expands beyond the allowed size."})

        for name, info in chosen.items():
            written = 0
            with zf.open(info) as source, (request_dir / name).open("wb") as destination:
                while chunk := source.read(1024 * 1024):
                    written += len(chunk)
                    if written > MAX_UPLOAD_BYTES:
                        raise HTTPException(status_code=413, detail={"error_code": "archive_too_large", "message": "Archive file is too large."})
                    destination.write(chunk)


def _find_csv_files(directory: Path) -> dict:
    csv_found: dict[str, tuple[str, int]] = {}
    for root, dirs, files in os.walk(directory):
        dirs[:] = [d for d in dirs if d.lower() not in _SKIP_ZIP_PREFIXES]
        rel = Path(root).relative_to(directory)
        parts = rel.parts if rel != Path(".") else ()
        if any(part.lower() in _SKIP_ZIP_PREFIXES for part in parts):
            continue
        depth = len(parts)
        for file in files:
            name = file.lower()
            if name not in _ALLOWED_CSV_NAMES:
                continue
            path = os.path.join(root, file)
            existing = csv_found.get(name)
            if existing is None or depth < existing[1]:
                csv_found[name] = (path, depth)
                logger.info("[upload-debug] Matched %s → %s", name, path)
    if not csv_found:
        logger.warning("[upload-debug] No matching CSV files in %s. Files found: %s", directory, list(os.walk(directory)))
    return {name: path for name, (path, _depth) in csv_found.items()}


def _username_from_profile(csv_files: dict) -> Optional[str]:
    profile_path = csv_files.get("profile.csv")
    if not profile_path:
        return None
    try:
        with open(profile_path, newline="", encoding="utf-8-sig") as handle:
            row = next(csv.DictReader(handle), None)
    except (OSError, UnicodeError, csv.Error):
        return None
    if not row:
        return None
    username = (row.get("Username") or "").strip()
    return username or None


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
        if len(files) == 1:
            uf = files[0]
            content = await uf.read()
            filename = uf.filename or ""

            if _looks_like_zip_upload(filename, uf.content_type, content):
                _safe_extract_letterboxd_zip(io.BytesIO(content), request_dir)
            elif filename.lower().endswith(".csv"):
                safe_name = Path(filename).name
                written = 0
                with (request_dir / safe_name).open("wb") as destination:
                    destination.write(content)
                    written = len(content)
                if written > MAX_UPLOAD_BYTES:
                    raise HTTPException(status_code=413, detail={"error_code": "archive_too_large", "message": "Upload is too large."})
            else:
                shutil.rmtree(request_dir, ignore_errors=True)
                raise HTTPException(
                    status_code=400,
                    detail={"error_code": "invalid_input", "message": "Upload a Letterboxd export ZIP or CSV files."},
                )
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
                detail={"error_code": "invalid_input", "message": "Upload a Letterboxd export ZIP or CSV files."},
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
    if not detected_username:
        detected_username = _username_from_profile(csv_files)

    task_id = task_manager.create_task_state(client_key(request))
    session = request.app.state.aiohttp_session
    asyncio.create_task(_run_analysis(task_id, session, csv_files, request_dir, detected_username))

    task = task_manager.get_task_state(task_id)
    return JSONResponse(status_code=202, content={"task_id": task_id, "poll_token": task.poll_token, "status": "pending"})


async def _run_scrape(
    task_id: str,
    session,
    username: str,
    analysis_period: str = "lifetime",
    imported=None,
) -> None:
    def _trace(stage: str, message: str, metrics: Optional[dict[str, Any]] = None) -> None:
        task_manager.update_task_progress(task_id, stage, message, metrics=metrics)

    try:
        task_manager.set_task_running(task_id)
        stats = await scrape_and_analyze(
            session,
            username,
            analysis_period=analysis_period,
            trace_callback=_trace,
            task_id=task_id,
            imported=imported,
        )
        task = task_manager.get_task_state(task_id)
        trace_events = task.trace_events if task else None
        store_scrape_cache(username, analysis_period, stats)
        task_manager.set_task_done(task_id, {"status": "success", "stats": stats, "queue_wait_ms": 0})
        persist_run(username, "scrape", stats, ok=True, task_id=task_id, trace_events=trace_events)
    except ScrapeAnalysisEmpty as exc:
        if exc.period_empty:
            error_code = "no_films_in_period"
            msg = f"No diary films found for @{username} in the selected period."
        elif exc.scraper_ok:
            error_code = "analysis_failed"
            msg = f"Scraped @{username} but analysis pipeline returned empty. Please try again."
        else:
            error_code = "no_films"
            msg = f"No public films found for @{username}. The profile may be private, empty, or temporarily blocked by Letterboxd."
        task_manager.set_task_failed(
            task_id,
            msg,
            error_code=error_code,
            error_type=error_code,
            error_stage="scrape",
        )
        task = task_manager.get_task_state(task_id)
        trace_events = task.trace_events if task else None
        persist_run(
            username,
            "scrape",
            {},
            ok=False,
            error_message=msg,
            error_type=error_code,
            error_stage="scrape",
            task_id=task_id,
            trace_events=trace_events,
        )
    except ValueError as exc:
        msg = str(exc)
        error_code = classify_letterboxd_error(exc)
        if error_code == "user_not_found":
            msg = f"Letterboxd profile '@{username}' was not found."
        task_manager.set_task_failed(
            task_id,
            msg,
            error_code=error_code,
            error_type=error_code,
            error_stage="scrape",
        )
        task = task_manager.get_task_state(task_id)
        trace_events = task.trace_events if task else None
        persist_run(
            username,
            "scrape",
            {},
            ok=False,
            error_message=msg,
            error_type=error_code,
            error_stage="scrape",
            task_id=task_id,
            trace_events=trace_events,
        )
    except Exception as exc:
        logger.exception("Scraping failed for %s: %s", username, exc)
        msg = f"Letterboxd returned an unexpected response for @{username}. Try again later."
        task_manager.set_task_failed(
            task_id,
            msg,
            error_code="scrape_failed",
            error_type="scrape_failed",
            error_stage="scrape",
        )
        task = task_manager.get_task_state(task_id)
        trace_events = task.trace_events if task else None
        persist_run(
            username,
            "scrape",
            {},
            ok=False,
            error_message=str(exc),
            error_type="scrape_failed",
            error_stage="scrape",
            task_id=task_id,
            trace_events=trace_events,
        )


@router.post("/api/scrape-profile", status_code=202)
async def scrape_profile(request: Request):
    """
    Scrape a public Letterboxd profile and run the analysis pipeline asynchronously.
    Returns 202 Accepted with a task_id and poll_token for progress polling.
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
    raw_period = body.get("period") or body.get("analysis_period")
    try:
        analysis_period = normalize_analysis_period(raw_period)
    except ValueError as exc:
        raise HTTPException(
            status_code=400,
            detail={"error_code": "invalid_analysis_period", "message": str(exc)},
        ) from exc

    cached_stats = await lookup_scrape_cache(username, analysis_period)
    if cached_stats:
        task_id = task_manager.create_task_state(client_key(request))
        task = task_manager.get_task_state(task_id)
        if task:
            task.kind = "scrape"
            task.username = username
            task.cached = True
            task.options = {"analysis_period": analysis_period, "cached": True}
        task_manager.set_task_done(
            task_id,
            {"status": "success", "stats": cached_stats, "cached": True, "queue_wait_ms": 0},
        )
        return JSONResponse(
            status_code=202,
            content={"task_id": task_id, "poll_token": task.poll_token, "status": "pending", "cached": True},
        )

    if settings.desktop_worker_enabled:
        if not task_manager.is_worker_online(settings.worker_heartbeat_max_age_seconds):
            persist_run(
                username,
                "scrape",
                {},
                ok=False,
                error_message=WORKER_OFFLINE_MESSAGE,
                error_type="desktop_worker_offline",
                error_stage="desktop_worker_offline",
            )
            raise HTTPException(
                status_code=503,
                detail={
                    "error_code": "desktop_worker_offline",
                    "message": WORKER_OFFLINE_MESSAGE,
                },
            )
        task_id = task_manager.create_scrape_job(
            username,
            owner_key=client_key(request),
            options={"analysis_period": analysis_period},
        )
        task = task_manager.get_task_state(task_id)
        return JSONResponse(
            status_code=202,
            content={"task_id": task_id, "poll_token": task.poll_token, "status": "pending"},
        )

    task_id = task_manager.create_task_state(client_key(request))
    session = request.app.state.aiohttp_session
    asyncio.create_task(_run_scrape(task_id, session, username, analysis_period))

    task = task_manager.get_task_state(task_id)
    return JSONResponse(
        status_code=202,
        content={"task_id": task_id, "poll_token": task.poll_token, "status": "pending"},
    )


MAX_IMPORT_ITEMS = 20_000


@router.post("/api/import-scrape", status_code=202)
async def import_scrape(request: Request):
    """Analyze bookmarklet JSON (films + diary) without hitting Letterboxd HTML."""
    enforce_rate_limit(request, "import_scrape", limit=5, window=600)
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(
            status_code=400,
            detail={"error_code": "invalid_json", "message": "Request body must be valid JSON."},
        )
    data = body.get("data") if isinstance(body.get("data"), dict) else body
    raw_username = str((data or {}).get("user") or body.get("username") or "").strip()
    username = raw_username.lower()
    if not username or not re.match(r"^[a-z0-9_]+$", username):
        raise HTTPException(
            status_code=400,
            detail={"error_code": "invalid_username", "message": "Please enter a valid Letterboxd username."},
        )
    films = data.get("films") if isinstance(data.get("films"), list) else []
    diary = data.get("diary") if isinstance(data.get("diary"), list) else []
    if len(films) + len(diary) > MAX_IMPORT_ITEMS:
        raise HTTPException(
            status_code=413,
            detail={"error_code": "payload_too_large", "message": "Import contains too many items."},
        )
    if not films and not diary:
        raise HTTPException(
            status_code=400,
            detail={"error_code": "no_films", "message": "Import JSON has no films or diary entries."},
        )
    raw_period = body.get("period") or body.get("analysis_period")
    try:
        analysis_period = normalize_analysis_period(raw_period)
    except ValueError as exc:
        raise HTTPException(
            status_code=400,
            detail={"error_code": "invalid_analysis_period", "message": str(exc)},
        ) from exc

    imported = sources_from_bookmarklet({"films": films, "diary": diary})
    task_id = task_manager.create_task_state(client_key(request))
    session = request.app.state.aiohttp_session
    asyncio.create_task(
        _run_scrape(task_id, session, username, analysis_period, imported=imported)
    )
    task = task_manager.get_task_state(task_id)
    return JSONResponse(
        status_code=202,
        content={"task_id": task_id, "poll_token": task.poll_token, "status": "pending"},
    )


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
    queue = task_manager.scrape_queue_metrics(task)
    result = task.result
    if isinstance(result, dict) and task.kind == "scrape" and queue.get("queue_wait_ms") is not None:
        result = {**result, "queue_wait_ms": queue["queue_wait_ms"]}
    return {
        "task_id": task.task_id,
        "status": task.status,
        "stage": task.stage,
        "message": task.message,
        "progress": task.progress,
        "total": task.total,
        "result": result,
        "error": task.error,
        "duration_seconds": task.duration_seconds,
        "error_type": task.error_type,
        "error_stage": task.error_stage,
        "error_code": task.error_code,
        "trace_events": task.trace_events,
        "cached": task.cached,
        **queue,
    }
