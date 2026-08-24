from __future__ import annotations

import copy
import asyncio
import json
import logging
import re
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Optional

from app import supabase_ops
from app.config import settings

logger = logging.getLogger("letterboxd_wrapped.run_log")

RUNS_DIR = Path("runs")

# Bulky fields kept in the local file but stripped before mirroring to Supabase.
# trace_events is lightweight (list of small dicts) and needed by the admin dashboard.
_HEAVY_KEYS = ("stats",)


async def cleanup_expired_runs() -> None:
    cutoff = datetime.now(timezone.utc) - timedelta(days=max(1, settings.run_retention_days))
    for directory in (RUNS_DIR, Path("watchlist_runs"), Path("date_night_runs")):
        if directory.exists():
            for path in directory.glob("*.json"):
                try:
                    if datetime.fromtimestamp(path.stat().st_mtime, timezone.utc) < cutoff:
                        path.unlink()
                except OSError as exc:
                    logger.warning("Failed retention cleanup for %s: %s", path, exc)
    if settings.supabase_enabled:
        cutoff_iso = cutoff.isoformat()
        await asyncio.gather(*(supabase_ops.delete_before(table, cutoff_iso) for table in (
            "ops_runs", "ops_watchlist_runs", "ops_date_night_runs", "ops_worker_events"
        )))


def _remote_payload(payload: dict[str, Any]) -> dict[str, Any]:
    """Trim bulky fields before mirroring; the dashboard list only needs scalars."""
    return {k: v for k, v in payload.items() if k not in _HEAVY_KEYS}


async def _mirror_to_supabase(payload: dict[str, Any]) -> None:
    """Best-effort copy of the run log to Supabase ops_runs so the admin dashboard
    survives Render restarts (local runs/ is ephemeral there). No-op without env."""
    await supabase_ops.insert("ops_runs", {
        "username": payload.get("username"),
        "ok": payload.get("ok"),
        "total_films": payload.get("total_films"),
        "task_id": payload.get("task_id"),
        "job_type": payload.get("job_type"),
        "source": payload.get("source"),
        "error_code": payload.get("error_code"),
        "duration_ms": payload.get("duration_ms"),
        "worker_id": payload.get("worker_id"),
        "payload": _remote_payload(payload),
    })

TIMING_FIELDS = (
    "duration_seconds",
    "queue_wait_seconds",
    "worker_seconds",
    "scrape_seconds",
    "analysis_seconds",
    "postback_seconds",
)

# Per-job TMDB telemetry aggregate fields mirrored into the run record.
TMDB_TELEMETRY_FIELDS = (
    "tmdb_match_seconds",
    "tmdb_metadata_seconds",
    "local_statistics_seconds",
    "cache_hits",
    "cache_misses",
    "outbound_requests",
    "empty_results",
    "network_errors",
    "retries",
    "tmdb_429s",
)


def _flatten_tmdb_telemetry(tmdb: Optional[dict[str, Any]]) -> dict[str, Any]:
    """Flatten the nested TMDB snapshot into scalar run-record fields.

    Only the whitelisted integer/timing keys are copied; endpoint-family
    breakdown stays under the nested ``tmdb`` key. Unknown/None values are
    omitted so old runs keep their exact shape.
    """
    if not isinstance(tmdb, dict):
        return {}
    flat: dict[str, Any] = {}
    for field in TMDB_TELEMETRY_FIELDS:
        value = tmdb.get(field)
        if value is not None:
            flat[field] = value
    return flat


def _safe_username(username: Optional[str]) -> str:
    return re.sub(r"[^a-z0-9_-]", "_", (username or "anon").lower()) or "anon"


def _job_type_for_source(source: str) -> Optional[str]:
    """Map a persist_run source to the ops_runs.job_type column value.

    Desktop-worker runs carry job_type in telemetry (scrape/watchlist/etc.);
    inline backend runs derive it from their source string. Unknown sources
    stay NULL — the column is nullable and Phase 2 taxonomy may refine this.
    """
    return {
        "upload": "analyze",
        "scrape": "scrape",
        "desktop-worker": None,  # telemetry carries the real job_type
    }.get(source)


def _redact_third_party_likers(stats: dict[str, Any]) -> dict[str, Any]:
    """Deep-copy stats and drop liker identities before writing to disk.

    Liker names/avatars belong to third parties and must not land in the
    durable run log. Aggregate signals (like_count, likers_complete) are kept.
    The task result returned to the requesting user is left untouched.
    """
    redacted = copy.deepcopy(stats)
    review_analysis = redacted.get("review_analysis")
    if isinstance(review_analysis, dict):
        for key in ("reviews", "top_liked_reviews"):
            for review in review_analysis.get(key, []) or []:
                if isinstance(review, dict) and "likers" in review:
                    review["likers"] = []
    return redacted


def persist_run(
    username: Optional[str],
    source: str,
    stats: Optional[dict[str, Any]],
    ok: bool = True,
    error_message: Optional[str] = None,
    *,
    duration_seconds: Optional[float] = None,
    queue_wait_seconds: Optional[float] = None,
    worker_seconds: Optional[float] = None,
    scrape_seconds: Optional[float] = None,
    analysis_seconds: Optional[float] = None,
    postback_seconds: Optional[float] = None,
    error_type: Optional[str] = None,
    error_stage: Optional[str] = None,
    task_id: Optional[str] = None,
    trace_events: Optional[list[dict[str, Any]]] = None,
    telemetry: Optional[dict[str, Any]] = None,
    tmdb: Optional[dict[str, Any]] = None,
) -> Optional[Path]:
    """Best-effort run log under runs/{username}-{iso-ts}-{task}.json."""
    try:
        stats = _redact_third_party_likers(stats or {})
        telemetry = telemetry or {}
        RUNS_DIR.mkdir(parents=True, exist_ok=True)

        safe_user = _safe_username(username)
        ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H-%M-%SZ")
        suffix = (task_id or str(uuid.uuid4()))[:8]
        path = RUNS_DIR / f"{safe_user}-{ts}-{suffix}.json"

        payload: dict[str, Any] = {
            "task_id": task_id,
            "username": username,
            "source": source,
            "job_type": telemetry.get("job_type") or _job_type_for_source(source),
            "worker_id": telemetry.get("worker_id"),
            "timestamp": ts,
            "ok": ok,
            "error_message": error_message,
            "error_type": error_type,
            "error_stage": error_stage,
            "error_code": telemetry.get("error_code"),
            "total_films": stats.get("total_films"),
            "sinefil_meter": stats.get("sinefil_meter"),
            "stats": stats,
            "trace_events": trace_events or [],
        }
        explicit_timings = {
            "duration_seconds": duration_seconds,
            "queue_wait_seconds": queue_wait_seconds,
            "worker_seconds": worker_seconds,
            "scrape_seconds": scrape_seconds,
            "analysis_seconds": analysis_seconds,
            "postback_seconds": postback_seconds,
        }
        for field in TIMING_FIELDS:
            value = explicit_timings.get(field)
            payload[field] = telemetry.get(field, value)

        # Per-job TMDB telemetry: flattened scalar fields + the full nested
        # snapshot (with endpoint-family breakdown) under "tmdb". Omitted
        # entirely for old workers that never sent it (backward compatible).
        tmdb_payload = tmdb if isinstance(tmdb, dict) else None
        if tmdb_payload is None and isinstance(telemetry.get("tmdb"), dict):
            tmdb_payload = telemetry["tmdb"]
        if tmdb_payload is not None:
            payload.update(_flatten_tmdb_telemetry(tmdb_payload))
            if "by_endpoint_family" in tmdb_payload:
                payload["tmdb"] = tmdb_payload

        # ms variant for the ops_runs.duration_ms column (nullable; NULL when unknown).
        duration_seconds_value = payload.get("duration_seconds")
        if isinstance(duration_seconds_value, (int, float)):
            payload["duration_ms"] = round(duration_seconds_value * 1000)

        if not payload.get("error_type"):
            payload["error_type"] = telemetry.get("error_type")
        if not payload.get("error_stage"):
            payload["error_stage"] = telemetry.get("error_stage")

        path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        logger.info(
            "Persisted run: %s (source=%s, ok=%s, films=%s)",
            path,
            source,
            ok,
            payload["total_films"],
        )
        # Durable mirror so the admin dashboard survives Render restarts. Fired
        # off in the background so the network call never blocks the caller.
        if settings.supabase_enabled:
            supabase_ops.fire_and_forget(_mirror_to_supabase(payload))
        return path
    except Exception as exc:
        logger.warning("Failed to persist run for %s: %s", username, exc)
        return None
