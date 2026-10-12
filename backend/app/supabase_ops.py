"""Tiny best-effort wrappers around the Supabase REST API (anon key only).

All three calls swallow errors (insert/upsert are no-ops, select returns [])
so a Supabase outage never breaks the request path or the dashboard. Callers
pre-trim rows. Auth headers are fixed once at client construction instead of
being merged into every individual request.
"""
from __future__ import annotations

import asyncio
import logging
import time
from typing import Any, Coroutine

import httpx

from app.config import settings

logger = logging.getLogger("letterboxd_wrapped.supabase_ops")

_background_tasks: set[asyncio.Task] = set()
_access_token: str | None = None
_access_token_expires_at = 0.0
_auth_lock = asyncio.Lock()


async def _auth_headers() -> dict[str, str]:
    global _access_token, _access_token_expires_at
    if not settings.supabase_enabled:
        raise RuntimeError("Supabase ops credentials are not configured")
    async with _auth_lock:
        if not _access_token or time.monotonic() >= _access_token_expires_at:
            async with httpx.AsyncClient(timeout=5.0) as client:
                response = await client.post(
                    f"{settings.supabase_url}/auth/v1/token",
                    params={"grant_type": "password"},
                    headers={"apikey": settings.supabase_anon_key},
                    json={"email": settings.supabase_ops_email, "password": settings.supabase_ops_password},
                )
                response.raise_for_status()
                payload = response.json()
                _access_token = payload["access_token"]
                _access_token_expires_at = time.monotonic() + max(30, int(payload.get("expires_in", 3600)) - 60)
    return {
        "apikey": settings.supabase_anon_key,
        "Authorization": f"Bearer {_access_token}",
    }


async def _client() -> httpx.AsyncClient:
    return httpx.AsyncClient(headers=await _auth_headers(), timeout=5.0)


def fire_and_forget(coro: Coroutine[Any, Any, Any]) -> None:
    """Schedule a best-effort coroutine without blocking the caller.

    Keeps a reference to the task so it isn't garbage-collected mid-flight
    (a documented asyncio pitfall). Falls back to a blocking run when there's
    no running event loop (e.g. called from a sync test).
    """
    try:
        task = asyncio.get_running_loop().create_task(coro)
    except RuntimeError:
        asyncio.run(coro)
        return
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)


async def insert(table: str, row: dict[str, Any]) -> None:
    """Best-effort POST one row to `table`. No-op on any error."""
    try:
        async with await _client() as client:
            await client.post(
                f"{settings.supabase_url}/rest/v1/{table}",
                headers={"Prefer": "return=minimal"},
                json=row,
            )
    except Exception as exc:
        logger.warning("Failed to mirror row to %s: %s", table, exc)


async def select(table: str, params: dict[str, str]) -> list[dict[str, Any]]:
    """Best-effort GET rows from `table`. Returns [] on any error."""
    try:
        async with await _client() as client:
            resp = await client.get(f"{settings.supabase_url}/rest/v1/{table}", params=params)
            resp.raise_for_status()
            return resp.json()
    except Exception as exc:
        logger.warning("Failed to load rows from %s: %s", table, exc)
        return []


async def upsert(table: str, row: dict[str, Any], *, on_conflict: str) -> bool:
    """Best-effort UPSERT one row to `table`. Returns False on any error."""
    try:
        async with await _client() as client:
            resp = await client.post(
                f"{settings.supabase_url}/rest/v1/{table}",
                headers={"Prefer": "resolution=merge-duplicates,return=minimal"},
                params={"on_conflict": on_conflict},
                json=row,
            )
            resp.raise_for_status()
            return True
    except Exception as exc:
        logger.warning("Failed to upsert row to %s: %s", table, exc)
        return False


# Tables the backend actually writes to via insert/upsert/select above.
# Migrations (backend/migrations/*.sql) are applied by hand in the Supabase
# dashboard, so nothing guarantees a given environment has all of them —
# this is a best-effort tripwire, not a migration runner.
EXPECTED_OPS_TABLES = (
    "ops_runs",
    "ops_watchlist_runs",
    "ops_date_night_runs",
    "ops_worker_events",
    "ops_workers",
    "ops_dashboard_settings",
    "ops_tasks",
    "scrape_result_cache",
)


async def check_expected_schema() -> None:
    """Log a warning at startup if an expected ops table is missing from the
    Supabase schema. Best-effort only: never raises, so a Supabase outage or
    auth failure here must not block backend startup."""
    if not settings.supabase_enabled:
        return
    try:
        async with await _client() as client:
            resp = await client.get(f"{settings.supabase_url}/rest/v1/")
            resp.raise_for_status()
            known_tables = set(resp.json().get("definitions", {}).keys())
    except Exception as exc:
        logger.warning("Could not verify Supabase schema at startup: %s", exc)
        return
    missing = [t for t in EXPECTED_OPS_TABLES if t not in known_tables]
    if missing:
        # ops_workers is load-bearing for health tracking — its absence must
        # be loud. Other ops tables stay a warning (some envs pre-date them).
        if "ops_workers" in missing:
            logger.error(
                "CRITICAL: ops_workers table is MISSING from Supabase — worker "
                "heartbeats and /api/health/workers will silently fail. Run "
                "backend/migrations/007_ops_workers.sql in the Supabase SQL Editor.",
            )
        if "ops_tasks" in missing:
            logger.error(
                "CRITICAL: ops_tasks table is MISSING from Supabase — scrape "
                "jobs will not survive a Render restart. Run "
                "backend/migrations/006_ops_tasks.sql and 012_scrape_queue_cache_handshake.sql.",
            )
        if "scrape_result_cache" in missing:
            logger.warning(
                "scrape_result_cache is missing — 24h username cache is off. "
                "Run backend/migrations/012_scrape_queue_cache_handshake.sql.",
            )
        logger.warning(
            "Supabase schema is missing expected ops table(s) %s — check that "
            "all backend/migrations/*.sql have been run against this project.",
            missing,
        )
    else:
        logger.info("Supabase ops schema check passed (%d tables present).", len(EXPECTED_OPS_TABLES))


async def delete_before(table: str, cutoff_iso: str) -> None:
    """Best-effort retention cleanup for backend-owned ops tables."""
    try:
        async with await _client() as client:
            response = await client.delete(
                f"{settings.supabase_url}/rest/v1/{table}", params={"created_at": f"lt.{cutoff_iso}"}
            )
            response.raise_for_status()
    except Exception as exc:
        logger.warning("Failed retention cleanup for %s: %s", table, exc)
