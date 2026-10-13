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
import re
import socket
import subprocess
import sys
import threading
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
from app.services.scraper import classify_letterboxd_error  # noqa: E402
from app.services.tmdb_telemetry import TmdbCollector, collecting  # noqa: E402

logger = logging.getLogger("letterboxd_wrapped.safari_worker")

POLL_INTERVAL = float(os.getenv("WORKER_POLL_INTERVAL", "5"))
HEARTBEAT_INTERVAL = float(os.getenv("WORKER_HEARTBEAT_INTERVAL", "30"))
JOB_GAP_SECONDS = float(os.getenv("WORKER_JOB_GAP_SECONDS", "2"))
# Push diary/grid/reviews/analysis while the scrape is still running so
# /api/progress leaves 0/0 within about a second of each stage.
TRACE_FLUSH_SECONDS = float(os.getenv("WORKER_TRACE_FLUSH_SECONDS", "1"))
CONTROL_TIMEOUT = aiohttp.ClientTimeout(total=30)
WORKER_ID = os.getenv("WORKER_ID") or f"x370-{socket.gethostname()}"
WORKER_PROTOCOL_VERSION = 5
SYSTEMD_UNIT = os.getenv("WORKER_SYSTEMD_UNIT", "movieswrapped-worker.service")
_SECRET_RE = re.compile(r"(WORKER_TOKEN|TMDB_API_KEY|Authorization|X-Worker-Token)\s*[=:]\s*\S+", re.I)


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
    _lock: threading.Lock = field(default_factory=threading.Lock, repr=False)

    def add(self, stage: str, message: str, metrics: Optional[dict[str, Any]] = None, level: str = "info") -> None:
        event = {
            "stage": stage,
            "message": message,
            "metrics": metrics or {},
            "level": level,
            "elapsed_seconds": round(_monotonic() - self.started, 1),
        }
        with self._lock:
            self.events.append(event)
            self.pending.append(event)

    def drain(self) -> list[dict[str, Any]]:
        with self._lock:
            batch = list(self.pending)
            self.pending.clear()
            return batch

    def restore(self, batch: list[dict[str, Any]]) -> None:
        """Put a failed post back at the front of the queue. Snapshot is unchanged."""
        if not batch:
            return
        with self._lock:
            self.pending = list(batch) + self.pending

    def snapshot(self) -> list[dict[str, Any]]:
        with self._lock:
            return list(self.events)


def redact_secrets(text: str) -> str:
    return _SECRET_RE.sub(r"\1=<redacted>", text)


def repo_root() -> Path:
    return Path(__file__).resolve().parents[3]


def current_git_sha(root: Path | None = None) -> str:
    env_sha = (os.getenv("WORKER_GIT_SHA") or "").strip()
    if env_sha:
        return env_sha
    try:
        out = subprocess.check_output(
            ["git", "rev-parse", "HEAD"],
            cwd=root or repo_root(),
            text=True,
            timeout=5,
            stderr=subprocess.DEVNULL,
        )
        return out.strip()
    except (OSError, subprocess.SubprocessError):
        return ""


def self_update_and_restart(expected_sha: str, expected_protocol: int) -> None:
    """git pull --ff-only then restart the systemd --user unit. Never logs secrets."""
    root = repo_root()
    logger.info(
        "Worker version mismatch (protocol=%s expected_sha_prefix=%s); pulling and restarting",
        expected_protocol,
        (expected_sha or "")[:12],
    )
    try:
        subprocess.run(["git", "fetch", "origin"], cwd=root, check=False, timeout=60)
        pull = subprocess.run(["git", "pull", "--ff-only"], cwd=root, check=False, timeout=60)
        if pull.returncode != 0:
            logger.error("git pull --ff-only failed; leaving the running worker in place")
            return
    except (OSError, subprocess.SubprocessError) as exc:
        logger.error("self-update git failed: %s", redact_secrets(str(exc)))
        return
    try:
        subprocess.Popen(
            ["systemctl", "--user", "restart", SYSTEMD_UNIT],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
        )
    except OSError as exc:
        logger.error("systemd restart failed: %s", exc)
        return
    raise SystemExit(0)


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
    else:
        code = classify_letterboxd_error(exc)
        if code == "scrape_failed":
            message = f"Letterboxd returned an unexpected response for @{username}. Try again later."
        else:
            message = raw
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
            if resp.status == 409:
                detail: dict[str, Any] = {}
                with suppress(Exception):
                    body = await resp.json()
                    if isinstance(body, dict):
                        nested = body.get("detail")
                        detail = nested if isinstance(nested, dict) else body
                if str(detail.get("error_code") or "") == "worker_version_mismatch":
                    self_update_and_restart(
                        str(detail.get("expected_git_sha") or ""),
                        int(detail.get("expected_protocol_version") or WORKER_PROTOCOL_VERSION),
                    )
                logger.error("POST %s rejected: HTTP 409", path)
                return False
            if resp.status != 200:
                logger.error("POST %s rejected: HTTP %s", path, resp.status)
                return False
            return True
    except Exception as exc:  # noqa: BLE001
        logger.error("POST %s failed: %s", path, redact_secrets(str(exc)))
        return False


def _heartbeat_payload() -> dict[str, Any]:
    return {
        "worker_id": WORKER_ID,
        "scrape_transport": SCRAPE_TRANSPORT,
        "max_concurrency": 1,
        "protocol_version": WORKER_PROTOCOL_VERSION,
        "git_sha": current_git_sha(),
        "version": current_git_sha()[:12],
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
            if resp.status == 409:
                logger.error("claim rejected: HTTP 409 (version mismatch)")
                return None
            if resp.status != 200:
                logger.error("claim rejected: HTTP %s", resp.status)
                return None
            body = await resp.json()
    except Exception as exc:  # noqa: BLE001
        logger.error("claim failed: %s", redact_secrets(str(exc)))
        return None
    job = body.get("job") if isinstance(body, dict) else None
    return job if isinstance(job, dict) else None


async def _flush_trace(
    session: aiohttp.ClientSession, cfg: WorkerConfig, task_id: str, trace: TraceBuffer, lease: dict
) -> None:
    events = trace.drain()
    if not events:
        return
    ok = await _post(session, cfg, f"/api/worker/scrape/{task_id}/event", {"events": events, **lease})
    if not ok:
        trace.restore(events)


async def _pump_trace(
    session: aiohttp.ClientSession,
    cfg: WorkerConfig,
    task_id: str,
    trace: TraceBuffer,
    lease: dict,
    stop: asyncio.Event,
) -> None:
    """POST queued scan stages while scrape_and_analyze is still running."""
    while True:
        await _flush_trace(session, cfg, task_id, trace, lease)
        if stop.is_set():
            await _flush_trace(session, cfg, task_id, trace, lease)
            return
        with suppress(asyncio.TimeoutError):
            await asyncio.wait_for(stop.wait(), timeout=TRACE_FLUSH_SECONDS)


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
    stop_flush = asyncio.Event()
    pump = asyncio.create_task(_pump_trace(session, cfg, task_id, trace, lease, stop_flush))
    failure: Optional[tuple[str, dict[str, Any]]] = None
    stats: Optional[dict] = None
    try:
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
            failure = (message, telemetry)
    finally:
        stop_flush.set()
        with suppress(asyncio.CancelledError):
            await pump

    if failure is not None:
        message, telemetry = failure
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

    assert stats is not None
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
        "Safari scrape worker starting — backend=%s worker_id=%s transport=%s protocol=%s sha_prefix=%s",
        cfg.base_url,
        WORKER_ID,
        SCRAPE_TRANSPORT,
        WORKER_PROTOCOL_VERSION,
        current_git_sha()[:12],
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
                if JOB_GAP_SECONDS > 0:
                    await asyncio.sleep(JOB_GAP_SECONDS)
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
