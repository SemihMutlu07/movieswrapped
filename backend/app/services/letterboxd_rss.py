"""Official Letterboxd member RSS client.

Fetches only ``/{username}/rss/`` — the public diary/review feed Letterboxd
publishes. This is a preview and existence check (~50 items), not a full
library, and must never feed ``compute_cinema_scale``.
"""

from __future__ import annotations

from dataclasses import dataclass, field
import hashlib
import logging
import re
import time
from typing import Optional
from xml.etree import ElementTree as ET

import requests

logger = logging.getLogger("letterboxd_wrapped.letterboxd_rss")

RSS_URL_TEMPLATE = "https://letterboxd.com/{username}/rss/"
LETTERBOXD_NS = "https://letterboxd.com"
TMDB_NS = "https://themoviedb.org"
# Letterboxd's public member feed is a short recent window, not a lifetime diary.
FEED_ITEM_CAP = 50
PREVIEW_ITEM_LIMIT = 8
FETCH_TIMEOUT = 10
_POSTER_SRC = re.compile(
    r'<img[^>]+src="(https://(?:a\.)?ltrbxd\.com/[^"]+)"',
    re.IGNORECASE,
)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept": "application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://letterboxd.com/",
}


class RssUnavailable(Exception):
    """RSS could not be read (blocked, 5xx, malformed). Not a missing profile."""


@dataclass(frozen=True)
class RssItem:
    title: str
    year: Optional[str] = None
    watched_date: Optional[str] = None
    rating: Optional[float] = None
    tmdb_movie_id: Optional[str] = None
    tmdb_tv_id: Optional[str] = None
    guid: Optional[str] = None
    link: Optional[str] = None
    poster_url: Optional[str] = None


@dataclass(frozen=True)
class ProfileRss:
    username: str
    items: list[RssItem]
    checksum: str
    latest_guid: Optional[str] = None
    latest_watched_date: Optional[str] = None
    raw_length: int = 0


@dataclass(frozen=True)
class RssFingerprint:
    checksum: str
    item_count: int
    latest_guid: Optional[str]
    latest_watched_date: Optional[str]
    cached_at: float = field(default=0.0)


_FINGERPRINTS: dict[str, RssFingerprint] = {}


def clear_rss_fingerprints() -> None:
    _FINGERPRINTS.clear()


def last_rss_fingerprint(username: str) -> Optional[RssFingerprint]:
    return _FINGERPRINTS.get(username.strip().lower())


def remember_rss_fingerprint(username: str, rss: ProfileRss) -> RssFingerprint:
    key = username.strip().lower()
    stored = RssFingerprint(
        checksum=rss.checksum,
        item_count=len(rss.items),
        latest_guid=rss.latest_guid,
        latest_watched_date=rss.latest_watched_date,
        cached_at=time.monotonic(),
    )
    _FINGERPRINTS[key] = stored
    return stored


def _ns(tag: str, namespace: str) -> str:
    return f"{{{namespace}}}{tag}"


def _child_text(item: ET.Element, namespace: str, tag: str) -> Optional[str]:
    el = item.find(_ns(tag, namespace))
    if el is None or el.text is None:
        return None
    text = el.text.strip()
    return text or None


def _parse_rating(raw: Optional[str]) -> Optional[float]:
    if not raw:
        return None
    try:
        value = float(raw)
    except ValueError:
        return None
    if value < 0 or value > 5:
        return None
    return value


def _poster_from_description(description: Optional[str]) -> Optional[str]:
    if not description:
        return None
    match = _POSTER_SRC.search(description)
    if not match:
        return None
    return match.group(1)


def parse_letterboxd_rss(xml_bytes: bytes, *, username: str = "") -> ProfileRss:
    """Parse a Letterboxd member RSS document. Does not fetch."""
    checksum = hashlib.sha256(xml_bytes).hexdigest()
    try:
        root = ET.fromstring(xml_bytes)
    except ET.ParseError as exc:
        raise RssUnavailable(f"Letterboxd RSS for '{username}' was not valid XML") from exc

    items: list[RssItem] = []
    for item in root.iter("item"):
        title = _child_text(item, LETTERBOXD_NS, "filmTitle") or ""
        if not title:
            raw_title = (item.findtext("title") or "").strip()
            title = raw_title.split(",")[0].strip() if raw_title else ""
        if not title:
            continue
        year = _child_text(item, LETTERBOXD_NS, "filmYear")
        rating = _parse_rating(_child_text(item, LETTERBOXD_NS, "memberRating"))
        description = item.findtext("description")
        items.append(
            RssItem(
                title=title,
                year=year,
                watched_date=_child_text(item, LETTERBOXD_NS, "watchedDate"),
                rating=rating,
                tmdb_movie_id=_child_text(item, TMDB_NS, "movieId"),
                tmdb_tv_id=_child_text(item, TMDB_NS, "tvId"),
                guid=(item.findtext("guid") or "").strip() or None,
                link=(item.findtext("link") or "").strip() or None,
                poster_url=_poster_from_description(description),
            )
        )

    latest_guid = items[0].guid if items else None
    latest_watched = items[0].watched_date if items else None
    return ProfileRss(
        username=username,
        items=items,
        checksum=checksum,
        latest_guid=latest_guid,
        latest_watched_date=latest_watched,
        raw_length=len(xml_bytes),
    )


def preview_rss_items(items: list[RssItem], limit: int = PREVIEW_ITEM_LIMIT) -> list[dict[str, str]]:
    """Overwrite-safe sample for the wait story. Titles, optional year/poster."""
    out: list[dict[str, str]] = []
    seen: set[str] = set()
    for item in items:
        title = item.title.strip()
        if not title:
            continue
        key = title.casefold()
        if key in seen:
            continue
        seen.add(key)
        row: dict[str, str] = {"title": title}
        if item.year:
            row["year"] = item.year
        if item.poster_url and item.poster_url.startswith("https://"):
            row["poster_url"] = item.poster_url
        out.append(row)
        if len(out) >= limit:
            break
    return out


def rss_fingerprint_metrics(rss: ProfileRss) -> dict[str, object]:
    """JSON-safe fingerprint + preview. Explicitly not a full library."""
    return {
        "item_count": len(rss.items),
        "feed_cap": FEED_ITEM_CAP,
        "preview_only": True,
        "checksum": rss.checksum,
        "latest_guid": rss.latest_guid,
        "latest_watched_date": rss.latest_watched_date,
        "sample": preview_rss_items(rss.items),
    }


def _is_cloudflare_block(body: str) -> bool:
    if not body:
        return False
    return (
        ("Just a moment" in body[:500] and "challenges.cloudflare.com" in body[:1000])
        or "Attention Required! | Cloudflare" in body[:500]
    )


def fetch_profile_rss(
    username: str,
    *,
    session: Optional[requests.Session] = None,
) -> ProfileRss:
    """GET ``/{username}/rss/`` once. 404 is missing; 403/CF is unavailable."""
    handle = username.strip().lower()
    if not handle:
        raise ValueError("User '' not found")
    url = RSS_URL_TEMPLATE.format(username=handle)
    owns_session = session is None
    http = session or requests.Session()
    http.headers.update(HEADERS)
    try:
        response = http.get(url, timeout=FETCH_TIMEOUT)
    except requests.RequestException as exc:
        raise RssUnavailable(f"Letterboxd RSS for '{handle}' could not be fetched") from exc
    finally:
        if owns_session:
            http.close()

    status = response.status_code
    body = response.text or ""
    if status == 404:
        raise ValueError(f"User '{handle}' not found")
    if status == 429:
        raise ValueError(
            "Letterboxd rate limit hit. Please wait a moment and try again, or use the export upload option."
        )
    if status == 403 or _is_cloudflare_block(body):
        raise RssUnavailable(f"Letterboxd RSS for '{handle}' was blocked")
    if status != 200:
        raise RssUnavailable(f"Letterboxd RSS for '{handle}' returned HTTP {status}")

    raw = response.content if isinstance(response.content, (bytes, bytearray)) else body.encode("utf-8")
    rss = parse_letterboxd_rss(bytes(raw), username=handle)
    remember_rss_fingerprint(handle, rss)
    logger.info(
        "RSS for %s: items=%d checksum=%s",
        handle,
        len(rss.items),
        rss.checksum[:12],
    )
    return rss
