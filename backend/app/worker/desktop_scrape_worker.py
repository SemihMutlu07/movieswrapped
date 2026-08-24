"""
Outbound desktop scrape worker.

Runs on the always-on home desktop (residential IP, no public exposure). It
polls the public backend for queued scrape jobs, runs the SAME local scrape +
analysis pipeline used by the synchronous route (app.services.scrape_pipeline),
and posts the final stats back. Public users keep using the normal site; the
heavy Letterboxd HTML scrape just executes here instead of on Render.

Run from the backend/ directory (so .env and runs/ resolve correctly):

    WORKER_BACKEND_URL=https://your-backend.example.com \
    WORKER_TOKEN=your-shared-secret \
    WORKER_SELF_TEST_ON_START=1 \
    python -m app.worker.desktop_scrape_worker

TMDB_API_KEY must also be set (via .env or env) — the analysis pipeline enriches
films through TMDB exactly as the server does.
"""
from __future__ import annotations

import asyncio
from contextlib import suppress
from datetime import datetime, timezone
import json
import logging
import os
from pathlib import Path
import subprocess
import sys
from threading import Lock
from time import monotonic
from typing import Any

from dotenv import load_dotenv
load_dotenv()

import aiohttp

from app.worker.worker_config import WORKER_ID, WORKER_VERSION
from app.services.scrape_pipeline import (
    ScrapeAnalysisEmpty,
    scrape_and_analyze,
)
from app.services.tmdb_telemetry import TmdbCollector, collecting
from app.services.recommender import compare_watchlist_sets, enrich_films_concurrent, film_key, public_film
from app.services.scraper import scrape_films_grid, scrape_watchlist, scrape_profile_sources, scrape_avatar_only

logging.basicConfig(
    level=getattr(logging, os.getenv("LOG_LEVEL", "INFO").upper(), logging.INFO),
    format="%(levelname)-8s [%(name)s] %(message)s",
)
logger = logging.getLogger("letterboxd_wrapped.desktop_worker")

POLL_INTERVAL = float(os.getenv("WORKER_POLL_INTERVAL", "5"))
HEARTBEAT_INTERVAL = float(os.getenv("WORKER_HEARTBEAT_INTERVAL", "30"))
# Cap for the exponential heartbeat backoff — never poll the backend more
# than once per this many seconds while it is down.
HEARTBEAT_MAX_BACKOFF = float(os.getenv("WORKER_HEARTBEAT_MAX_BACKOFF", "300"))
# Short timeout for the small control-plane calls; the scrape itself is unbounded.
CONTROL_TIMEOUT = aiohttp.ClientTimeout(total=15)
TRACE_FLUSH_INTERVAL = float(os.getenv("WORKER_TRACE_FLUSH_INTERVAL", "5"))
WORKER_PROTOCOL_VERSION = 4
# Watchlist-compare enrichment has its own timeout (the scrape itself is unbounded).
WATCHLIST_ENRICH_TIMEOUT = 120
# Heartbeat metadata only — the poll loop already runs one job at a time.
# Backend does not enforce this value as a claim cap.
MAX_CONCURRENCY = 1
# Incremented while a job is being processed so heartbeats report load.
_ACTIVE_JOBS = 0
# TMDB telemetry collector for the in-flight job (None when idle). The worker
# processes one job at a time, but the counters themselves live on a per-job
# TmdbCollector bound via ContextVar — never module-global — so concurrent
# jobs would each keep their own numbers even if that changes.
_CURRENT_JOB_TMDB: TmdbCollector | None = None
OUTBOX_DIR = Path(os.getenv("WORKER_OUTBOX_DIR", ".worker_outbox"))
PROCESS_STARTED_AT = datetime.now(timezone.utc).isoformat()


def _set_windows_wakelock(enable: bool) -> None:
    """Keep Windows from idle-sleeping while the worker runs.

    The desktop worker only earns its keep if the always-on machine stays awake
    to poll for jobs; ES_SYSTEM_REQUIRED blocks *automatic* idle sleep for the
    life of this process. No-op off Windows so the same code runs on the Fedora
    dev box and on Render.

    ponytail: idle-sleep only — a user/lid-forced sleep still sleeps; switch to a
    powercfg override if that ever becomes the problem.
    """
    if sys.platform != "win32":
        return
    import ctypes

    ES_CONTINUOUS = 0x80000000
    ES_SYSTEM_REQUIRED = 0x00000001
    flags = ES_CONTINUOUS | (ES_SYSTEM_REQUIRED if enable else 0)
    try:
        ctypes.windll.kernel32.SetThreadExecutionState(flags)  # type: ignore[attr-defined]
        logger.info("Windows wakelock %s", "enabled" if enable else "released")
    except Exception as exc:  # noqa: BLE001 — wakelock is best-effort, never fatal
        logger.warning("Windows wakelock call failed: %s", exc)


class WorkerConfig:
    def __init__(self) -> None:
        self.base_url = (os.getenv("WORKER_BACKEND_URL") or "").rstrip("/")
        self.token = os.getenv("WORKER_TOKEN") or ""
        self.self_test_on_start = os.getenv("WORKER_SELF_TEST_ON_START", "").lower() in {"1", "true", "yes", "on"}
        self.self_test_username = (os.getenv("WORKER_SELF_TEST_USERNAME") or "semihmutsuz").strip().lower()

    @property
    def headers(self) -> dict:
        return {"X-Worker-Token": self.token}

    def validate(self) -> None:
        missing = [
            name for name, val in (("WORKER_BACKEND_URL", self.base_url), ("WORKER_TOKEN", self.token))
            if not val
        ]
        if missing:
            raise SystemExit(f"Missing required env: {', '.join(missing)}")


def _git_value(*args: str) -> str | None:
    try:
        result = subprocess.run(
            ["git", *args],
            cwd=Path(__file__).resolve().parents[3],
            check=False,
            capture_output=True,
            text=True,
            timeout=3,
        )
    except Exception:
        return None
    value = result.stdout.strip()
    return value or None


def _worker_meta(cfg: WorkerConfig) -> dict[str, Any]:
    meta: dict[str, Any] = {
        "worker_id": WORKER_ID,
        "version": WORKER_VERSION,
        "active_jobs": _ACTIVE_JOBS,
        "max_concurrency": MAX_CONCURRENCY,
        "worker_protocol_version": WORKER_PROTOCOL_VERSION,
        "worker_git_sha": os.getenv("WORKER_GIT_SHA") or _git_value("rev-parse", "--short", "HEAD"),
        "worker_branch": os.getenv("WORKER_BRANCH") or _git_value("branch", "--show-current"),
        "worker_started_at": PROCESS_STARTED_AT,
        "poll_interval": POLL_INTERVAL,
        "heartbeat_interval": HEARTBEAT_INTERVAL,
        "trace_flush_interval": TRACE_FLUSH_INTERVAL,
        "self_test_on_start": cfg.self_test_on_start,
        "self_test_username": cfg.self_test_username,
        "scrape_transport": "direct_cloudscraper",
    }
    # Live TMDB counters for the in-flight job (aggregate integers only — no
    # usernames, titles, queries, keys). Absent when the worker is idle.
    if _CURRENT_JOB_TMDB is not None:
        meta["tmdb_live"] = {
            key: getattr(_CURRENT_JOB_TMDB, key)
            for key in (
                "cache_hits", "cache_misses", "outbound_requests",
                "empty_results", "network_errors", "retries", "tmdb_429s",
            )
        }
    return meta


class TraceBuffer:
    def __init__(self) -> None:
        self.started = monotonic()
        self._events: list[dict[str, Any]] = []
        self._pending: list[dict[str, Any]] = []
        self._lock = Lock()
        self._stage_started: dict[str, float] = {}
        self._timings: dict[str, float] = {}
        # Set by add() when a *_done stage lands; the flush loop wakes on it so
        # diary_done/grid_done samples reach the browser immediately instead of
        # waiting out TRACE_FLUSH_INTERVAL (the "5s lag feels like stutter" fix).
        self._done_pending = False

    def add(
        self,
        stage: str,
        message: str,
        metrics: dict[str, Any] | None = None,
        *,
        level: str = "info",
    ) -> None:
        elapsed = round(monotonic() - self.started, 1)
        metrics = dict(metrics or {})
        if stage.endswith("_started"):
            self._stage_started[stage.removesuffix("_started")] = elapsed
        if stage.endswith("_done"):
            key = stage.removesuffix("_done")
            started = self._stage_started.get(key)
            if started is not None:
                self._timings[f"{key}_seconds"] = round(elapsed - started, 1)
        for timing_key in ("scrape_seconds", "analysis_seconds", "postback_seconds"):
            if isinstance(metrics.get(timing_key), (int, float)):
                self._timings[timing_key] = round(float(metrics[timing_key]), 1)

        event = {
            "stage": stage,
            "message": message,
            "elapsed_seconds": elapsed,
            "level": level,
            "metrics": metrics,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        with self._lock:
            self._events.append(event)
            self._pending.append(event)
            if stage.endswith("_done"):
                self._done_pending = True

    def drain(self) -> list[dict[str, Any]]:
        with self._lock:
            events = list(self._pending)
            self._pending.clear()
            self._done_pending = False
            return events

    def done_pending(self) -> bool:
        """True when a *_done event is buffered but not yet flushed.

        Cheap, lock-guarded, polled by the flush loop so a done stage (e.g.
        diary_done with its sample) triggers an immediate POST instead of
        waiting out TRACE_FLUSH_INTERVAL.
        """
        with self._lock:
            return self._done_pending

    def snapshot(self) -> list[dict[str, Any]]:
        with self._lock:
            return list(self._events)

    def timings(self) -> dict[str, float]:
        return dict(self._timings)


def _failure_message(username: str, exc: Exception) -> str:
    """Map a pipeline exception to a frontend-readable error string."""
    if isinstance(exc, ScrapeAnalysisEmpty):
        if exc.period_empty:
            return f"No diary films found for @{username} in the selected period."
        if exc.scraper_ok:
            return f"Scraped @{username} but the analysis came back empty. Please try again."
        return f"No public films found for @{username}. The profile may be private, empty, or blocked by Letterboxd."
    if isinstance(exc, ValueError):
        return str(exc)
    return f"Letterboxd returned an unexpected response for @{username}. Please try again later."


def _failure_telemetry(exc: Exception, duration_seconds: float) -> dict:
    """Classify failures enough for the admin dashboard and future fix loops."""
    if isinstance(exc, ScrapeAnalysisEmpty):
        if exc.period_empty:
            error_stage = "period_empty"
            error_code = "no_films_in_period"
        else:
            error_stage = "analysis_empty" if exc.scraper_ok else "scrape_empty"
            error_code = "analysis_failed" if exc.scraper_ok else "no_films"
    elif isinstance(exc, ValueError):
        error_stage = "letterboxd_or_scrape"
        error_code = getattr(exc, "error_code", "scrape_failed")
    else:
        error_stage = "pipeline_unexpected"
        error_code = "scrape_failed"

    return {
        "duration_seconds": duration_seconds,
        "error_type": type(exc).__name__,
        "error_stage": error_stage,
        "error_code": error_code,
    }


async def _heartbeat_loop(session: aiohttp.ClientSession, cfg: WorkerConfig) -> None:
    """Periodic liveness ping with exponential backoff on failure.

    A dead backend must never kill the worker: on any failure the wait doubles
    (capped at HEARTBEAT_MAX_BACKOFF) and a successful ping resets it to the
    nominal interval.
    """
    delay = HEARTBEAT_INTERVAL
    while True:
        try:
            async with session.post(f"{cfg.base_url}/api/worker/heartbeat", headers=cfg.headers, json=_worker_meta(cfg), timeout=CONTROL_TIMEOUT) as r:
                if r.status != 200:
                    logger.warning("Heartbeat rejected: HTTP %s", r.status)
                    delay = min(delay * 2, HEARTBEAT_MAX_BACKOFF)
                else:
                    if delay != HEARTBEAT_INTERVAL:
                        logger.info("Heartbeat accepted again — resetting to %ss interval", HEARTBEAT_INTERVAL)
                    delay = HEARTBEAT_INTERVAL
        except Exception as exc:
            logger.warning("Heartbeat failed: %s", exc)
            delay = min(delay * 2, HEARTBEAT_MAX_BACKOFF)
        await asyncio.sleep(delay)


async def _report_lifecycle(session: aiohttp.ClientSession, cfg: WorkerConfig, event: str, payload: dict | None = None) -> None:
    await _post(session, cfg, f"/api/worker/{event}", payload or {})


async def _run_startup_self_test(session: aiohttp.ClientSession, cfg: WorkerConfig) -> None:
    username = cfg.self_test_username
    started = monotonic()
    logger.info("Running startup self-test for @%s", username)
    try:
        stats = await scrape_and_analyze(session, username)
    except Exception as exc:  # noqa: BLE001 - report the failed smoke test and continue polling jobs
        message = _failure_message(username, exc)
        await _post(
            session,
            cfg,
            "/api/worker/self-test",
            {
                "username": username,
                "ok": False,
                "message": message,
                "duration_seconds": round(monotonic() - started, 1),
            },
        )
        logger.warning("Startup self-test failed for @%s: %s", username, exc)
        return

    total_films = stats.get("total_films")
    await _post(
        session,
        cfg,
        "/api/worker/self-test",
        {
            "username": username,
            "ok": True,
            "message": "Startup scrape self-test passed.",
            "total_films": total_films,
            "duration_seconds": round(monotonic() - started, 1),
        },
    )
    logger.info("Startup self-test passed for @%s (films=%s)", username, total_films)


def _lease_fields(job: dict) -> dict:
    token = job.get("lease_token")
    return {"lease_token": token} if isinstance(token, str) and token else {}


async def _process_watchlist_job(session: aiohttp.ClientSession, cfg: WorkerConfig, job: dict) -> None:
    task_id = job["task_id"]
    job_type = job["job_type"]
    usernames = job["usernames"]
    options = job.get("options") or {}
    logger.info("Processing watchlist job %s type=%s users=%s", task_id, job_type, "/".join(usernames))

    try:
        if job_type == "watchlist_compare":
            first, second = usernames[0], usernames[1]
            first_wl, second_wl = await asyncio.gather(
                scrape_watchlist(first, max_pages=40),
                scrape_watchlist(second, max_pages=40),
            )
            if options.get("raw_only"):
                # /api/recommend-from-compare and /api/watchlist-enrich claim
                # jobs this way and do their own (differently-scoped) compare +
                # enrichment on the raw lists — skip the full 3-way enrichment
                # below, it would just be wasted TMDB calls on this path.
                payload = {"first_watchlist": first_wl, "second_watchlist": second_wl}
            else:
                result = compare_watchlist_sets(first_wl, second_wl)
                common, first_only, second_only = await asyncio.wait_for(
                    asyncio.gather(
                        enrich_films_concurrent(session, result["common"], limit=50),
                        enrich_films_concurrent(session, result["first_only"], limit=50),
                        enrich_films_concurrent(session, result["second_only"], limit=50),
                    ),
                    timeout=WATCHLIST_ENRICH_TIMEOUT,
                )
                result.update(
                    common=[public_film(f) for f in common],
                    first_only=[public_film(f) for f in first_only],
                    second_only=[public_film(f) for f in second_only],
                )
                payload = {"comparison": result}
        elif job_type == "find_film":
            wl_lists = await asyncio.gather(*(scrape_watchlist(u, max_pages=20) for u in usernames))
            watchlists = dict(zip(usernames, wl_lists))
            # Watched films only FILTER the watchlist intersection — if that
            # intersection is already empty, skip the expensive watched scrape.
            common = set.intersection(
                *({film_key(f) for f in wl if f.get("title")} for wl in wl_lists)
            )
            if common:
                # Grid is a superset of the diary and membership is all the
                # filter needs, so a single grid scrape per user is enough.
                # If a heavy user's grid is truncated at 25 pages, the worst
                # outcome is one long-ago watched film slipping through.
                grids = await asyncio.gather(*(scrape_films_grid(u, max_pages=25) for u in usernames))
                watched = dict(zip(usernames, grids))
            else:
                watched = {u: [] for u in usernames}
            payload = {"watchlists": watchlists, "watched": watched}
        else:  # date_night
            first, second = usernames[0], usernames[1]
            first_src, second_src, first_wl, second_wl = await asyncio.gather(
                scrape_profile_sources(first, max_pages=25),
                scrape_profile_sources(second, max_pages=25),
                scrape_watchlist(first, max_pages=25),
                scrape_watchlist(second, max_pages=25),
            )
            payload = {
                "first_diary": first_src.diary,
                "first_grid": first_src.grid,
                "second_diary": second_src.diary,
                "second_grid": second_src.grid,
                "first_watchlist": first_wl,
                "second_watchlist": second_wl,
            }
    except Exception as exc:  # noqa: BLE001
        message = str(exc) if isinstance(exc, ValueError) else f"Scrape failed for {'/'.join(usernames)}."
        logger.warning("Watchlist job %s failed: %s", task_id, exc)
        payload = {"message": message, "telemetry": _failure_telemetry(exc, 0.0), **_lease_fields(job)}
        outbox_path = _write_outbox(task_id, "watchlist-failed", f"/api/worker/watchlist/{task_id}/failed", payload)
        await _send_outbox_item(session, cfg, outbox_path)
        return

    payload = {**payload, **_lease_fields(job)}
    outbox_path = _write_outbox(task_id, "watchlist-complete", f"/api/worker/watchlist/{task_id}/complete", payload)
    if await _send_outbox_item(session, cfg, outbox_path):
        logger.info("Watchlist job %s complete", task_id)


async def _claim_next_fair(session: aiohttp.ClientSession, cfg: WorkerConfig) -> dict | None:
    params = {"worker_id": WORKER_ID}
    async with session.get(
        f"{cfg.base_url}/api/worker/next",
        headers=cfg.headers,
        params=params,
        timeout=CONTROL_TIMEOUT,
    ) as r:
        if r.status == 409:
            body = await r.text()
            logger.warning("Claim blocked by backend (version/lease): %s", body)
            return None
        if r.status != 200:
            logger.warning("Fair claim failed: HTTP %s", r.status)
            return None
        data = await r.json()
        if data.get("paused"):
            logger.info("Worker paused by control plane — not claiming")
            return None
        return data.get("job")


def _outbox_path(task_id: str, kind: str) -> Path:
    safe_task = "".join(ch for ch in task_id if ch.isalnum() or ch in {"-", "_"}) or "unknown"
    return OUTBOX_DIR / f"{safe_task}-{kind}.json"


def _write_outbox(task_id: str, kind: str, path: str, payload: dict) -> Path:
    OUTBOX_DIR.mkdir(parents=True, exist_ok=True)
    outbox_path = _outbox_path(task_id, kind)
    outbox_path.write_text(json.dumps({"path": path, "payload": payload}, ensure_ascii=False, indent=2), encoding="utf-8")
    return outbox_path


async def _send_outbox_item(session: aiohttp.ClientSession, cfg: WorkerConfig, outbox_path: Path) -> bool:
    try:
        item = json.loads(outbox_path.read_text(encoding="utf-8"))
        path = item["path"]
        payload = item["payload"]
    except Exception as exc:
        # Quarantine instead of leaving in place: _flush_outbox retries every
        # *.json forever, so a corrupt/0-byte file would re-log this each cycle.
        quarantine_path = outbox_path.parent / "quarantine" / outbox_path.name
        try:
            quarantine_path.parent.mkdir(parents=True, exist_ok=True)
            outbox_path.replace(quarantine_path)
            logger.error("Outbox item %s is unreadable (%s); moved to %s for inspection", outbox_path, exc, quarantine_path)
        except OSError as move_exc:
            logger.error("Outbox item %s is unreadable (%s) and could not be quarantined: %s", outbox_path, exc, move_exc)
        return False
    ok = await _post(session, cfg, path, payload)
    if ok:
        with suppress(FileNotFoundError):
            outbox_path.unlink()
    return ok


async def _flush_outbox(session: aiohttp.ClientSession, cfg: WorkerConfig) -> None:
    if not OUTBOX_DIR.exists():
        return
    for outbox_path in sorted(OUTBOX_DIR.glob("*.json")):
        await _send_outbox_item(session, cfg, outbox_path)


async def _flush_trace(
    session: aiohttp.ClientSession,
    cfg: WorkerConfig,
    task_id: str,
    trace: TraceBuffer,
    lease: dict | None = None,
) -> None:
    events = trace.drain()
    if events:
        payload = {"events": events, **(lease or {})}
        await _post(session, cfg, f"/api/worker/scrape/{task_id}/event", payload)


async def _trace_flush_loop(
    session: aiohttp.ClientSession,
    cfg: WorkerConfig,
    task_id: str,
    trace: TraceBuffer,
    lease: dict | None = None,
) -> None:
    while True:
        # Flush immediately when a *_done stage landed (diary_done, grid_done,
        # reviews_done, scrape_done, analysis_*): the wait UI is gated on those
        # samples, and letting them sit for TRACE_FLUSH_INTERVAL reads as
        # stutter. Page events still batch on the interval so we do not POST
        # on every diary_page/grid_page.
        if trace.done_pending():
            await _flush_trace(session, cfg, task_id, trace, lease)
            continue
        await asyncio.sleep(TRACE_FLUSH_INTERVAL)
        await _flush_trace(session, cfg, task_id, trace, lease)


async def _process_job(session: aiohttp.ClientSession, cfg: WorkerConfig, job: dict) -> None:
    global _CURRENT_JOB_TMDB
    task_id = job["task_id"]
    username = job["username"]
    avatar_only = bool(job.get("avatar_only"))
    options = job.get("options") if isinstance(job.get("options"), dict) else {}
    analysis_period = str(options.get("analysis_period") or "lifetime")
    lease = _lease_fields(job)
    started = monotonic()
    trace = TraceBuffer()
    tmdb_collector = TmdbCollector()
    _CURRENT_JOB_TMDB = tmdb_collector
    try:
        await _process_job_inner(
            session, cfg, job,
            task_id=task_id, username=username, avatar_only=avatar_only,
            options=options, analysis_period=analysis_period, lease=lease,
            started=started, trace=trace, tmdb_collector=tmdb_collector,
        )
    finally:
        _CURRENT_JOB_TMDB = None


async def _process_job_inner(
    session: aiohttp.ClientSession,
    cfg: WorkerConfig,
    job: dict,
    *,
    task_id: str,
    username: str,
    avatar_only: bool,
    options: dict,
    analysis_period: str,
    lease: dict,
    started: float,
    trace: TraceBuffer,
    tmdb_collector: TmdbCollector,
) -> None:
    trace.add(
        "worker_received",
        "Worker received scrape job",
        {
            "username": username,
            "scrape_transport": "direct_cloudscraper",
            "avatar_only": avatar_only,
            "analysis_period": analysis_period,
        },
    )
    trace_flush = asyncio.create_task(_trace_flush_loop(session, cfg, task_id, trace, lease))
    logger.info("Processing %s job %s for @%s", "avatar" if avatar_only else "scrape", task_id, username)
    try:
        # Bind this job's collector for the pipeline: tmdb_get reports every
        # cache hit/miss/request to THIS collector only (ContextVar-scoped).
        if avatar_only:
            stats: dict = {"profile_avatar_url": await scrape_avatar_only(username)}
        else:
            with collecting(tmdb_collector):
                stats = await scrape_and_analyze(
                    session,
                    username,
                    trace_callback=trace.add,
                    analysis_period=analysis_period,
                )
            # scrape_and_analyze embeds the same snapshot in stats; keep the
            # postback-level telemetry authoritative even on partial failures.
            stats.setdefault("tmdb_telemetry", tmdb_collector.snapshot())
    except Exception as exc:  # noqa: BLE001 — any failure must report back, not crash the loop
        message = _failure_message(username, exc)
        duration_seconds = round(monotonic() - started, 1)
        telemetry = _failure_telemetry(exc, duration_seconds)
        telemetry["postback_seconds"] = 0.0
        telemetry.update(trace.timings())
        telemetry["tmdb"] = tmdb_collector.snapshot()
        trace.add(telemetry["error_stage"], message, {"error_type": telemetry["error_type"]}, level="error")
        trace.add("postback_started", "Posting failure to backend")
        logger.warning("Scrape job %s for @%s failed: %s", task_id, username, exc)
        await _flush_trace(session, cfg, task_id, trace, lease)
        trace_flush.cancel()
        with suppress(asyncio.CancelledError):
            await trace_flush
        payload = {
            "username": username,
            "message": message,
            "telemetry": telemetry,
            "trace_events": trace.snapshot(),
            **lease,
        }
        outbox_path = _write_outbox(task_id, "failed", f"/api/worker/scrape/{task_id}/failed", payload)
        if await _send_outbox_item(session, cfg, outbox_path):
            logger.info("Failure postback acknowledged for job %s", task_id)
        return

    duration_seconds = round(monotonic() - started, 1)
    trace.add("postback_started", "Posting result to backend")
    telemetry = {
        "duration_seconds": duration_seconds,
        "postback_seconds": 0.0,
        **trace.timings(),
        "tmdb": tmdb_collector.snapshot(),
    }
    await _flush_trace(session, cfg, task_id, trace, lease)
    trace_flush.cancel()
    with suppress(asyncio.CancelledError):
        await trace_flush
    payload = {
        "username": username,
        "stats": stats,
        "telemetry": telemetry,
        "trace_events": trace.snapshot(),
        **lease,
    }
    outbox_path = _write_outbox(task_id, "complete", f"/api/worker/scrape/{task_id}/complete", payload)
    if await _send_outbox_item(session, cfg, outbox_path):
        logger.info("Completion postback acknowledged for job %s", task_id)
    logger.info(
        "Completed scrape job %s for @%s (films=%s, duration=%ss)",
        task_id,
        username,
        stats.get("total_films"),
        duration_seconds,
    )


async def _post(session: aiohttp.ClientSession, cfg: WorkerConfig, path: str, payload: dict) -> bool:
    try:
        async with session.post(f"{cfg.base_url}{path}", headers=cfg.headers, json=payload, timeout=CONTROL_TIMEOUT) as r:
            if r.status != 200:
                logger.error("POST %s rejected: HTTP %s", path, r.status)
                return False
            return True
    except Exception as exc:
        logger.error("POST %s failed: %s", path, exc)
        return False


async def run() -> None:
    global _ACTIVE_JOBS
    cfg = WorkerConfig()
    cfg.validate()
    _set_windows_wakelock(True)
    logger.info(
        "Desktop scrape worker starting — backend=%s poll=%ss transport=direct_cloudscraper",
        cfg.base_url,
        POLL_INTERVAL,
    )

    # Set process-wide default ThreadPoolExecutor limit to prevent connection spikes from concurrent scraping threads.
    # ponytail: limit thread count to 10 to keep concurrent scraping connections minimal.
    import concurrent.futures
    loop = asyncio.get_running_loop()
    loop.set_default_executor(concurrent.futures.ThreadPoolExecutor(max_workers=10))

    async with aiohttp.ClientSession(
        connector=aiohttp.TCPConnector(limit=100, limit_per_host=20)
    ) as session:
        await _report_lifecycle(
            session,
            cfg,
            "startup",
            _worker_meta(cfg),
        )
        if cfg.self_test_on_start:
            await _run_startup_self_test(session, cfg)
        heartbeat = asyncio.create_task(_heartbeat_loop(session, cfg))
        try:
            while True:
                try:
                    job = await _claim_next_fair(session, cfg)
                except Exception as exc:  # noqa: BLE001 — keep polling through transient backend errors
                    logger.warning("Poll error: %s", exc)
                    job = None

                if job is None:
                    await _flush_outbox(session, cfg)
                    await asyncio.sleep(POLL_INTERVAL)
                    continue

                # Process one job at a time (V1 — no concurrency).
                await _flush_outbox(session, cfg)
                _ACTIVE_JOBS += 1
                try:
                    if job.get("kind") == "watchlist":
                        await _process_watchlist_job(session, cfg, job)
                    else:
                        await _process_job(session, cfg, job)
                finally:
                    _ACTIVE_JOBS -= 1
        finally:
            heartbeat.cancel()
            with suppress(asyncio.CancelledError):
                await heartbeat
            await _report_lifecycle(session, cfg, "shutdown", {"reason": "worker_stopped"})
            _set_windows_wakelock(False)


if __name__ == "__main__":
    try:
        asyncio.run(run())
    except KeyboardInterrupt:
        logger.info("Desktop scrape worker stopped.")
