"""Lightweight official Letterboxd RSS fingerprint — not a scrape, not a library."""

from __future__ import annotations

import asyncio
import re

from fastapi import APIRouter, HTTPException, Request

from app.security import enforce_rate_limit
from app.services.letterboxd_rss import FEED_ITEM_CAP, RssUnavailable, fetch_profile_rss

router = APIRouter()


@router.post("/api/rss-fingerprint")
async def rss_fingerprint(request: Request):
    """Return the public feed's latest guid / watchedDate / checksum.

    Used by the returning-user cache to decide whether a same-session ZIP or
    scrape result is still current. Never HTML-scrapes and never returns items.
    """
    enforce_rate_limit(request, "rss_fingerprint", limit=20, window=600)
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
        raise HTTPException(
            status_code=400,
            detail={"error_code": "invalid_username", "message": "Please enter a valid Letterboxd username."},
        )

    try:
        rss = await asyncio.to_thread(fetch_profile_rss, username)
    except ValueError as exc:
        message = str(exc)
        if "not found" in message.lower():
            raise HTTPException(
                status_code=404,
                detail={"error_code": "user_not_found", "message": message},
            ) from exc
        if "rate limit" in message.lower():
            raise HTTPException(
                status_code=429,
                detail={"error_code": "rate_limited", "message": message},
            ) from exc
        raise HTTPException(
            status_code=400,
            detail={"error_code": "invalid_username", "message": message},
        ) from exc
    except RssUnavailable as exc:
        raise HTTPException(
            status_code=503,
            detail={
                "error_code": "rss_unavailable",
                "message": "Letterboxd RSS could not be read. Upload your export ZIP instead.",
            },
        ) from exc

    return {
        "username": username,
        "checksum": rss.checksum,
        "latest_guid": rss.latest_guid,
        "latest_watched_date": rss.latest_watched_date,
        "item_count": len(rss.items),
        "preview_only": True,
        "feed_cap": FEED_ITEM_CAP,
    }
