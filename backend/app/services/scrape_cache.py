"""24h per-username scrape result cache in Supabase (mw_new).

A cache hit skips the residential scrape. Misses and outages fall through
to a live job. Never raises into the request path.
"""
from __future__ import annotations

import copy
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from app import supabase_ops
from app.config import settings

CACHE_TTL = timedelta(hours=24)
# Full stats blobs are large. This only covers a refresh of a recent username
# on the current Render process. It is not a 100-user store.
_MEMORY_MAX = 8
_memory: dict[tuple[str, str], tuple[datetime, dict[str, Any]]] = {}


def _cache_key(username: str, analysis_period: str) -> Optional[tuple[str, str]]:
    handle = (username or "").strip().lower()
    period = (analysis_period or "lifetime").strip().lower() or "lifetime"
    if not handle:
        return None
    return handle, period


def _memory_get(username: str, analysis_period: str) -> Optional[dict[str, Any]]:
    key = _cache_key(username, analysis_period)
    if key is None:
        return None
    row = _memory.get(key)
    if row is None:
        return None
    expires, stats = row
    if expires <= datetime.now(timezone.utc):
        _memory.pop(key, None)
        return None
    return copy.deepcopy(stats)


def _memory_put(username: str, analysis_period: str, stats: dict[str, Any]) -> None:
    key = _cache_key(username, analysis_period)
    if key is None:
        return
    _memory[key] = (datetime.now(timezone.utc) + CACHE_TTL, copy.deepcopy(stats))
    expired = [item for item, (expires, _) in _memory.items() if expires <= datetime.now(timezone.utc)]
    for item in expired:
        _memory.pop(item, None)
    while len(_memory) > _MEMORY_MAX:
        oldest = min(_memory.items(), key=lambda item: item[1][0])
        _memory.pop(oldest[0], None)


async def lookup_scrape_cache(username: str, analysis_period: str) -> Optional[dict[str, Any]]:
    cached = _memory_get(username, analysis_period)
    if cached is not None:
        return cached
    if not settings.supabase_enabled:
        return None
    handle = (username or "").strip().lower()
    period = (analysis_period or "lifetime").strip().lower() or "lifetime"
    if not handle:
        return None
    now = datetime.now(timezone.utc).isoformat()
    rows = await supabase_ops.select(
        "scrape_result_cache",
        {
            "username": f"eq.{handle}",
            "analysis_period": f"eq.{period}",
            "expires_at": f"gt.{now}",
            "limit": "1",
        },
    )
    if not rows:
        return None
    stats = rows[0].get("stats")
    return stats if isinstance(stats, dict) else None


def store_scrape_cache(username: str, analysis_period: str, stats: dict[str, Any]) -> None:
    if not isinstance(stats, dict):
        return
    _memory_put(username, analysis_period, stats)
    if not settings.supabase_enabled:
        return
    handle = (username or "").strip().lower()
    period = (analysis_period or "lifetime").strip().lower() or "lifetime"
    if not handle:
        return
    now = datetime.now(timezone.utc)
    supabase_ops.fire_and_forget(
        supabase_ops.upsert(
            "scrape_result_cache",
            {
                "username": handle,
                "analysis_period": period,
                "stats": stats,
                "created_at": now.isoformat(),
                "expires_at": (now + CACHE_TTL).isoformat(),
            },
            on_conflict="username,analysis_period",
        )
    )
