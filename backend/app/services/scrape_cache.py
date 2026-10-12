"""24h per-username scrape result cache in Supabase (mw_new).

A cache hit skips the residential scrape. Misses and outages fall through
to a live job. Never raises into the request path.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from app import supabase_ops
from app.config import settings

CACHE_TTL = timedelta(hours=24)


async def lookup_scrape_cache(username: str, analysis_period: str) -> Optional[dict[str, Any]]:
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
    if not settings.supabase_enabled or not isinstance(stats, dict):
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
