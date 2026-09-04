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
from typing import List, Optional

from fastapi import APIRouter, File, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse

from app import task_manager
from app.routes.feedback import _parse_letterboxd_username
from app.services.analysis import process_comprehensive_letterboxd_data
from app.services.run_log import persist_run
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
    return "zip" in lowered or "octet-stream" in lowered


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
        "error_type": task.error_type,
        "error_stage": task.error_stage,
        "error_code": task.error_code,
    }
