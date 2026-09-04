"""
Admin dashboard for MoviesWrapped.
Reads from backend/runs/ JSON logs (or Supabase ops_runs when configured).
Auth: signed HttpOnly session cookie for browsers; Bearer secret for automation.
ADMIN_SECRET env var is mandatory — no hardcoded default.
"""
from __future__ import annotations

import json
import hashlib
import hmac
import secrets
import time
import logging
import os
from datetime import datetime
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.templating import Jinja2Templates

from app import supabase_ops
from app.config import settings
from app.services.run_log import RUNS_DIR

logger = logging.getLogger("letterboxd_wrapped.admin")

router = APIRouter()
templates = Jinja2Templates(directory="app/templates")


def _admin_secret() -> str:
    secret = os.environ.get("ADMIN_SECRET")
    if not secret:
        raise HTTPException(
            status_code=503,
            detail={
                "error_code": "admin_not_configured",
                "message": "Admin dashboard is not configured on this server.",
            },
        )
    return secret


ANALYSIS_RUNS_LIMIT = 100


def _clamp_analysis_limit(limit: int) -> int:
    return max(1, min(limit, ANALYSIS_RUNS_LIMIT))


def _num(value: Any) -> float | None:
    return value if isinstance(value, (int, float)) else None


def _annotate_analysis_run(data: dict[str, Any]) -> None:
    timings = {
        "analysis": _num(data.get("analysis_seconds")),
    }
    known_timings = {key: value for key, value in timings.items() if value is not None}
    if known_timings:
        bottleneck, seconds = max(known_timings.items(), key=lambda item: item[1])
        data["bottleneck_stage"] = bottleneck
        data["bottleneck_seconds"] = round(seconds, 1)
    else:
        data["bottleneck_stage"] = None
        data["bottleneck_seconds"] = None

    total_films = _num(data.get("total_films"))
    duration = _num(data.get("duration_seconds"))
    analysis = _num(data.get("analysis_seconds"))
    if total_films and total_films > 0:
        if duration is not None:
            data["duration_seconds_per_film"] = round(duration / total_films, 3)
        if analysis is not None:
            data["analysis_seconds_per_film"] = round(analysis / total_films, 3)


def _require_admin(request: Request) -> None:
    secret = _admin_secret()
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        if secrets.compare_digest(auth_header[7:], secret):
            return
    if _valid_session(request.cookies.get("mw_admin_session", ""), secret):
        if request.method not in {"GET", "HEAD", "OPTIONS"}:
            origin = request.headers.get("origin", "")
            expected = f"{request.url.scheme}://{request.url.netloc}"
            if not origin or not secrets.compare_digest(origin, expected):
                raise HTTPException(status_code=403, detail="Invalid request origin")
        return
    if secrets.compare_digest(request.headers.get("x-admin-key", ""), secret):
        return
    raise HTTPException(status_code=403, detail="Forbidden")


def _session_value(secret: str) -> str:
    expires = str(int(time.time()) + 8 * 60 * 60)
    signature = hmac.new(secret.encode(), expires.encode(), hashlib.sha256).hexdigest()
    return f"{expires}.{signature}"


def _valid_session(value: str, secret: str) -> bool:
    try:
        expires, signature = value.split(".", 1)
        if int(expires) < int(time.time()):
            return False
    except (ValueError, TypeError):
        return False
    expected = hmac.new(secret.encode(), expires.encode(), hashlib.sha256).hexdigest()
    return secrets.compare_digest(signature, expected)


def _load_json_dir(directory: Path, limit: int = 100) -> list[dict[str, Any]]:
    if not directory.exists():
        return []
    files = sorted(directory.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True)
    items: list[dict[str, Any]] = []
    for f in files[:limit]:
        try:
            data = json.loads(f.read_text())
            stat = f.stat()
            data["_filename"] = f.name
            data["_mtime"] = datetime.fromtimestamp(stat.st_mtime).isoformat()
            data["_size_kb"] = round(stat.st_size / 1024, 1)
            if directory == RUNS_DIR:
                _annotate_analysis_run(data)
            items.append(data)
        except Exception as exc:
            logger.warning("Failed to parse %s: %s", f.name, exc)
    return items


def _incident(
    incident_type: str,
    message: str,
    *,
    created_at: Any = None,
    source: str = "backend",
    severity: str = "error",
    detail: Any = None,
) -> dict[str, Any]:
    return {
        "type": incident_type,
        "message": message,
        "created_at": created_at,
        "source": source,
        "severity": severity,
        "detail": detail,
    }


async def _load_operational_incidents(limit: int = 50) -> list[dict[str, Any]]:
    """Build a safe incident feed from durable events and frontend reports."""
    incidents: list[dict[str, Any]] = []

    if settings.supabase_enabled:
        rows = await supabase_ops.select(
            "ops_worker_events",
            {"select": "created_at,event_type,meta", "order": "created_at.desc", "limit": str(limit)},
        )
        for row in rows:
            meta = row.get("meta") if isinstance(row.get("meta"), dict) else {}
            event_type = str(row.get("event_type") or "operational_event")
            message = str(meta.get("message") or event_type.replace("_", " ").capitalize())
            detail = meta.get("path") or meta.get("reason") or meta.get("error_type")
            incidents.append(
                _incident(
                    event_type,
                    message,
                    created_at=row.get("created_at"),
                    source=str(meta.get("source") or "backend"),
                    severity=str(meta.get("severity") or ("info" if event_type == "online" else "error")),
                    detail=detail,
                )
            )

    reports_dir = Path("uploads") / "reports"
    if reports_dir.exists():
        for path in sorted(reports_dir.glob("*.meta.json"), key=lambda item: item.stat().st_mtime, reverse=True)[:limit]:
            try:
                meta = json.loads(path.read_text(encoding="utf-8"))
                incidents.append(
                    _incident(
                        "frontend_report",
                        "Frontend diagnostic report received",
                        created_at=meta.get("received_at"),
                        source="frontend",
                        severity="warning",
                        detail=meta.get("issue_id"),
                    )
                )
            except Exception as exc:
                logger.warning("Failed to parse report metadata %s: %s", path.name, exc)

    return incidents[:limit]


def _group_runs_by_username(runs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    groups: list[dict[str, Any]] = []
    index: dict[str, dict[str, Any]] = {}
    for run in runs:
        raw = (run.get("username") or "").strip()
        key = raw.casefold() if raw else None
        group = index.get(key) if key is not None else None
        if group is None:
            group = {
                "username": raw or None,
                "run_count": 0,
                "success_count": 0,
                "fail_count": 0,
                "latest": run,
                "children": [],
            }
            groups.append(group)
            if key is not None:
                index[key] = group
        group["run_count"] += 1
        if run.get("ok") is True:
            group["success_count"] += 1
        elif run.get("ok") is False:
            group["fail_count"] += 1
        group["children"].append(run)
    return groups


async def _load_runs_supabase(limit: int = 50) -> list[dict[str, Any]]:
    rows = await supabase_ops.select(
        "ops_runs", {"select": "id,created_at,payload", "order": "created_at.desc", "limit": str(limit)}
    )
    items: list[dict[str, Any]] = []
    for row in rows:
        data = row.get("payload")
        if not isinstance(data, dict):
            continue
        data["_mtime"] = row.get("created_at")
        data["_filename"] = row.get("id")
        _annotate_analysis_run(data)
        items.append(data)
    return items


async def _load_run_supabase(run_id: str) -> dict[str, Any] | None:
    rows = await supabase_ops.select(
        "ops_runs", {"id": f"eq.{run_id}", "select": "created_at,payload", "limit": "1"}
    )
    if not rows:
        return None
    data = rows[0].get("payload")
    if not isinstance(data, dict):
        return None
    data["_mtime"] = rows[0].get("created_at")
    _annotate_analysis_run(data)
    return data


async def _load_analysis_runs(limit: int = ANALYSIS_RUNS_LIMIT) -> list[dict[str, Any]]:
    limit = _clamp_analysis_limit(limit)
    if settings.supabase_enabled:
        return await _load_runs_supabase(limit)
    return _load_json_dir(RUNS_DIR, limit=limit)


@router.get("/admin", response_class=HTMLResponse)
async def admin_login(request: Request):
    return templates.TemplateResponse("admin_login.html", {"request": request})


@router.post("/admin/session")
async def admin_session(request: Request):
    form = await request.form()
    secret = _admin_secret()
    if not secrets.compare_digest(str(form.get("key") or ""), secret):
        raise HTTPException(status_code=403, detail="Forbidden")
    response = RedirectResponse("/admin/dashboard", status_code=303)
    response.set_cookie("mw_admin_session", _session_value(secret), max_age=28800, httponly=True, secure=request.url.scheme == "https", samesite="strict", path="/admin")
    return response


async def _admin_page_guard(request: Request) -> HTMLResponse | None:
    _admin_secret()
    if "key" in request.query_params:
        return RedirectResponse(request.url.path, status_code=303)
    try:
        _require_admin(request)
    except HTTPException as exc:
        if exc.status_code != 403:
            raise
        return templates.TemplateResponse("admin_login.html", {"request": request})
    return None


@router.get("/admin/dashboard", response_class=HTMLResponse)
async def admin_dashboard(request: Request, limit: int = ANALYSIS_RUNS_LIMIT):
    guard = await _admin_page_guard(request)
    if guard is not None:
        return guard
    runs = await _load_analysis_runs(limit=limit)
    incidents = await _load_operational_incidents()
    return templates.TemplateResponse(
        "admin_overview.html",
        {
            "request": request,
            "runs_count": len(runs),
            "incidents": incidents,
            "active_page": "dashboard",
            "key": "",
        },
    )


@router.get("/admin/analysis", response_class=HTMLResponse)
async def admin_analysis(request: Request, limit: int = ANALYSIS_RUNS_LIMIT):
    guard = await _admin_page_guard(request)
    if guard is not None:
        return guard
    runs = await _load_analysis_runs(limit=limit)
    return templates.TemplateResponse(
        "admin_analysis.html",
        {
            "request": request,
            "runs": runs,
            "run_groups": _group_runs_by_username(runs),
            "active_page": "analysis",
            "key": "",
        },
    )


@router.get("/admin/run/{filename}", response_class=HTMLResponse)
async def admin_run_detail(request: Request, filename: str):
    _require_admin(request)
    safe_name = Path(filename).name
    if settings.supabase_enabled:
        data = await _load_run_supabase(safe_name)
        if data is None:
            raise HTTPException(status_code=404, detail="Run not found")
    else:
        path = RUNS_DIR / safe_name
        if not path.exists():
            raise HTTPException(status_code=404, detail="Run not found")
        data = json.loads(path.read_text())
    return templates.TemplateResponse(
        "admin_run.html",
        {"request": request, "run": data, "filename": safe_name, "key": ""},
    )


@router.get("/admin/api/runs")
async def admin_api_runs(request: Request, limit: int = ANALYSIS_RUNS_LIMIT):
    _require_admin(request)
    runs = await _load_analysis_runs(limit)
    return {
        "runs": runs,
        "run_groups": _group_runs_by_username(runs),
    }
