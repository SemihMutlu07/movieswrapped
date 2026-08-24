from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
from pathlib import Path
import time
from collections import deque
from typing import Any, Dict, List, Literal, Optional
import unicodedata

import aiofiles
import aiohttp
import pandas as pd

from app.config import settings
from app.services.tmdb_telemetry import current, endpoint_family

logger = logging.getLogger("letterboxd_wrapped.tmdb")

CACHE_DIR = Path("tmdb_cache")
CACHE_DIR.mkdir(exist_ok=True)
_tmdb_request_times: deque[float] = deque()
_tmdb_rate_lock = asyncio.Lock()

# Cache freshness window. TMDB's terms ask local caches to be refreshed at
# most every ~6 months (175 days is safely inside that); older files are
# treated as misses and lazily re-fetched on next use. No startup sweep —
# expiry is evaluated per read.
CACHE_MAX_AGE_SECONDS = 175 * 24 * 60 * 60


async def _wait_for_tmdb_slot() -> None:
    """Conservative process-wide TMDB request pacing.

    TMDB no longer publishes a fixed hard quota, but its docs mention upper
    limits around 40 req/sec. We stay below that by default and still rely on
    429 backoff if the effective limit changes.
    """
    limit = max(1, settings.tmdb_requests_per_second)

    while True:
        async with _tmdb_rate_lock:
            now = time.monotonic()
            while _tmdb_request_times and now - _tmdb_request_times[0] >= 1:
                _tmdb_request_times.popleft()

            if len(_tmdb_request_times) < limit:
                _tmdb_request_times.append(now)
                return

            sleep_for = max(0.01, 1 - (now - _tmdb_request_times[0]))

        await asyncio.sleep(sleep_for)


def _cache_read_is_fresh(path: Path) -> bool:
    """True when the file's mtime is inside the freshness window.

    mtime is the write time of the cached response — exactly what a lazy TTL
    needs. Missing files are not fresh by definition.
    """
    try:
        age = time.time() - path.stat().st_mtime
    except OSError:
        return False
    return age <= CACHE_MAX_AGE_SECONDS


async def _read_cache_payload(path: Path) -> Optional[Dict[str, Any]]:
    """Parse one cache file, or None when missing/corrupt/empty-result.

    Legacy empty-result files ({"results": []}) are treated as unusable and
    removed so they cannot serve as hits; malformed JSON likewise falls back
    to a refetch.
    """
    if not path.exists():
        return None
    try:
        async with aiofiles.open(path, "r", encoding="utf-8") as f:
            data = json.loads(await f.read())
    except (OSError, ValueError):
        # Malformed or unreadable — controlled refetch path.
        logger.warning("Discarding unreadable TMDB cache file %s", path.name)
        _safe_unlink(path)
        return None
    if isinstance(data, dict):
        results = data.get("results")
        if isinstance(results, list) and not results:
            # Legacy poisoned entry: an empty result set must never be a hit.
            logger.info("Removing legacy empty-result TMDB cache file %s", path.name)
            _safe_unlink(path)
            return None
    return data


def _safe_unlink(path: Path) -> None:
    """Best-effort removal that never masks the caller's flow."""
    try:
        path.unlink()
    except OSError as exc:
        logger.debug("Could not remove cache file %s: %s", path, exc)


def _unlink_with_retry_blocking(path: Path, attempts: int = 10, delay: float = 0.02) -> None:
    """Blocking best-effort unlink with retries; runs on an executor thread.

    Survives task cancellation (it is detached from the event loop) so a
    cancelled or failed write never leaves *.tmp litter behind.
    """
    for attempt in range(attempts):
        try:
            path.unlink()
            return
        except FileNotFoundError:
            return
        except OSError as exc:
            if attempt == attempts - 1:
                logger.debug("Could not remove temp cache file %s: %s", path, exc)
                return
            time.sleep(delay)


_tmp_write_counter = 0

async def _write_cache_atomic(path: Path, payload: Dict[str, Any]) -> bool:
    """Write payload via unique sibling temp file + os.replace.

    Readers can only ever observe either the previous file or the fully
    written new one — never partial JSON. On Windows, os.replace is atomic
    and overwrites existing destinations, but it fails with a transient
    ERROR_SHARING_VIOLATION while another handle (e.g. a concurrent reader)
    still holds the destination open; we retry briefly before giving up.
    Any exception or cancellation removes the temp file and re-raises; the
    destination is untouched on failure, so a failed refresh never corrupts
    stale content or marks it fresh.
    """
    global _tmp_write_counter
    _tmp_write_counter += 1
    tmp_path = path.with_name(f"{path.name}.{os.getpid()}.{_tmp_write_counter}.tmp")
    try:
        async with aiofiles.open(tmp_path, "w", encoding="utf-8") as f:
            await f.write(json.dumps(payload, ensure_ascii=False, indent=2))
            await f.flush()
        last_exc: BaseException | None = None
        for attempt in range(5):
            try:
                os.replace(tmp_path, path)
                return True
            except PermissionError as exc:  # WinError 32/33 — handle still open elsewhere
                last_exc = exc
                await asyncio.sleep(0.01 * (attempt + 1))
        raise last_exc if last_exc else OSError(f"os.replace failed for {path}")
    except BaseException:  # noqa: BLE001 — includes asyncio.CancelledError
        # The aiofiles close may itself have been cancelled mid-flight, leaving the
        # OS handle alive for a few more ms. Awaiting inside an already-cancelling
        # task just re-raises CancelledError, so the retry runs detached on the
        # default executor with blocking sleeps — it survives cancellation and
        # guarantees no temp litter outlives the failed write.
        loop = asyncio.get_running_loop()
        loop.run_in_executor(None, _unlink_with_retry_blocking, tmp_path)
        raise


async def tmdb_get(
    session: aiohttp.ClientSession,
    endpoint: str,
    params: dict | None = None,
    cache: bool = True,
) -> Optional[Dict[str, Any]]:
    """GET from TMDB API with disk caching."""
    params = dict(params or {})
    params["api_key"] = settings.tmdb_api_key

    params_str = json.dumps(params, sort_keys=True)
    cache_key = hashlib.md5(f"{endpoint}{params_str}".encode()).hexdigest()
    cache_file = CACHE_DIR / f"{cache_key}.json"

    # Per-job telemetry (no-op when no collector is active for this task).
    collector = current()
    family = endpoint_family(endpoint)

    if cache:
        cached = await _read_cache_payload(cache_file)
        if cached is not None and _cache_read_is_fresh(cache_file):
            if collector is not None:
                collector.record_cache_hit(family)
            return cached
        # Missing, expired, malformed or legacy-empty: treat as a miss and
        # lazily refresh below (no bulk startup sweep anywhere).

    else:
        cached = None

    if collector is not None:
        collector.record_cache_miss(family)

    url = f"https://api.themoviedb.org/3/{endpoint}"
    for attempt in range(settings.tmdb_429_retries + 1):
        try:
            await _wait_for_tmdb_slot()
            if collector is not None:
                collector.record_outbound_request(family)
            async with session.get(url, params=params) as response:
                if response.status == 429:
                    retry_after = response.headers.get("Retry-After")
                    try:
                        delay = float(retry_after) if retry_after else 1.5 * (attempt + 1)
                    except ValueError:
                        delay = 1.5 * (attempt + 1)
                    if attempt < settings.tmdb_429_retries:
                        if collector is not None:
                            collector.record_429(family)
                            collector.record_retry(family)
                        await asyncio.sleep(delay)
                        continue
                    # Retries exhausted on 429 — still a rate-limit outcome.
                    # The stale file (if any) stays untouched: it was never
                    # marked fresh, so the next call simply retries again.
                    if collector is not None:
                        collector.record_429(family)
                    return None

                response.raise_for_status()
                data = await response.json()
                # Don't cache empty search results — a transient miss would otherwise
                # poison the cache forever. Only persist payloads that returned content.
                results = data.get("results") if isinstance(data, dict) else None
                should_cache = (results is None) or bool(results)
                if cache and should_cache:
                    # A failed write raises through: the caller sees the error
                    # but the old file (if any) is intact — never half-written.
                    await _write_cache_atomic(cache_file, data)
                if results is not None and not results and collector is not None:
                    # An empty search result set counts as an empty outcome.
                    collector.record_empty_result(family)
                return data
        except aiohttp.ClientError as e:
            logger.warning("Error fetching %s: %s", url, e)
            if collector is not None:
                collector.record_network_error(family)
            return None

    return None


def _normalize_person_name(name: str) -> str:
    normalized = unicodedata.normalize("NFKD", name)
    ascii_name = "".join(char for char in normalized if not unicodedata.combining(char))
    return " ".join(ascii_name.lower().split())


_DEPT_PRIORITY = {
    "director": ["Directing", "Writing", "Production"],
    "actor": ["Acting"],
}


def _exact_name_matches(results: List[Dict[str, Any]], normalized_name: str) -> List[Dict[str, Any]]:
    return [
        r for r in results
        if _normalize_person_name(str(r.get("name") or "")) == normalized_name
    ]


def _triage_by_role(results: List[Dict[str, Any]], role: Optional[str]) -> List[Dict[str, Any]]:
    """Stable-sort: candidates whose known_for_department matches the target role come first."""
    if not role:
        return results
    priority = _DEPT_PRIORITY.get(role)
    if not priority:
        return results
    def rank(r: Dict[str, Any]) -> int:
        dept = r.get("known_for_department") or ""
        return priority.index(dept) if dept in priority else len(priority)
    return sorted(results, key=rank)


async def search_person_with_fallback(
    session: aiohttp.ClientSession,
    name: str,
    role: Optional[Literal["director", "actor"]] = None,
) -> Optional[Dict[str, Any]]:
    """Search TMDB person by name with a 3-step fallback strategy.

    If ``role`` is provided, exact-name matches are reordered so candidates
    whose ``known_for_department`` fits the role (e.g. ``"Directing"`` for
    directors) appear first. Step 2 (``language=en-US``) and step 3
    (diacritic-stripped query) run whenever step 1 fails to produce any
    exact-name match — not just when step 1 returned an empty result set.
    """
    try:
        normalized_name = _normalize_person_name(name)
        logger.debug("[tmdb-search] '%s' → normalized='%s' role=%s", name, normalized_name, role)

        # Step 1: search with exact name
        exact_data = await tmdb_get(session, "search/person", {"query": name})
        exact_results = exact_data.get("results", []) if exact_data else []
        exact_matches = _exact_name_matches(exact_results, normalized_name)
        logger.debug(
            "[tmdb-search] step1 exact: %s results, %s exact-name matches",
            len(exact_results), len(exact_matches),
        )
        if exact_matches:
            triaged = _triage_by_role(exact_matches, role)
            other_results = [r for r in exact_results if r not in exact_matches]
            return {**exact_data, "results": triaged + other_results}

        # Step 2: retry with language=en-US whenever step 1 produced no exact match
        en_data = await tmdb_get(session, "search/person", {"query": name, "language": "en-US"})
        en_results = en_data.get("results", []) if en_data else []
        en_matches = _exact_name_matches(en_results, normalized_name)
        logger.debug("[tmdb-search] step2 en-US: %s results, %s exact-name matches", len(en_results), len(en_matches))
        if en_matches:
            triaged = _triage_by_role(en_matches, role)
            other_results = [r for r in en_results if r not in en_matches]
            return {**en_data, "results": triaged + other_results}

        # Step 3: diacritic-stripped query (only when normalization actually changed the name)
        if normalized_name and normalized_name != name.lower().strip():
            normalized_data = await tmdb_get(session, "search/person", {"query": normalized_name})
            n_results = normalized_data.get("results", []) if normalized_data else []
            n_matches = _exact_name_matches(n_results, normalized_name)
            logger.debug("[tmdb-search] step3 normalized: %s results, %s exact-name matches", len(n_results), len(n_matches))
            if n_matches:
                triaged = _triage_by_role(n_matches, role)
                other_results = [r for r in n_results if r not in n_matches]
                return {**normalized_data, "results": triaged + other_results}
            if n_results:
                return {**normalized_data, "results": _triage_by_role(n_results, role)}

        # No exact-name match anywhere — fall back to role-triaged step-1 results
        # so the caller still gets the best-guess candidate.
        if exact_results:
            return {**exact_data, "results": _triage_by_role(exact_results, role)}
        if en_results:
            return {**en_data, "results": _triage_by_role(en_results, role)}

        logger.debug("[tmdb-search] '%s' no candidates anywhere", name)
        return exact_data
    except Exception as exc:
        logger.warning("[tmdb-search] '%s' crashed: %s", name, exc)
        return None


def _name_match(query_name: str, candidate_name: str) -> bool:
    """Fuzzy name comparison: diacritic-stripped, case-insensitive, token overlap >= 80%."""
    q_tokens = set(_normalize_person_name(query_name).split())
    c_tokens = set(_normalize_person_name(candidate_name).split())
    if not q_tokens or not c_tokens:
        return False
    overlap = len(q_tokens & c_tokens)
    return (overlap / max(len(q_tokens), len(c_tokens))) >= 0.8


async def find_person_by_film_credit(
    session: aiohttp.ClientSession,
    person_name: str,
    films: list[dict],
) -> Optional[str]:
    """Reverse-lookup a person's TMDB profile_path via film credits.

    When search/person returns no results, try searching for films the
    person is known for and extracting their profile_path from the
    film's credits response (crew + cast).

    Returns the profile_path string or None.
    """
    for film in films[:3]:
        year = film.get("year")
        params: dict = {"query": str(film.get("title", ""))}
        if year:
            try:
                params["year"] = int(year)
            except (ValueError, TypeError):
                pass
        movie = await tmdb_get(session, "search/movie", params)
        if not movie or not movie.get("results"):
            # Retry without year constraint
            movie = await tmdb_get(session, "search/movie", {"query": str(film.get("title", ""))})
            if not movie or not movie.get("results"):
                continue
        tmdb_id = movie["results"][0]["id"]
        credits = await tmdb_get(session, f"movie/{tmdb_id}/credits", {})
        if not credits:
            continue
        # Check crew first (for directors)
        for member in credits.get("crew", []):
            if _name_match(person_name, member.get("name", "")):
                pp = member.get("profile_path")
                if isinstance(pp, str) and pp:
                    return pp
        # Then cast (for actors)
        for member in credits.get("cast", []):
            if _name_match(person_name, member.get("name", "")):
                pp = member.get("profile_path")
                if isinstance(pp, str) and pp:
                    return pp
    return None


async def resolve_tmdb_id(
    session: aiohttp.ClientSession,
    title: str,
    year: Optional[int] = None,
) -> Optional[int]:
    """Find TMDB movie ID by title (and optional year)."""
    query_params: dict = {"query": title, "include_adult": "false"}
    if year and not pd.isna(year):
        query_params["year"] = int(year)

    try:
        data = await tmdb_get(session, "search/movie", query_params)
        results = data.get("results", []) if data else []

        if not results and year:
            data = await tmdb_get(session, "search/movie", {"query": title, "include_adult": "false"})
            results = data.get("results", []) if data else []

        return results[0]["id"] if results else None
    except Exception:
        return None


async def fetch_comprehensive_film_details(
    session: aiohttp.ClientSession,
    tmdb_id: int,
) -> Dict[str, Any]:
    """Fetch details, credits, and keywords for a single film concurrently."""
    if pd.isna(tmdb_id):
        return {}

    try:
        details, credits, keywords = await asyncio.gather(
            tmdb_get(session, f"movie/{int(tmdb_id)}"),
            tmdb_get(session, f"movie/{int(tmdb_id)}/credits"),
            tmdb_get(session, f"movie/{int(tmdb_id)}/keywords"),
        )

        if not details:
            return {}

        directors: List[str] = [c["name"] for c in credits.get("crew", []) if c["job"] == "Director"] if credits else []
        writers: List[str] = [c["name"] for c in credits.get("crew", []) if c["job"] in ["Writer", "Screenplay", "Story"]] if credits else []
        cast: List[str] = [c["name"] for c in credits.get("cast", [])[:10]] if credits else []
        genres: List[str] = [g["name"] for g in details.get("genres", [])]
        countries: List[str] = [c["name"] for c in details.get("production_countries", [])]
        production_countries = details.get("production_countries", [])
        companies: List[str] = [c["name"] for c in details.get("production_companies", [])]
        keyword_list: List[str] = [k["name"] for k in keywords.get("keywords", [])] if keywords else []
        keywords_full = keywords.get("keywords", []) if keywords else []

        release_date: str = details.get("release_date", "")
        decade: Optional[str] = None
        if release_date:
            try:
                year_val = int(release_date[:4])
                decade = f"{(year_val // 10) * 10}s"
            except ValueError:
                pass

        return {
            "tmdb_id": tmdb_id,
            "title": details.get("title", ""),
            "original_title": details.get("original_title", ""),
            "release_date": release_date,
            "runtime": details.get("runtime"),
            "language": details.get("original_language"),
            "budget": details.get("budget", 0),
            "revenue": details.get("revenue", 0),
            "popularity": details.get("popularity", 0.0),
            "vote_average": details.get("vote_average", 0),
            "vote_count": details.get("vote_count", 0),
            "decade": decade,
            "tagline": details.get("tagline", ""),
            "overview": details.get("overview", ""),
            "director": directors[0] if directors else None,
            "directors": directors,
            "writers": writers,
            "cast": cast,
            "genres": genres,
            "countries": countries,
            "production_countries": production_countries,
            "companies": companies,
            "keywords": keyword_list,
            "keywords_full": keywords_full,
            "adult": details.get("adult", False),
            "status": details.get("status", ""),
            "poster_path": details.get("poster_path", ""),
            "backdrop_path": details.get("backdrop_path", ""),
        }
    except Exception as e:
        logger.warning("Error fetching comprehensive details for ID %s: %s", tmdb_id, e)
        return {"tmdb_id": tmdb_id}
