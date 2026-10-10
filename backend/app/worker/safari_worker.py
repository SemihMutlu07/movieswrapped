"""Outbound curl_cffi Safari scrape worker for the always-on X370.

Run: ``python -m app.worker.safari_worker`` with
``~/.config/movieswrapped/worker.env`` loaded by systemd or by this process.

Polls Render. Never binds a port. One job at a time. Letterboxd HTML goes
through the existing curl_cffi Safari session in ``app.services.scraper``.
"""
from __future__ import annotations

import asyncio
from contextlib import suppress
from dataclasses import dataclass, field
import logging
from pathlib import Path
import os
import socket
import sys
from time import monotonic as time_monotonic
from typing import Any, Optional

import aiohttp
from dotenv import load_dotenv

ENV_PATH = Path.home() / ".config" / "movieswrapped" / "worker.env"
SCRAPE_TRANSPORT = "curl_cffi_safari"


def load_worker_env(path: Path | None = None) -> None:
    env_path = path or ENV_PATH
    if env_path.is_file():
        load_dotenv(env_path, override=False)


# systemd EnvironmentFile injects these before exec; load the file here too so
# `python -m app.worker.safari_worker` sees TMDB_API_KEY before Settings().
load_worker_env()

from app.config import settings  # noqa: E402
from app.services.scrape_pipeline import ScrapeAnalysisEmpty, scrape_and_analyze  # noqa: E402
from app.services.tmdb_telemetry import TmdbCollector, collecting  # noqa: E402

logger = logging.getLogger("letterboxd_wrapped.safari_worker")

POLL_INTERVAL = float(os.getenv("WORKER_POLL_INTERVAL", "5"))
HEARTBEAT_INTERVAL = float(os.getenv("WORKER_HEARTBEAT_INTERVAL", "30"))
CONTROL_TIMEOUT = aiohttp.ClientTimeout(total=30)
WORKER_ID = os.getenv("WORKER_ID") or f"x370-{socket.gethostname()}"


def _monotonic() -> float:
    return time_monotonic()


@dataclass
class WorkerConfig:
    base_url: str
    token: str
    tmdb_api_key: str

    @property
    def headers(self) -> dict[str, str]:
        return {"X-Worker-Token": self.token}


def read_config() -> WorkerConfig:
    load_worker_env()
    base = (os.getenv("API_BASE_URL") or os.getenv("WORKER_BACKEND_URL") or "").rstrip("/")
    token = os.getenv("WORKER_TOKEN") or ""
    tmdb = os.getenv("TMDB_API_KEY") or ""
    missing = [
        name
        for name, val in (("API_BASE_URL", base), ("WORKER_TOKEN", token), ("TMDB_API_KEY", tmdb))
        if not val
    ]
    if missing:
        raise SystemExit(f"Missing required env in {ENV_PATH}: {', '.join(missing)}")
    os.environ["TMDB_API_KEY"] = tmdb
    settings.tmdb_api_key = tmdb
    return WorkerConfig(base_url=base, token=token, tmdb_api_key=tmdb)


@dataclass
class TraceBuffer:
    started: float = field(default_factory=_monotonic)
    events: list[dict[str, Any]] = field(default_factory=list)
    pending: list[dict[str, Any]] = field(default_factory=list)

    def add(self, stage: str, message: str, metrics: Optional[dict[str, Any]] = None, level: str = "info") -> None:
        event = {
            "stage": stage,
            "message": message,
            "metrics": metrics or {},
            "level": level,
            "elapsed_seconds": round(_monotonic() - self.started, 1),
        }
        self.events.append(event)
        self.pending.append(event)

    def drain(self) -> list[dict[str, Any]]:
        batch = list(self.pending)
        self.pending.clear()
        return batch

    def snapshot(self) -> list[dict[str, Any]]:
        return list(self.events)


def _failure_payload(username: str, exc: Exception, duration_seconds: float) -> tuple[str, dict[str, Any]]:
    raw = str(exc)
    if isinstance(exc, ScrapeAnalysisEmpty):
        if exc.period_empty:
            code = "no_films_in_period"
            message = f"No diary films found for @{username} in the selected period."
        elif exc.scraper_ok:
            code = "analysis_failed"
            message = f"Scraped @{username} but analysis pipeline returned empty. Please try again."
        else:
            code = "no_films"
            message = (
                f"No public films found for @{username}. "
                "The profile may be private, empty, or temporarily blocked by Letterboxd."
            )
    elif "blocking automated access" in raw or "Just a moment" in raw:
        code = "scrape_blocked"
        message = raw
    elif "not found" in raw.lower():
        code = "user_not_found"
        message = raw
    elif "rate limit" in raw.lower():
        code = "rate_limit_exceeded"
        message = raw
    else:
        code = "scrape_failed"
        message = f"Letterboxd returned an unexpected response for @{username}. Try again later."
    telemetry = {
        "duration_seconds": duration_seconds,
        "error_code": code,
        "error_type": code,
        "error_stage": "scrape",
        "job_type": "scrape",
        "worker_id": WORKER_ID,
        "scrape_transport": SCRAPE_TRANSPORT,
    }
    return message, telemetry


async def _post(session: aiohttp.ClientSession, cfg: WorkerConfig, path: str, payload: dict) -> bool:
    try:
        async with session.post(
            f"{cfg.base_url}{path}", headers=cfg.headers, json=payload, timeout=CONTROL_TIMEOUT
        ) as resp:
            if resp.status != 200:
                logger.error("POST %s rejected: HTTP %s", path, resp.status)
                return False
            return True
    except Exception as exc:  # noqa: BLE001
        logger.error("POST %s failed: %s", path, exc)
        return False


def _heartbeat_payload() -> dict[str, Any]:
    return {
        "worker_id": WORKER_ID,
        "scrape_transport": SCRAPE_TRANSPORT,
        "max_concurrency": 1,
    }


async def _heartbeat_loop(session: aiohttp.ClientSession, cfg: WorkerConfig, stop: asyncio.Event) -> None:
    while not stop.is_set():
        await _post(session, cfg, "/api/worker/heartbeat", _heartbeat_payload())
        with suppress(asyncio.TimeoutError):
            await asyncio.wait_for(stop.wait(), timeout=HEARTBEAT_INTERVAL)


async def _claim(session: aiohttp.ClientSession, cfg: WorkerConfig) -> Optional[dict]:
    url = f"{cfg.base_url}/api/worker/next"
    try:
        async with session.get(
            url, headers=cfg.headers, params={"worker_id": WORKER_ID}, timeout=CONTROL_TIMEOUT
        ) as resp:
            if resp.status != 200:
                logger.error("claim rejected: HTTP %s", resp.status)
                return None
            body = await resp.json()
    except Exception as exc:  # noqa: BLE001
        logger.error("claim failed: %s", exc)
        return None
    job = body.get("job") if isinstance(body, dict) else None
    return job if isinstance(job, dict) else None


async def _flush_trace(
    session: aiohttp.ClientSession, cfg: WorkerConfig, task_id: str, trace: TraceBuffer, lease: dict
) -> None:
    events = trace.drain()
    if not events:
        return
    await _post(session, cfg, f"/api/worker/scrape/{task_id}/event", {"events": events, **lease})


async def _process_job(session: aiohttp.ClientSession, cfg: WorkerConfig, job: dict) -> None:
    task_id = str(job.get("task_id") or "")
    username = str(job.get("username") or "").strip().lower()
    options = job.get("options") if isinstance(job.get("options"), dict) else {}
    analysis_period = str(options.get("analysis_period") or "lifetime")
    lease = {"lease_token": job.get("lease_token")}
    trace = TraceBuffer()
    started = _monotonic()
    collector = TmdbCollector()
    trace.add(
        "worker_received",
        "Worker received scrape job",
        {"username": username, "scrape_transport": SCRAPE_TRANSPORT},
    )
    logger.info("Processing scrape job %s for @%s", task_id, username)
    try:
        with collecting(collector):
            stats = await scrape_and_analyze(
                session,
                username,
                trace_callback=trace.add,
                analysis_period=analysis_period,
                task_id=task_id,
            )
        stats.setdefault("tmdb_telemetry", collector.snapshot())
    except Exception as exc:  # noqa: BLE001 — loop must survive a bad profile
        duration = round(_monotonic() - started, 1)
        message, telemetry = _failure_payload(username, exc, duration)
        trace.add(telemetry["error_stage"], message, {"error_type": telemetry["error_type"]}, level="error")
        await _flush_trace(session, cfg, task_id, trace, lease)
        await _post(
            session,
            cfg,
            f"/api/worker/scrape/{task_id}/failed",
            {
                "username": username,
                "message": message,
                "telemetry": telemetry,
                "trace_events": trace.snapshot(),
                **lease,
            },
        )
        return

    duration = round(_monotonic() - started, 1)
    telemetry = {
        "duration_seconds": duration,
        "tmdb": collector.snapshot(),
        "job_type": "scrape",
        "worker_id": WORKER_ID,
        "scrape_transport": SCRAPE_TRANSPORT,
    }
    await _flush_trace(session, cfg, task_id, trace, lease)
    ok = await _post(
        session,
        cfg,
        f"/api/worker/scrape/{task_id}/complete",
        {
            "username": username,
            "stats": stats,
            "telemetry": telemetry,
            "trace_events": trace.snapshot(),
            **lease,
        },
    )
    if ok:
        logger.info(
            "Completed scrape job %s for @%s (films=%s, %ss)",
            task_id,
            username,
            stats.get("total_films"),
            duration,
        )


async def run() -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)-8s [%(name)s] %(message)s")
    cfg = read_config()
    stop = asyncio.Event()
    logger.info(
        "Safari scrape worker starting — backend=%s worker_id=%s transport=%s",
        cfg.base_url,
        WORKER_ID,
        SCRAPE_TRANSPORT,
    )
    timeout = aiohttp.ClientTimeout(total=None)
    async with aiohttp.ClientSession(timeout=timeout) as session:
        await _post(session, cfg, "/api/worker/heartbeat", _heartbeat_payload())
        hb = asyncio.create_task(_heartbeat_loop(session, cfg, stop))
        try:
            while True:
                job = await _claim(session, cfg)
                if job is None:
                    await asyncio.sleep(POLL_INTERVAL)
                    continue
                await _process_job(session, cfg, job)
        except asyncio.CancelledError:
            raise
        finally:
            stop.set()
            hb.cancel()
            with suppress(asyncio.CancelledError):
                await hb


def main() -> None:
    try:
        asyncio.run(run())
    except KeyboardInterrupt:
        sys.exit(0)


if __name__ == "__main__":
    main()
