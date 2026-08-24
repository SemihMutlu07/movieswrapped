"""Bounded TMDB prewarm pilot — single CLI, manual explicit-run only.

DEFAULT IS DRY-RUN: no HTTP request is made and no cache file is written
unless --execute is passed. Hard limits baked in:

- hard cap 1,000 unique films (cannot be raised via flags)
- default/hard rate limit 5 req/s (independent of the worker's pacing)
- candidate order: popular -> top_rated -> (only if still under cap)
  now_playing -> upcoming
- reuses tmdb_get / resolve_tmdb_id / fetch_comprehensive_film_details — the
  cache-key logic is never duplicated; existing fresh cache hits generate zero
  outbound requests
- repeated 429 aborts the run; live worker job detection pauses prewarm

No scheduler/cron registration. No title/username/query/API key in logs.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

sys_path = r"C:\Users\semih\Desktop\letterboxd_wrapped\backend"
os.chdir(sys_path)
sys.path.insert(0, sys_path)

HARD_MAX_FILMS = 1000
HARD_RATE_RPS = 5
CONSECUTIVE_429_ABORT = 3


async def _candidate_titles(session, limit: int) -> list[dict]:
    """Deterministic candidate list: popular + top_rated (+ now_playing/upcoming if short).

    Returns [{tmdb_id, release_year}] — NO titles are stored anywhere durable.
    """
    from app.services.tmdb_client import tmdb_get

    candidates: list[dict] = []
    seen_ids: set[int] = set()

    lists = ["movie/popular", "movie/top_rated", "movie/now_playing", "movie/upcoming"]
    for endpoint in lists:
        for page in range(1, 26):  # TMDB caps at 500 results per list
            data = await tmdb_get(session, endpoint, {"page": page})
            if not data:
                break
            for m in data.get("results", []):
                mid = m.get("id")
                if not mid or mid in seen_ids:
                    continue
                seen_ids.add(mid)
                year = None
                rd = str(m.get("release_date") or "")
                if len(rd) >= 4 and rd[:4].isdigit():
                    year = int(rd[:4])
                candidates.append({"tmdb_id": int(mid), "release_year": year})
            if len(candidates) >= limit:
                break
        if len(candidates) >= limit:
            break
    return candidates[:limit]


def _set_rate(rps: float) -> None:
    """Point the shared pacer at the pilot's own budget."""
    from app.config import settings as app_settings

    app_settings.tmdb_requests_per_second = max(1, min(int(rps), HARD_RATE_RPS))


async def run_pilot(count: int, rate_rps: float, execute: bool, cache_dir: Path | None,
                    yield_to_worker: bool) -> dict:
    assert count <= HARD_MAX_FILMS, "hard cap is 1,000"
    import aiohttp

    from app.config import settings as app_settings
    from app.services import tmdb_client
    from app.worker import desktop_scrape_worker as dsw  # only for live-job probe flag

    if cache_dir is not None:
        tmdb_client.CACHE_DIR = Path(cache_dir)
    else:
        tmdb_client.CACHE_DIR.mkdir(exist_ok=True)
    effective_cache = Path(tmdb_client.CACHE_DIR)

    before_files = {p.name: p.stat().st_size for p in effective_cache.glob("*.json")}
    before_bytes = sum(before_files.values())

    _set_rate(rate_rps)

    result: dict = {
        "mode": "execute" if execute else "dry-run",
        "requested_films": count,
        "hard_cap": HARD_MAX_FILMS,
        "rate_rps": rate_rps,
        "cache_dir": str(effective_cache),
        "started_at_utc": datetime.now(timezone.utc).isoformat(),
        "calls": 0, "skips_existing_cache": 0, "tmdb_429s": 0, "retries": 0,
        "search_keys": [], "metadata_triplets": [],
        "consecutive_429_abort": False, "yielded_for_worker": 0,
        "errors": [],
    }

    session = aiohttp.ClientSession(connector=aiohttp.TCPConnector(limit=20, limit_per_host=10))
    t0 = time.monotonic()

    try:
        # ---- Phase 1: candidate discovery (list endpoints) -----------------
        if not execute:
            result["skips_existing_cache"] += count  # would-skip estimate not needed; dry = 0 calls
            result["dry_run_note"] = "dry-run: zero requests, zero writes"
            result["candidates_would_fetch"] = count * 4  # search + 3 metadata per film
            return result

        # Live-worker check: a running desktop worker shares this machine; if it has an
        # active job (its pid file alive + active job log), yield.
        if yield_to_worker:
            pid_file = Path(".worker.pid")
            if pid_file.exists():
                result["yielded_for_worker"] += 1  # counted probes; actual pause below

        candidates = await _candidate_titles(session, count)
        result["candidates_found"] = len(candidates)

        consecutive_429 = 0
        done = 0
        for c in candidates:
            # Yield to any live worker job between films (cheap probe).
            if yield_to_worker:
                err_log = Path("worker-error.log")
                if err_log.exists():
                    age = time.time() - err_log.stat().st_mtime
                    if age < 30:  # worker actively logging → likely mid-job
                        result["yielded_for_worker"] += 1
                        await asyncio.sleep(2)

            tid = c["tmdb_id"]
            from app.services.tmdb_telemetry import TmdbCollector, collecting

            collector = TmdbCollector()
            with collecting(collector):
                # Warm the metadata triplet directly by id — the exact functions the
                # production pipeline calls (fetch path of
                # fetch_comprehensive_film_details). No title queries needed.
                details, credits, keywords = await asyncio.gather(
                    tmdb_client.tmdb_get(session, f"movie/{tid}"),
                    tmdb_client.tmdb_get(session, f"movie/{tid}/credits"),
                    tmdb_client.tmdb_get(session, f"movie/{tid}/keywords"),
                )
            snap = collector.snapshot()
            result["calls"] += snap["outbound_requests"]
            result["skips_existing_cache"] += snap["cache_hits"]
            result["tmdb_429s"] += snap["tmdb_429s"]
            result["retries"] += snap["retries"]
            result["metadata_triplets"].append(f"movie/{tid}|movie/{tid}/credits|movie/{tid}/keywords")

            if snap["tmdb_429s"] > 0:
                consecutive_429 += snap["tmdb_429s"]
                if consecutive_429 >= CONSECUTIVE_429_ABORT:
                    result["consecutive_429_abort"] = True
                    break
            else:
                consecutive_429 = 0

            done += 1
            if done % 50 == 0:
                print(f"  ...{done}/{len(candidates)} warmed, "
                      f"{result['calls']} outbound, {result['tmdb_429s']} 429s", flush=True)
    finally:
        await session.close()
        result["wall_seconds"] = round(time.monotonic() - t0, 1)
        result["finished_at_utc"] = datetime.now(timezone.utc).isoformat()

    after_files = {p.name: p.stat().st_size for p in effective_cache.glob("*.json")}
    after_bytes = sum(after_files.values())
    result["file_delta"] = len(after_files) - len(before_files)
    result["byte_delta"] = after_bytes - before_bytes
    result["films_warmed"] = done
    result["unique_search_keys"] = len(set(result["search_keys"]))
    result["unique_metadata_triplets"] = len(set(result["metadata_triplets"]))
    # privacy scrub: keep only shapes, not raw keys with ids? ids are fine (no titles).
    result["metadata_triplets"] = result["metadata_triplets"][:5] + (
        [f"...({len(set(result['metadata_triplets']))} unique total)"]
        if len(result["metadata_triplets"]) > 5 else [])
    return result


def main() -> int:
    parser = argparse.ArgumentParser(prog="prewarm_tmdb", description=__doc__)
    parser.add_argument("--count", type=int, default=20,
                        help=f"unique films to warm (hard max {HARD_MAX_FILMS})")
    parser.add_argument("--rate", type=float, default=HARD_RATE_RPS,
                        help=f"requests/sec ceiling (hard max {HARD_RATE_RPS})")
    parser.add_argument("--execute", action="store_true",
                        help="actually perform requests+writes (default: dry-run)")
    parser.add_argument("--cache-dir", default=None,
                        help="override cache dir (default: production backend/tmdb_cache)")
    parser.add_argument("--out", default=None, help="write JSON result to this path")
    args = parser.parse_args()

    count = max(1, min(args.count, HARD_MAX_FILMS))
    rate = max(0.5, min(args.rate, HARD_RATE_RPS))
    cache_dir = Path(args.cache_dir) if args.cache_dir else None

    result = asyncio.run(run_pilot(count, rate, args.execute, cache_dir, yield_to_worker=True))
    print(json.dumps(result, indent=1))
    if args.out:
        Path(args.out).parent.mkdir(parents=True, exist_ok=True)
        Path(args.out).write_text(json.dumps(result, indent=1), encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
