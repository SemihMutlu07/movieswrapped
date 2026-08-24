"""Letterboxd RSS incremental probe (PR-B).

Reads a profile's public RSS feed and returns the latest watchedDate plus an
item count — the cheap "has anything changed since last scrape?" check from the
final decision report (RSS incremental preview: SHIP).

Bounded and read-only: one GET, no login, no pagination, nothing persisted.
The worker poll loop can call this before a full re-scrape to short-circuit
returning users whose feed is unchanged.
"""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from typing import Optional

import aiohttp

logger = logging.getLogger("letterboxd_wrapped.rss_probe")

_FEED_URL = "https://letterboxd.com/{username}/rss/"
_WATCHED_DATE_RE = re.compile(r"<letterboxd:watchedDate>([^<]+)</letterboxd:watchedDate>")
_ITEM_RE = re.compile(r"<item>")


@dataclass(frozen=True)
class RssProbeResult:
    username: str
    ok: bool
    item_count: int = 0
    latest_watched_date: Optional[str] = None  # ISO date string, or None on failure


async def probe_rss(session: aiohttp.ClientSession, username: str, *, timeout_s: int = 20) -> RssProbeResult:
    """Fetch {username}'s public RSS feed and summarize it.

    Never raises: any failure returns ok=False so callers can fall back to the
    normal full scrape path. Read-only against Letterboxd.
    """
    username = (username or "").strip().strip("@/").lower()
    url = _FEED_URL.format(username=username)
    try:
        async with session.get(url, timeout=aiohttp.ClientTimeout(total=timeout_s)) as resp:
            if resp.status != 200:
                logger.warning("RSS probe for %s got HTTP %s", username, resp.status)
                return RssProbeResult(username=username, ok=False)
            body = await resp.text()
    except Exception as exc:  # noqa: BLE001 — probe must never break the pipeline
        logger.warning("RSS probe for %s failed: %s", username, exc)
        return RssProbeResult(username=username, ok=False)

    item_count = len(_ITEM_RE.findall(body))
    dates = _WATCHED_DATE_RE.findall(body)
    latest = max(dates) if dates else None
    return RssProbeResult(
        username=username,
        ok=True,
        item_count=item_count,
        latest_watched_date=latest,
    )
