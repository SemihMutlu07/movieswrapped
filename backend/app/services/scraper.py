"""Letterboxd public profile scraper (HTML parsing via curl_cffi + BeautifulSoup).

Every Letterboxd HTML request uses one curl_cffi Safari session: access
check, films grid, and diary. Cloudflare/403 fails immediately so the
product can send the user to ZIP upload.
"""

from __future__ import annotations

import asyncio
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from datetime import date
from functools import partial
import logging
import os
import re
import threading
import time
from typing import Any, Callable, Optional
from urllib.parse import urlparse

from curl_cffi import requests as cffi_requests
from curl_cffi.requests.exceptions import RequestException as CurlRequestException
import requests
from bs4 import BeautifulSoup

logger = logging.getLogger("letterboxd_wrapped.scraper")

BASE_URL = "https://letterboxd.com"
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://letterboxd.com/",
}
PAGE_DELAY = float(os.getenv("LETTERBOXD_PAGE_DELAY", "0.25"))
MAX_PAGES = int(os.getenv("LETTERBOXD_MAX_PAGES", "60"))  # safety cap (~3000 films)
LIKER_MAX_PAGES = int(os.getenv("LETTERBOXD_LIKER_MAX_PAGES", "20"))
PREVIEW_ITEM_LIMIT = 8
GRID_CONCURRENCY = max(1, int(os.getenv("LETTERBOXD_GRID_CONCURRENCY", "3")))
FETCH_RETRIES = max(1, int(os.getenv("LETTERBOXD_FETCH_RETRIES", "3")))
RETRYABLE_STATUS = frozenset({429, 500, 502, 503, 504})
SAFARI_IMPERSONATE = os.getenv("LETTERBOXD_SAFARI_IMPERSONATE", "safari")

# Terminal messages — never retry these from the same cloud IP.
BLOCKED_MESSAGE = (
    "Letterboxd is blocking automated access to this profile. "
    "Please download your Letterboxd export and upload it for the best experience."
)
RATE_LIMIT_MESSAGE = (
    "Letterboxd rate limit hit. Please wait a moment and try again, or use the export upload option."
)

TraceCallback = Callable[[str, str, Optional[dict[str, Any]]], None]


def _trace(
    trace_callback: Optional[TraceCallback],
    stage: str,
    message: str,
    metrics: Optional[dict[str, Any]] = None,
) -> None:
    if trace_callback:
        trace_callback(stage, message, metrics)


@dataclass(frozen=True)
class ProfileScrapeSources:
    """Result of scraping a public Letterboxd profile in one warmed session."""

    diary: list[dict]
    grid: list[dict]
    review_count: int = 0
    film_count: int = 0
    reviews: list[dict] = field(default_factory=list)
    favorite_films: list[dict] = field(default_factory=list)  # up to 4 pinned profile favorites
    profile_avatar_url: Optional[str] = None


class LetterboxdSession:
    """One curl_cffi Safari client for every Letterboxd HTML request.

    Access check, films grid, and diary must share this session. Residential
    Cloudflare 403s the grid when it goes out over plain httpx. Tests may
    still pass a MagicMock with .get/.close; _fetch forwards to it.
    """

    def __init__(self) -> None:
        self.safari = cffi_requests.Session(impersonate=SAFARI_IMPERSONATE)
        self.safari.headers.update(HEADERS)
        self._lock = threading.Lock()

    def get(self, url: str, timeout: int = 10):
        last_error: Exception | None = None
        for attempt in range(FETCH_RETRIES):
            try:
                with self._lock:
                    response = self.safari.get(url, timeout=timeout)
            except (CurlRequestException, OSError) as exc:
                last_error = exc
                if attempt + 1 >= FETCH_RETRIES:
                    raise
                time.sleep(1.5 * (attempt + 1))
                continue
            status = getattr(response, "status_code", 0)
            body = getattr(response, "text", "") or ""
            if status in RETRYABLE_STATUS and attempt + 1 < FETCH_RETRIES:
                time.sleep(1.5 * (attempt + 1))
                continue
            if _is_cloudflare_block(body) or status == 403:
                return response
            return response
        if last_error:
            raise last_error
        raise RuntimeError(f"Letterboxd request failed for {url}")

    def close(self) -> None:
        try:
            self.safari.close()
        except Exception:
            pass


def _new_session() -> LetterboxdSession:
    return LetterboxdSession()


def _warm_session(session: Any) -> None:
    try:
        if isinstance(session, LetterboxdSession):
            session.safari.get(BASE_URL, timeout=10)
        elif hasattr(session, "get"):
            session.get(BASE_URL, timeout=10)
    except Exception:
        pass
    time.sleep(0.3)


def _fetch(session: Any, url: str, timeout: int = 10):
    """Fetch one Letterboxd page. Tests monkeypatch this function."""
    return session.get(url, timeout=timeout)


def _last_page(soup: BeautifulSoup) -> int:
    last = 1
    for anchor in soup.select(".paginate-pages a, .paginate-page a"):
        try:
            value = int(anchor.get_text(strip=True))
        except (TypeError, ValueError):
            continue
        if value > last:
            last = value
    return last


def sources_from_bookmarklet(payload: dict[str, Any]) -> ProfileScrapeSources:
    """Adapt bookmarklet /import JSON into the scraper film dicts."""
    raw_films = payload.get("films") if isinstance(payload.get("films"), list) else []
    raw_diary = payload.get("diary") if isinstance(payload.get("diary"), list) else []

    def as_film(item: Any, *, diary: bool) -> dict | None:
        if not isinstance(item, dict):
            return None
        title = str(item.get("title") or "").strip()
        if not title:
            return None
        year_val = item.get("year")
        year = str(year_val).strip() if year_val not in (None, "") else ""
        watch_date = ""
        if diary:
            watch_date = str(item.get("watchedDate") or item.get("watch_date") or "").strip()
        rating = item.get("rating")
        if isinstance(rating, (int, float)):
            rating_val: Optional[float] = float(rating)
        else:
            rating_val = None
        return {
            "title": title,
            "year": year,
            "rating": rating_val,
            "watch_date": watch_date,
            "slug": str(item.get("slug") or ""),
        }

    grid = [row for row in (as_film(item, diary=False) for item in raw_films) if row]
    diary = [row for row in (as_film(item, diary=True) for item in raw_diary) if row]
    return ProfileScrapeSources(diary=diary, grid=grid, film_count=len(grid))


def _is_cloudflare_block(body: str) -> bool:
    """Check if the response body is a Cloudflare challenge page."""
    if not body:
        return False
    return (
        ("Just a moment" in body[:500] and "challenges.cloudflare.com" in body[:1000])
        or "Attention Required! | Cloudflare" in body[:500]
    )


def _raise_for_letterboxd_gate(response, username: str, *, missing_is_not_found: bool) -> None:
    """Raise once for 403 / 429 / Cloudflare / unexpected HTTP. No retries."""
    status = getattr(response, "status_code", 0)
    body = getattr(response, "text", "") or ""
    if status == 404 and missing_is_not_found:
        raise ValueError(f"User '{username}' not found")
    if status == 403 or _is_cloudflare_block(body):
        raise ValueError(BLOCKED_MESSAGE)
    if status == 429:
        raise ValueError(RATE_LIMIT_MESSAGE)
    if missing_is_not_found and status != 200:
        raise RuntimeError(f"Letterboxd returned HTTP {status} for '{username}'")


def probe_profile_access(username: str, session: Optional[Any] = None) -> None:
    """Public alias used by the scrape pipeline before diary and grid pagination."""
    _probe_profile_access(username, session=session)


def _probe_profile_access(username: str, session: Optional[Any] = None) -> None:
    """Single GET of /{username}/films/page/1/ before diary/grid pagination.

    Uses the same Safari session as grid and diary. Distinguishes missing
    profiles (404) from bot blocks so the product can send the user to ZIP.
    """
    owns_session = session is None
    s = session or _new_session()
    try:
        r = _fetch(s, f"{BASE_URL}/{username}/films/page/1/", timeout=10)
        _raise_for_letterboxd_gate(r, username, missing_is_not_found=True)
    finally:
        if owns_session:
            s.close()


def _parse_rating(rating_span) -> Optional[float]:
    """Extract star rating from a <span class="rating rated-N"> element."""
    if not rating_span:
        return None
    classes = rating_span.get("class", [])
    for c in classes:
        m = re.match(r"rated-(\d+)", c)
        if m:
            return int(m.group(1)) / 2  # half-stars -> stars
    return None


def _rating_from_svg_label(label: str) -> Optional[float]:
    """Parse Letterboxd's SVG star label like '★★★★' or '★★½' into a float."""
    if not label:
        return None
    full = label.count("★")
    half = 0.5 if "½" in label else 0.0
    if full == 0 and half == 0.0:
        return None
    return full + half


def _normalize_poster_url(url: str) -> str:
    """Ensure a poster URL is absolute and browser-safe."""
    if not url:
        return url
    if url.startswith("http://") or url.startswith("https://"):
        return url
    if url.startswith("//"):
        return "https:" + url
    if url.startswith("/"):
        return "https://letterboxd.com" + url
    return url


def _safe_preview_poster(url: str) -> Optional[str]:
    """Keep only https Letterboxd CDN posters for the live scrape preview."""
    normalized = _normalize_poster_url(url).strip()
    parsed = urlparse(normalized)
    hostname = (parsed.hostname or "").lower()
    if parsed.scheme != "https":
        return None
    if hostname == "letterboxd.com" or hostname.endswith(".letterboxd.com"):
        return normalized
    if hostname == "ltrbxd.com" or hostname.endswith(".ltrbxd.com"):
        return normalized
    return None


def preview_items(films: list[dict], limit: int = PREVIEW_ITEM_LIMIT) -> list[dict[str, str]]:
    """Tiny overwrite-safe sample for the wait story. Counts and titles only."""
    out: list[dict[str, str]] = []
    seen: set[str] = set()
    for film in films:
        title = str(film.get("title") or "").strip()
        if not title:
            continue
        key = title.casefold()
        if key in seen:
            continue
        seen.add(key)
        item: dict[str, str] = {"title": title}
        year = str(film.get("year") or "").strip()
        if year:
            item["year"] = year
        poster = film.get("poster_url")
        if isinstance(poster, str) and poster.strip():
            safe = _safe_preview_poster(poster)
            if safe:
                item["poster_url"] = safe
        out.append(item)
        if len(out) >= limit:
            break
    return out


def _safe_letterboxd_avatar(candidate: Optional[str]) -> Optional[str]:
    """Return the URL only if it is an https image on Letterboxd's own CDN."""
    if not candidate:
        return None
    candidate = candidate.strip()
    parsed = urlparse(candidate)
    hostname = (parsed.hostname or "").lower()
    if parsed.scheme == "https" and (hostname == "ltrbxd.com" or hostname.endswith(".ltrbxd.com")):
        return candidate
    return None


def _parse_diary_rows(soup: BeautifulSoup) -> list[dict]:
    """Parse diary table rows into film dicts."""
    films = []
    for row in soup.select("tr.diary-entry-row"):
        title_td = row.select_one(".col-production")
        year_td = row.select_one(".col-releaseyear")
        rating_td = row.select_one(".col-rating")
        day_td = row.select_one(".col-daydate")

        title = ""
        if title_td:
            link = title_td.find("a")
            title = link.get_text(strip=True) if link else title_td.get_text(strip=True)

        year = year_td.get_text(strip=True) if year_td else ""
        rating = _parse_rating(rating_td.select_one(".rating") if rating_td else None)

        watch_date = ""
        day_link = day_td.find("a") if day_td else None
        if day_link:
            href = day_link.get("href", "")
            date_match = re.search(r"/for/(\d{4})/(\d{2})/(\d{2})/", href)
            if date_match:
                watch_date = f"{date_match.group(1)}-{date_match.group(2)}-{date_match.group(3)}"

        if title:
            films.append({
                "title": title,
                "year": year,
                "rating": rating,
                "watch_date": watch_date,
            })
    return films


def _parse_grid_items(soup: BeautifulSoup) -> list[dict]:
    """Parse film grid items from Letterboxd grid pages."""
    films: list[dict] = []

    # Strategy 0: bookmarklet-compatible grid (li.griditem / li.poster-container
    # with data-item-slug and rated-N). Ratings live on the tile, not only on
    # the legacy LazyPoster wrapper.
    for li in soup.select("li.griditem, li.poster-container"):
        poster = li.select_one("[data-item-slug], [data-film-slug]")
        if not poster:
            continue
        item_name = str(poster.get("data-item-name") or poster.get("data-film-name") or "")
        slug = str(poster.get("data-item-slug") or poster.get("data-film-slug") or "")
        m = re.match(r"^(.+) \((\d{4})\)$", item_name)
        if m:
            title, year = m.group(1), m.group(2)
        else:
            title, year = item_name, ""
        if not title:
            img = li.find("img")
            alt = str(img.get("alt") or "").strip() if img else ""
            m = re.match(r"^(.+)\s*\((\d{4})\)$", alt)
            if m:
                title, year = m.group(1).strip(), m.group(2)
            else:
                title = alt
        rating = _parse_rating(li.select_one('span.rating[class*="rated-"], span.rating'))
        poster_url = ""
        if poster.has_attr("data-poster-url"):
            poster_url = str(poster.get("data-poster-url") or "")
        if not poster_url:
            img = poster.find("img") or li.find("img")
            if img:
                poster_url = str(img.get("data-src") or img.get("src") or "")
        poster_url = _normalize_poster_url(poster_url)
        if title:
            films.append({
                "title": title,
                "year": year,
                "rating": rating,
                "watch_date": "",
                "slug": slug,
                "poster_url": poster_url,
            })
    if films:
        return films

    # Strategy 1: legacy selector (pre-mid 2025)
    for li in soup.select("li.griditem"):
        poster = li.select_one('div[data-component-class="LazyPoster"]')
        if not poster:
            continue

        item_name = poster.get("data-item-name", "")
        slug = poster.get("data-item-slug", "")

        m = re.match(r"^(.+) \((\d{4})\)$", item_name)
        if m:
            title, year = m.group(1), m.group(2)
        else:
            title, year = item_name, ""

        rating = _parse_rating(li.select_one('span.rating[class*="rated-"], span.rating'))

        poster_url = ""
        if poster.has_attr("data-poster-url"):
            poster_url = str(poster.get("data-poster-url") or "")
        if not poster_url:
            img = poster.find("img") or li.find("img")
            if img:
                poster_url = str(img.get("data-src") or img.get("src") or "")
        poster_url = _normalize_poster_url(poster_url)
        if title:
            films.append({
                "title": title,
                "year": year,
                "rating": rating,
                "watch_date": "",
                "slug": slug,
                "poster_url": poster_url,
            })

    if films:
        return films

    # Strategy 2: poster-container selector (mid-2025 onwards)
    for container in soup.select("li.poster-container, div.poster-container"):
        img = container.find("img")
        title = ""
        year = ""
        slug = ""
        poster_url = ""
        if img:
            alt = str(img.get("alt") or "").strip()
            m = re.match(r"^(.+)\s*\((\d{4})\)$", alt)
            if m:
                title, year = m.group(1).strip(), m.group(2)
            else:
                title = alt
            poster_url = str(img.get("src") or img.get("data-src") or "")
        poster_url = _normalize_poster_url(poster_url)

        if not slug:
            poster_div = container.select_one("[data-film-slug]")
            if poster_div:
                slug = str(poster_div.get("data-film-slug") or "")
        if not slug:
            link = container.find("a", href=re.compile(r"/film/"))
            if link:
                href = str(link.get("href") or "")
                m = re.search(r"/film/([^/]+)/", href)
                if m:
                    slug = m.group(1)

        rating = _parse_rating(container.select_one('span.rating[class*="rated-"], span.rating'))
        if title:
            films.append({
                "title": title,
                "year": year,
                "rating": rating,
                "watch_date": "",
                "slug": slug,
                "poster_url": poster_url,
            })

    if films:
        return films

    # Strategy 3: generic fallback (any img with film title pattern)
    seen: set[tuple[str, str]] = set()
    for img in soup.find_all("img"):
        alt = str(img.get("alt") or "").strip()
        m = re.match(r"^(.+)\s*\((\d{4})\)$", alt)
        if not m:
            continue
        title_raw, year = m.group(1).strip(), m.group(2)
        key = (title_raw.lower(), year)
        if key in seen:
            continue
        seen.add(key)

        slug = ""
        for parent in [img.parent, img.parent.parent if img.parent else None]:
            if parent is None:
                continue
            link = parent.find("a", href=re.compile(r"/film/")) if hasattr(parent, "find") else None
            if link:
                href = str(link.get("href") or "")
                m2 = re.search(r"/film/([^/]+)/", href)
                if m2:
                    slug = m2.group(1)
                    break
            data_slug = parent.get("data-film-slug") if hasattr(parent, "get") else None
            if data_slug:
                slug = str(data_slug)
                break

        poster_url = str(img.get("src") or img.get("data-src") or "")
        poster_url = _normalize_poster_url(poster_url)

        films.append({
            "title": title_raw,
            "year": year,
            "rating": None,
            "watch_date": "",
            "slug": slug,
            "poster_url": poster_url,
        })

    return films


def _parse_review_cards(soup: BeautifulSoup) -> list[dict]:
    """Parse Letterboxd review list HTML into review dicts."""
    reviews: list[dict] = []
    for article in soup.select("article.production-viewing"):
        poster = article.select_one('[data-component-class="LazyPoster"]')
        slug = ""
        if poster:
            slug = str(poster.get("data-item-slug") or "")

        headline = article.select_one("h2.primaryname a") or article.select_one("h2 a")
        title = headline.get_text(strip=True) if headline else ""
        review_path = str(headline.get("href") or "") if headline else ""
        if not slug and review_path:
            m = re.search(r"/film/([^/]+)/?", review_path)
            if m:
                slug = m.group(1)

        year_el = article.select_one("span.releasedate")
        year = year_el.get_text(strip=True) if year_el else ""

        rating: Optional[float] = None
        rating_svg = article.select_one("span.inline-rating svg, .inline-rating svg")
        if rating_svg and rating_svg.has_attr("aria-label"):
            rating = _rating_from_svg_label(str(rating_svg.get("aria-label") or ""))

        body = article.select_one(".js-review-body, .body-text")
        review_text = ""
        if body:
            review_text = body.get_text(separator=" ", strip=True)

        time_el = article.select_one("time.timestamp")
        date_val = ""
        if time_el:
            if time_el.has_attr("datetime"):
                date_val = str(time_el.get("datetime") or "")
            else:
                date_val = time_el.get_text(strip=True)

        like_count: Optional[int] = None
        like_el = article.select_one('[data-component-class="LikeComponent"][data-count]')
        if like_el is not None:
            raw = str(like_el.get("data-count") or "").strip()
            try:
                like_count = int(raw) if raw else None
            except ValueError:
                like_count = None

        if title:
            reviews.append({
                "title": title,
                "year": year,
                "slug": slug,
                "review_path": review_path,
                "rating": rating,
                "review_text": review_text,
                "date": date_val,
                "like_count": like_count,
            })
    return reviews


def _review_listing_looks_truncated(review_text: str) -> bool:
    """Heuristic: Letterboxd review listings often clip long bodies."""
    text = (review_text or "").strip()
    if not text:
        return False
    if text.endswith("…") or text.endswith("..."):
        return True
    if len(text) >= 700:
        return True
    return False


def _parse_review_detail_body(soup: BeautifulSoup) -> str:
    """Extract full review prose from a single-review page."""
    body = soup.select_one(".js-review-body, .body-text, .review")
    if not body:
        return ""
    return body.get_text(separator=" ", strip=True)


def _hydrate_truncated_review_texts(
    reviews: list[dict],
    session: requests.Session,
) -> None:
    """Replace truncated listing excerpts with full text from review permalinks."""
    for review in reviews:
        excerpt = str(review.get("review_text") or "")
        review_path = str(review.get("review_path") or "").strip()
        if not review_path or not _review_listing_looks_truncated(excerpt):
            continue
        url = review_path if review_path.startswith("http") else f"{BASE_URL}{review_path}"
        try:
            r = _fetch(session, url, timeout=10)
        except Exception as exc:
            logger.debug("Full review fetch failed for %s: %s", review_path, exc)
            continue
        if r.status_code != 200 or _is_cloudflare_block(r.text):
            continue
        full_text = _parse_review_detail_body(BeautifulSoup(r.text, "html.parser"))
        if full_text and (
            len(full_text) > len(excerpt)
            or (_review_listing_looks_truncated(excerpt) and not _review_listing_looks_truncated(full_text))
        ):
            review["review_text"] = full_text
        time.sleep(PAGE_DELAY)


def _parse_liker_cards(soup: BeautifulSoup) -> list[dict]:
    """Parse a review's /likes/ page into liker identity dicts."""
    likers: list[dict] = []
    for summary in soup.select(".person-summary"):
        link = summary.select_one('a[href^="/"]')
        if not link:
            continue
        username = str(link.get("href") or "").strip("/").split("/")[0]
        if not username:
            continue
        name_el = summary.select_one("a.name, .name")
        img = summary.select_one("img[src]")
        display_name = name_el.get_text(strip=True) if name_el else ""
        if not display_name and img:
            display_name = str(img.get("alt") or "").strip()
        avatar_url = _safe_letterboxd_avatar(str(img.get("src") or "")) if img else None
        likers.append({
            "username": username,
            "display_name": display_name,
            "avatar_url": avatar_url,
        })
    return likers


def _scrape_review_likers(
    review_path: str,
    like_count: Optional[int],
    session: requests.Session,
    trace_callback: Optional[TraceCallback] = None,
) -> tuple[list[dict], bool]:
    """Crawl a single review's likers, serially and politely."""
    if not like_count or like_count <= 0:
        return [], True

    likers: list[dict] = []
    complete = True
    base = "/" + review_path.strip("/")
    for page in range(1, LIKER_MAX_PAGES + 1):
        url = f"{BASE_URL}{base}/likes/" if page == 1 else f"{BASE_URL}{base}/likes/page/{page}/"
        try:
            r = _fetch(session, url, timeout=10)
        except Exception:
            complete = False
            break
        if r.status_code != 200 or _is_cloudflare_block(r.text):
            complete = False
            break

        soup = BeautifulSoup(r.text, "html.parser")
        likers.extend(_parse_liker_cards(soup))
        has_next = soup.select_one(".paginate-nextprev a.next") is not None
        if not has_next or not soup.select_one(".person-summary"):
            break
        if page == LIKER_MAX_PAGES:
            complete = False
            break
        time.sleep(PAGE_DELAY)

    return likers, complete


def _crawl_likers_into(
    reviews: list[dict],
    session: requests.Session,
    trace_callback: Optional[TraceCallback] = None,
) -> None:
    """Attach `likers`/`likers_complete` to each review in place."""
    total = 0
    completed = 0
    for review in reviews:
        like_count = review.get("like_count")
        if like_count and like_count > 0:
            total += 1
        try:
            likers, complete = _scrape_review_likers(
                review.get("review_path") or "", like_count, session, trace_callback
            )
        except Exception as exc:
            logger.warning("Liker crawl failed for %s: %s", review.get("review_path"), exc)
            likers, complete = [], False
        review["likers"] = likers
        review["likers_complete"] = complete
        if like_count and like_count > 0 and complete:
            completed += 1
    _trace(
        trace_callback,
        "review_likers_done",
        "Review liker crawl completed",
        {"review_likers_total": total, "review_likers_completed": completed},
    )


def _diary_page_url(username: str, page: int) -> str:
    return f"{BASE_URL}/{username}/films/diary/page/{page}/"


def _grid_page_url(username: str, page: int) -> str:
    return f"{BASE_URL}/{username}/films/page/{page}/"


def _checked_page(session: Any, url: str, username: str, page: int, *, kind: str):
    r = _fetch(session, url, timeout=10)
    if r.status_code == 404:
        logger.warning("%s page %d: 404 for %s", kind, page, username)
        if page == 1:
            raise ValueError(f"User '{username}' not found")
        return None
    if r.status_code == 403:
        logger.error("Letterboxd returned 403 for %s %s page %d — bot detection blocked", username, kind, page)
    if r.status_code == 429:
        logger.warning("Letterboxd rate-limited %s request for %s page %d", kind, username, page)
    if _is_cloudflare_block(r.text):
        logger.warning("%s page %d: Cloudflare block for %s", kind.capitalize(), page, username)
    _raise_for_letterboxd_gate(r, username, missing_is_not_found=False)
    if r.status_code != 200:
        logger.warning("%s page %d: unexpected status %d for %s", kind.capitalize(), page, r.status_code, username)
        raise RuntimeError(f"Letterboxd returned HTTP {r.status_code} for '{username}'")
    return r


def _sync_scrape_diary(
    username: str,
    max_pages: int,
    session: Optional[Any] = None,
    trace_callback: Optional[TraceCallback] = None,
    cutoff_date: Optional[date] = None,
) -> list[dict]:
    """Synchronous diary scraper (same Safari session as grid and access check)."""
    owns_session = session is None
    logger.info("Starting diary scrape for %s (max_pages=%d)", username, max_pages)
    s = session or _new_session()
    if owns_session:
        _warm_session(s)

    all_films: list[dict] = []
    last_seen_date: Optional[date] = None
    monotonic_dates = True

    try:
        r = _checked_page(s, _diary_page_url(username, 1), username, 1, kind="diary")
        if r is None:
            logger.info("Diary scrape complete for %s: %d films", username, 0)
            _trace(trace_callback, "diary_done", "Diary scrape completed", {"films": 0, "sample": []})
            return []
        soup = BeautifulSoup(r.text, "html.parser")
        films = _parse_diary_rows(soup)
        logger.info("Diary page %d parsed %d films for %s", 1, len(films), username)
        _trace(
            trace_callback,
            "diary_page",
            "Diary page 1 parsed",
            {"page": 1, "films": len(films), "status_code": r.status_code},
        )
        all_films.extend(films)
        last_page = _last_page(soup)
        known_last = last_page > 1
        remaining = range(2, min(last_page if known_last else max_pages, max_pages) + 1)
        if not films and not known_last:
            remaining = range(2, 2)

        def _note_dates(page_films: list[dict]) -> bool:
            nonlocal last_seen_date, monotonic_dates
            parsed_dates: list[date] = []
            for film in page_films:
                try:
                    parsed_date = date.fromisoformat(str(film.get("watch_date") or ""))
                except ValueError:
                    monotonic_dates = False
                    continue
                if last_seen_date is not None and parsed_date > last_seen_date:
                    monotonic_dates = False
                last_seen_date = parsed_date
                parsed_dates.append(parsed_date)
            if (
                cutoff_date is not None
                and monotonic_dates
                and len(parsed_dates) == len(page_films)
                and parsed_dates
                and parsed_dates[-1] < cutoff_date
            ):
                _trace(
                    trace_callback,
                    "diary_period_complete",
                    "Diary period boundary reached",
                    {"cutoff_date": cutoff_date.isoformat()},
                )
                return True
            return False

        if films and _note_dates(films):
            remaining = range(2, 2)

        for page in remaining:
            time.sleep(PAGE_DELAY)
            r = _checked_page(s, _diary_page_url(username, page), username, page, kind="diary")
            if r is None:
                break
            soup = BeautifulSoup(r.text, "html.parser")
            films = _parse_diary_rows(soup)
            logger.info("Diary page %d parsed %d films for %s", page, len(films), username)
            _trace(
                trace_callback,
                "diary_page",
                f"Diary page {page} parsed",
                {"page": page, "films": len(films), "status_code": r.status_code},
            )
            if not films:
                if known_last:
                    continue
                break
            all_films.extend(films)
            if _note_dates(films):
                break
    finally:
        if owns_session:
            s.close()

    logger.info("Diary scrape complete for %s: %d films", username, len(all_films))
    _trace(
        trace_callback,
        "diary_done",
        "Diary scrape completed",
        {"films": len(all_films), "sample": preview_items(all_films)},
    )
    return all_films


def _fetch_grid_page(session: Any, username: str, page: int, trace_callback: Optional[TraceCallback]) -> list[dict]:
    r = _checked_page(session, _grid_page_url(username, page), username, page, kind="grid")
    if r is None:
        return []
    soup = BeautifulSoup(r.text, "html.parser")
    films = _parse_grid_items(soup)
    logger.info("Grid page %d parsed %d films for %s", page, len(films), username)
    _trace(
        trace_callback,
        "grid_page",
        f"Grid page {page} parsed",
        {"page": page, "films": len(films), "status_code": r.status_code},
    )
    return films


def _sync_scrape_films_grid(
    username: str,
    max_pages: int,
    session: Optional[Any] = None,
    trace_callback: Optional[TraceCallback] = None,
) -> list[dict]:
    """Synchronous full-watched grid scraper (same Safari session as diary)."""
    owns_session = session is None
    logger.info("Starting grid scrape for %s (max_pages=%d)", username, max_pages)
    s = session or _new_session()
    if owns_session:
        _warm_session(s)

    all_films: list[dict] = []

    try:
        r = _checked_page(s, _grid_page_url(username, 1), username, 1, kind="grid")
        if r is None:
            films = []
            last_page = 1
        else:
            soup = BeautifulSoup(r.text, "html.parser")
            films = _parse_grid_items(soup)
            last_page = _last_page(soup)
            logger.info("Grid page %d parsed %d films for %s", 1, len(films), username)
            _trace(
                trace_callback,
                "grid_page",
                "Grid page 1 parsed",
                {"page": 1, "films": len(films), "status_code": r.status_code},
            )
        all_films.extend(films)
        known_last = last_page > 1
        remaining = list(range(2, min(last_page if known_last else max_pages, max_pages) + 1))
        if not films and not known_last:
            remaining = []

        if known_last and remaining:
            errors: list[BaseException] = []
            with ThreadPoolExecutor(max_workers=GRID_CONCURRENCY) as pool:
                futures = []
                for index, page in enumerate(remaining):
                    if index:
                        time.sleep(PAGE_DELAY)
                    futures.append(pool.submit(_fetch_grid_page, s, username, page, trace_callback))
                for future in as_completed(futures):
                    try:
                        all_films.extend(future.result())
                    except BaseException as exc:
                        errors.append(exc)
                if errors:
                    raise errors[0]
        else:
            for page in remaining:
                time.sleep(PAGE_DELAY)
                page_films = _fetch_grid_page(s, username, page, trace_callback)
                if not page_films:
                    break
                all_films.extend(page_films)
    finally:
        if owns_session:
            s.close()

    logger.info("Grid scrape complete for %s: %d films", username, len(all_films))
    _trace(
        trace_callback,
        "grid_done",
        "Grid scrape completed",
        {"films": len(all_films), "sample": preview_items(all_films)},
    )
    return all_films


def _sync_scrape_reviews(
    username: str,
    max_pages: int,
    session: Optional[requests.Session] = None,
    trace_callback: Optional[TraceCallback] = None,
    include_likers: bool = False,
) -> list[dict]:
    """Single-pass scraper for /{username}/reviews/films/page/N/."""
    owns_session = session is None
    logger.info("Starting review scrape for %s (max_pages=%d)", username, max_pages)
    s = session or _new_session()
    if owns_session:
        _warm_session(s)

    all_reviews: list[dict] = []
    try:
        for page in range(1, max_pages + 1):
            url = f"{BASE_URL}/{username}/reviews/films/page/{page}/"
            r = _fetch(s, url, timeout=10)
            if r.status_code == 404:
                logger.info("Review scrape: page %d 404 for %s (stop)", page, username)
                break
            if _is_cloudflare_block(r.text):
                logger.warning("Review scrape: page %d Cloudflare block for %s", page, username)
            _raise_for_letterboxd_gate(r, username, missing_is_not_found=False)
            if r.status_code != 200:
                logger.warning("Review scrape: page %d unexpected status %d for %s", page, r.status_code, username)
                raise RuntimeError(f"Letterboxd returned HTTP {r.status_code} for '{username}' reviews")
            soup = BeautifulSoup(r.text, "html.parser")
            reviews = _parse_review_cards(soup)
            _trace(
                trace_callback,
                "reviews_page",
                f"Reviews page {page} parsed",
                {"page": page, "reviews": len(reviews), "status_code": r.status_code},
            )
            if not reviews:
                break
            _hydrate_truncated_review_texts(reviews, s)
            all_reviews.extend(reviews)
            time.sleep(PAGE_DELAY)

        if include_likers:
            _crawl_likers_into(all_reviews, s, trace_callback)
    finally:
        if owns_session:
            s.close()

    logger.info("Review scrape complete for %s: %d reviews", username, len(all_reviews))
    _trace(trace_callback, "reviews_done", "Reviews scrape completed", {"reviews": len(all_reviews)})
    return all_reviews


def _sync_scrape_overview(
    username: str,
    session: Optional[requests.Session] = None,
    trace_callback: Optional[TraceCallback] = None,
) -> tuple[int, int, list[dict], Optional[str]]:
    """Fetch profile counts, favorites, and the public profile avatar."""
    owns_session = session is None
    s = session or _new_session()
    if owns_session:
        _warm_session(s)
    film_count = 0
    review_count = 0
    favorite_films: list[dict] = []
    profile_avatar_url: Optional[str] = None
    try:
        overview_resp = _fetch(s, f"{BASE_URL}/{username}/", timeout=10)
        if overview_resp.status_code == 200:
            soup = BeautifulSoup(overview_resp.text, "html.parser")
            avatar = soup.select_one("#avatar-large img[src]") or soup.select_one(".profile-avatar img[src]")
            if avatar:
                profile_avatar_url = _safe_letterboxd_avatar(str(avatar.get("src") or ""))
            films_link = soup.select_one('a[href$="/films/"]')
            if films_link:
                count_span = films_link.select_one(".value")
                if count_span:
                    try:
                        film_count = int(count_span.get_text(strip=True).replace(",", ""))
                    except ValueError:
                        pass
            reviews_link = soup.select_one('a[href$="/reviews/"]')
            if reviews_link:
                count_span = reviews_link.select_one(".value")
                if count_span:
                    try:
                        review_count = int(count_span.get_text(strip=True).replace(",", ""))
                    except ValueError:
                        pass
            # Parse up to 4 pinned favorite films from the profile page
            for item in soup.select("#favourites .poster-list li")[:4]:
                poster_div = item.select_one("[data-film-slug]")
                if not poster_div:
                    continue
                slug = str(poster_div.get("data-film-slug") or "")
                title = str(poster_div.get("data-film-name") or "")
                if not title:
                    img = item.select_one("img")
                    title = str(img.get("alt") or "") if img else ""
                year_raw = poster_div.get("data-film-release-year")
                year = int(year_raw) if year_raw and str(year_raw).isdigit() else None
                if slug:
                    favorite_films.append({"slug": slug, "title": title, "year": year})
            _trace(
                trace_callback,
                "overview",
                "Profile overview parsed",
                {
                    "film_count": film_count,
                    "review_count": review_count,
                    "favorite_films": len(favorite_films),
                    "status_code": overview_resp.status_code,
                },
            )
    except Exception:
        pass  # non-fatal — counts are best-effort
    finally:
        if owns_session:
            s.close()
    return film_count, review_count, favorite_films, profile_avatar_url


def _sync_scrape_profile_sources(
    username: str,
    max_pages: int,
    include_reviews: bool = False,
    trace_callback: Optional[TraceCallback] = None,
    diary_cutoff: Optional[date] = None,
    include_grid: bool = True,
    skip_probe: bool = False,
    session: Optional[Any] = None,
) -> ProfileScrapeSources:
    """Scrape diary and grid in one warmed Safari session."""
    logger.info("Starting combined profile scrape for %s (include_reviews=%s)", username, include_reviews)
    owns_session = session is None
    s = session or _new_session()
    if owns_session:
        _warm_session(s)
    try:
        if not skip_probe:
            _probe_profile_access(username, session=s)
        film_count, review_count, favorite_films, profile_avatar_url = _sync_scrape_overview(
            username, session=s, trace_callback=trace_callback
        )
        diary = _sync_scrape_diary(
            username,
            max_pages,
            session=s,
            trace_callback=trace_callback,
            cutoff_date=diary_cutoff,
        )
        grid = (
            _sync_scrape_films_grid(username, max_pages, session=s, trace_callback=trace_callback)
            if include_grid
            else []
        )
        reviews: list[dict] = []
        if include_reviews:
            try:
                # Liker identity pages are a serial tail (up to 20 pages per review).
                # Wrapped stats use the review text already on the card.
                reviews = _sync_scrape_reviews(
                    username,
                    max_pages,
                    session=s,
                    trace_callback=trace_callback,
                    include_likers=False,
                )
            except Exception as exc:
                logger.warning("Review scrape failed for %s: %s", username, exc)
        logger.info(
            "Combined scrape complete for %s: diary=%d grid=%d films=%d reviews=%d scraped_reviews=%d",
            username, len(diary), len(grid), film_count, review_count, len(reviews),
        )
        return ProfileScrapeSources(
            diary=diary,
            grid=grid,
            review_count=review_count,
            film_count=film_count,
            reviews=reviews,
            favorite_films=favorite_films,
            profile_avatar_url=profile_avatar_url,
        )
    finally:
        if owns_session:
            s.close()


def _sync_check_profile(username: str) -> bool:
    """Synchronous profile check — logs every outcome for debugging."""
    url = f"{BASE_URL}/{username}/"
    session = _new_session()
    try:
        r = _fetch(session, url, timeout=15)
        if r.status_code == 200:
            if _is_cloudflare_block(r.text):
                logger.warning("Profile check BLOCKED: %s -> Cloudflare challenge", username)
                return False
            logger.info("Profile check OK: %s -> 200", username)
            return True
        elif r.status_code == 404:
            logger.warning("Profile check FAILED: %s -> 404 (user not found)", username)
        elif r.status_code == 403:
            logger.warning("Profile check FAILED: %s -> 403 (blocked by Letterboxd)", username)
        else:
            logger.warning("Profile check FAILED: %s -> %d (unexpected status)", username, r.status_code)
        logger.debug("Response preview for %s: %s", username, r.text[:500])
        return False
    except Exception as exc:
        logger.warning("Profile check FAILED: %s -> %s: %s", username, type(exc).__name__, exc)
        return False
    finally:
        session.close()


def _get_loop() -> asyncio.AbstractEventLoop:
    try:
        return asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.get_event_loop()


async def check_profile_exists(username: str) -> bool:
    """Check if a Letterboxd profile exists (async wrapper)."""
    loop = _get_loop()
    return await loop.run_in_executor(None, partial(_sync_check_profile, username))

async def scrape_avatar_only(username: str) -> Optional[str]:
    """Fetch just the public profile avatar."""
    loop = _get_loop()
    _, _, _, avatar_url = await loop.run_in_executor(
        None, partial(_sync_scrape_overview, username)
    )
    return avatar_url


async def scrape_diary(username: str, max_pages: int = MAX_PAGES) -> list[dict]:
    """Async wrapper around _sync_scrape_diary."""
    loop = _get_loop()
    return await loop.run_in_executor(
        None, partial(_sync_scrape_diary, username, max_pages)
    )


async def scrape_films_grid(username: str, max_pages: int = MAX_PAGES) -> list[dict]:
    """Scrape the full watched-films grid (superset of diary)."""
    loop = _get_loop()
    return await loop.run_in_executor(
        None, partial(_sync_scrape_films_grid, username, max_pages)
    )


async def scrape_reviews(username: str, max_pages: int = MAX_PAGES) -> list[dict]:
    """Async wrapper around _sync_scrape_reviews."""
    loop = _get_loop()
    return await loop.run_in_executor(
        None, partial(_sync_scrape_reviews, username, max_pages)
    )


async def scrape_profile_sources(
    username: str,
    max_pages: int = MAX_PAGES,
    include_reviews: bool = False,
    trace_callback: Optional[TraceCallback] = None,
    diary_cutoff: Optional[date] = None,
    include_grid: bool = True,
    skip_probe: bool = False,
    session: Optional[Any] = None,
) -> ProfileScrapeSources:
    """Scrape diary, grid, overview (and optionally reviews) on one Safari session."""
    loop = _get_loop()
    return await loop.run_in_executor(
        None,
        partial(
            _sync_scrape_profile_sources,
            username,
            max_pages,
            include_reviews,
            trace_callback,
            diary_cutoff,
            include_grid,
            skip_probe,
            session,
        ),
    )


def merge_scraped_films(diary: list[dict], grid: list[dict]) -> list[dict]:
    """Merge diary + grid films, preferring diary entries (they have watch_date)."""
    def key(f: dict) -> tuple[str, str]:
        return (f.get("title", "").strip().lower(), str(f.get("year", "")).strip())

    seen = {key(f) for f in diary}
    extras = [f for f in grid if key(f) not in seen]
    return list(diary) + extras


def diary_to_csv_dicts(films: list[dict]) -> dict[str, list[dict]]:
    """Convert scraped diary films to CSV-compatible dicts matching Letterboxd export format."""
    seen = set()
    watched_rows = []
    ratings_rows = []
    diary_rows = []

    for f in films:
        title = str(f.get("title") or "").strip()
        year = str(f.get("year") or "").strip()
        key = (title, year)
        if key in seen:
            continue
        seen.add(key)

        watched_rows.append({
            "Name": title,
            "Year": year,
        })

        if f.get("rating") is not None:
            ratings_rows.append({
                "Name": title,
                "Year": year,
                "Rating": f["rating"],
            })

        watch_date = f.get("watch_date") or ""
        if watch_date:
            diary_rows.append({
                "Date": watch_date,
                "Name": title,
                "Year": year,
                "Rating": f["rating"] if f.get("rating") is not None else "",
                "Watched Date": watch_date,
            })

    return {"watched": watched_rows, "ratings": ratings_rows, "diary": diary_rows}
