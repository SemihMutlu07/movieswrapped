"""Health alerting via ntfy.sh — worker offline / queue backlog notifications.

A background loop (spawned in the FastAPI lifespan) checks three conditions
every health_check_interval_seconds:

  1. no worker has heartbeated in worker_offline_after_seconds
  2. queue_depth > queue_depth_alert_threshold
  3. the oldest queued job waited longer than queue_stale_after_seconds

Each condition has its own cooldown (ntfy_cooldown_seconds) so a stuck queue
does not re-alert every minute. The topic comes from settings.ntfy_topic;
empty topic disables alerting entirely.
"""
from __future__ import annotations

import asyncio
import logging
import time
from datetime import datetime, timezone
from typing import Any

import httpx

from app import task_manager
from app.config import settings

logger = logging.getLogger("letterboxd_wrapped.worker_alerts")

# Monotonic timestamps of the last sent alert per condition key. Persisting
# across restarts is unnecessary — a fresh backend re-arms after one cooldown.
_last_alert_at: dict[str, float] = {}

# True once an offline alert has been sent; cleared after the recovery ping.
# Lets us notify "worker is back online" exactly once per outage.
_offline_alert_sent = False

CONDITION_NO_WORKER = "no_worker_heartbeat"
CONDITION_QUEUE_DEPTH = "queue_depth"
CONDITION_QUEUE_STALE = "queue_stale"
CONDITION_RECOVERED = "worker_recovered"


def _cooldown_ok(condition: str) -> bool:
    last = _last_alert_at.get(condition)
    return last is None or (time.monotonic() - last) >= settings.ntfy_cooldown_seconds


def _mark_sent(condition: str) -> None:
    _last_alert_at[condition] = time.monotonic()


def _condition_messages() -> list[tuple[str, str]]:
    """Return [(condition_key, message)] for every currently-firing condition."""
    messages: list[tuple[str, str]] = []

    offline = not task_manager.is_worker_online(settings.worker_offline_after_seconds)
    if offline:
        messages.append((CONDITION_NO_WORKER, "Desktop worker is offline — no heartbeat for 5+ minutes"))

    stats = task_manager.get_worker_queue_stats()
    depth = stats["queue_depth"]
    if depth > settings.queue_depth_alert_threshold:
        messages.append((CONDITION_QUEUE_DEPTH, f"Worker queue depth is {depth} (threshold {settings.queue_depth_alert_threshold})"))

    oldest = stats["oldest_queued_age_seconds"]
    if oldest > settings.queue_stale_after_seconds:
        messages.append((CONDITION_QUEUE_STALE, f"Oldest queued job waited {int(oldest)}s (threshold {settings.queue_stale_after_seconds}s)"))

    return messages


def _recovery_message() -> str | None:
    """Return a recovery ping message when the worker came back online.

    Emits exactly once per outage: requires a previously-sent offline alert
    (cooldown-independent) and a worker that is online again.
    """
    global _offline_alert_sent
    if not _offline_alert_sent:
        return None
    if not task_manager.is_worker_online(settings.worker_offline_after_seconds):
        return None
    _offline_alert_sent = False
    return "Desktop worker is back online — previous offline alert resolved ✅"


async def send_alert(message: str) -> bool:
    """POST one message to the ntfy topic. Best-effort; never raises."""
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                f"https://ntfy.sh/{settings.ntfy_topic}",
                content=message,
                headers={"Title": "Letterboxd Wrapped — worker alert"},
            )
            resp.raise_for_status()
        return True
    except Exception as exc:
        logger.warning("ntfy alert failed: %s", exc)
        return False


async def _ping_dead_mans_switch() -> None:
    """Ping the healthchecks.io URL so an external service can catch a dead
    backend (the alert loop lives inside the backend — if the backend dies,
    so does the alerting). Best-effort; failures are logged, never fatal."""
    if not settings.healthcheck_url:
        return
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(settings.healthcheck_url)
            resp.raise_for_status()
    except Exception as exc:
        logger.error("Dead man's switch ping FAILED (%s): %s", settings.healthcheck_url, exc)


async def _run_health_monitor() -> None:
    global _offline_alert_sent
    while True:
        await asyncio.sleep(settings.health_check_interval_seconds)
        try:
            await _ping_dead_mans_switch()

            if settings.ntfy_topic:
                # Recovery ping first (cooldown-independent, fires once per outage).
                recovery = _recovery_message()
                if recovery:
                    ok = await send_alert(recovery)
                    if ok:
                        logger.info("Sent ntfy recovery ping: %s", recovery)
                    else:
                        # Keep the flag set so the recovery ping retries next tick.
                        _offline_alert_sent = True

                for condition, message in _condition_messages():
                    if not _cooldown_ok(condition):
                        continue
                    ok = await send_alert(message)
                    if ok:
                        _mark_sent(condition)
                        if condition == CONDITION_NO_WORKER:
                            _offline_alert_sent = True
                        logger.info("Sent ntfy alert [%s]: %s", condition, message)
                    else:
                        logger.warning("ntfy alert [%s] not sent (send failed) — will retry after cooldown", condition)
        except Exception as exc:
            logger.debug("Health monitor tick error (non-fatal): %s", exc)


async def start_health_monitor() -> asyncio.Task:
    """Spawn the health-monitor loop. No-op (returns a cancelled task) when
    ntfy alerting is disabled so the lifespan code stays uniform."""
    task = asyncio.create_task(_run_health_monitor(), name="worker_health_monitor")
    if settings.ntfy_topic:
        logger.info(
            "Worker health monitor started (interval=%ss, ntfy topic=%s)",
            settings.health_check_interval_seconds,
            settings.ntfy_topic,
        )
    else:
        logger.warning(
            "⚠️ ALERTING DISABLED — NTFY_TOPIC is empty. Worker offline / queue "
            "backlog alerts will NOT be sent. Set NTFY_TOPIC to enable.",
        )
    if not settings.healthcheck_url:
        logger.warning(
            "⚠️ DEAD MAN'S SWITCH DISABLED — HEALTHCHECK_URL is empty. A backend "
            "crash will not be detected by healthchecks.io. Set HEALTHCHECK_URL to enable.",
        )
    return task
