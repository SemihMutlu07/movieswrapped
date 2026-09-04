from __future__ import annotations

import json
import re
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile

from app import supabase_ops
from app.config import settings

router = APIRouter()

MAX_UPLOAD_BYTES = 5 * 1024 * 1024  # 5 MB
_RATE_LIMIT_WINDOW = 600  # 10 minutes
_RATE_LIMIT_MAX = 3
_rate_limiter: dict[str, list[float]] = {}


def _parse_letterboxd_username(filename: str) -> Optional[str]:
    base = filename.replace("\\", "/").split("/")[-1].strip().lower()
    stem = re.sub(r"\.(?:csv|zip)$", "", base, flags=re.IGNORECASE)

    def valid(username: str | None) -> Optional[str]:
        candidate = (username or "").strip().lower()
        return candidate if re.fullmatch(r"[a-z0-9_]+", candidate) else None

    patterns = [
        # letterboxd-USER-YYYY-MM-DD-HH-MM-utc
        r"^letterboxd-(?P<username>[a-z0-9_]+)-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-utc$",
        # letterboxd-USER-YYYY-MM-DD
        r"^letterboxd-(?P<username>[a-z0-9_]+)-\d{4}-\d{2}-\d{2}$",
        # letterboxd-USER-YYYY
        r"^letterboxd-(?P<username>[a-z0-9_]+)-\d{4}$",
        # letterboxd-USER-utc
        r"^letterboxd-(?P<username>[a-z0-9_]+)-utc$",
        # Letterboxd_USER_Export_2024
        r"^letterboxd_(?P<username>[a-z0-9_]+)_export(?:_\d{4})?$",
        # letterboxd-USER
        r"^letterboxd-(?P<username>[a-z0-9_]+)$",
    ]

    for pattern in patterns:
        match = re.match(pattern, stem, re.IGNORECASE)
        parsed = valid(match.group("username") if match else None)
        if parsed:
            return parsed

    # Folder uploads often pass the export directory name instead of a file.
    folder_export = re.match(r"^letterboxd_(?P<username>[a-z0-9_]+)_export(?:_\d{4})?$", stem, re.IGNORECASE)
    if folder_export:
        return valid(folder_export.group("username"))

    return None


def _client_key(request: Request) -> str:
    xfwd = request.headers.get("x-forwarded-for")
    if xfwd:
        return xfwd.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def _check_rate_limit(client_key: str) -> bool:
    now = time.time()
    cutoff = now - _RATE_LIMIT_WINDOW
    events = [t for t in _rate_limiter.get(client_key, []) if t >= cutoff]
    if len(events) >= _RATE_LIMIT_MAX:
        return False
    events.append(now)
    _rate_limiter[client_key] = events
    return True


@router.post("/api/parse-username")
async def parse_username(request: Request):
    """Parse a Letterboxd username from an export filename."""
    try:
        body = await request.json()
        filename = body.get("filename")
        if not filename or not isinstance(filename, str):
            return {"username": None}

        return {"username": _parse_letterboxd_username(filename)}
    except Exception:
        return {"username": None}


@router.post("/api/feedback")
async def submit_feedback(
    request: Request,
    sessionId: str = Form(...),
    kind: str = Form("general"),
    message: str = Form(""),
    include_names: bool = Form(False),
    attachment: Optional[UploadFile] = File(None),
):
    if not _check_rate_limit(_client_key(request)):
        raise HTTPException(status_code=429, detail="Rate limit exceeded. Try again later.")

    attachment_bytes: Optional[bytes] = None
    if attachment is not None:
        chunked = await attachment.read()
        if len(chunked) > MAX_UPLOAD_BYTES:
            raise HTTPException(status_code=413, detail="Attachment too large (max 5 MB)")
        attachment_bytes = chunked

    reports_dir = Path("uploads") / "reports"
    reports_dir.mkdir(parents=True, exist_ok=True)
    issue_id = str(uuid.uuid4())[:8]

    payload = {
        "issue_id": issue_id,
        "sessionId": sessionId,
        "kind": kind,
        "message": message[:4000],
        "include_names": include_names,
        "received_at": datetime.now(timezone.utc).isoformat(),
        "client": _client_key(request),
    }
    (reports_dir / f"feedback-{issue_id}.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    if attachment_bytes is not None:
        (reports_dir / f"feedback-{issue_id}.bin").write_bytes(attachment_bytes)

    return {"ok": True, "issue_id": issue_id}


@router.post("/api/report")
async def submit_report(
    request: Request,
    sessionId: str = Form(...),
    include_names: bool = Form(False),
    bundle: UploadFile = File(...),
):
    if not _check_rate_limit(_client_key(request)):
        raise HTTPException(status_code=429, detail="Rate limit exceeded. Try again later.")

    data = await bundle.read()
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Bundle too large (max 5 MB)")

    reports_dir = Path("uploads") / "reports"
    reports_dir.mkdir(parents=True, exist_ok=True)
    issue_id = str(uuid.uuid4())[:8]

    payload = {
        "issue_id": issue_id,
        "sessionId": sessionId,
        "include_names": include_names,
        "received_at": datetime.now(timezone.utc).isoformat(),
        "client": _client_key(request),
    }
    (reports_dir / f"report-{issue_id}.meta.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (reports_dir / f"report-{issue_id}.bin").write_bytes(data)

    if settings.supabase_enabled:
        await supabase_ops.insert("ops_worker_events", {
            "event_type": "frontend_report",
            "meta": {
                "source": "frontend",
                "severity": "warning",
                "message": "Frontend diagnostic report received",
                "issue_id": issue_id,
            },
        })

    return {"ok": True, "issue_id": issue_id}
