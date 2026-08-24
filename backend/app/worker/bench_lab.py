"""Worker benchmark lab: JobExecutor adapter + in-process synthetic harness.

This module is the experiment-lab core behind the ``worker-bench`` CLI. It is
deliberately INTERNAL: nothing here is imported by the production worker loop,
no public endpoint, secret or dependency is added, and the default production
behavior (concurrency=1) is untouched.

Architecture
------------
``JobExecutor`` is the seam between "claim a job" and "run a job":

- ``ProductionJobExecutor`` delegates to the real
  ``desktop_scrape_worker._process_job`` / ``_process_watchlist_job`` —
  byte-for-byte existing behavior.
- ``FixtureJobExecutor`` replaces the scrape pipeline with an in-memory fake:
  zero external requests to Letterboxd or TMDB, deterministic durations,
  injectable failures (kill mid-job, drop postbacks, stale leases...).

``BenchBackend`` simulates the Render control plane in-memory (queue with
fair claim, leases, pause/resume, heartbeat registry) so failure injection is
deterministic and no network is involved.

``run_burst`` drives the same outer-loop concurrency logic the production
worker uses (N slots, claim-when-free) via either executor.
"""
from __future__ import annotations

import asyncio
import json
import os
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Optional

from app.worker import desktop_scrape_worker as worker


# ---------------------------------------------------------------------------
# Concurrency configuration (internal experiment knob)
# ---------------------------------------------------------------------------

def worker_concurrency() -> int:
    """Internal experiment knob for the outer job-concurrency level.

    DEFAULT IS STRICTLY 1 — the production contract. Only the bench CLI sets
    it explicitly; the real worker loop keeps its V1 single-slot semantics.
    """
    raw = os.getenv("WORKER_CONCURRENCY", "1")
    try:
        value = int(raw)
    except ValueError:
        return 1
    return max(1, min(value, 8))


# ---------------------------------------------------------------------------
# In-memory control-plane simulation
# ---------------------------------------------------------------------------

@dataclass
class SimJob:
    task_id: str
    username: str = "bench-user"
    kind: str = "scrape"
    lease_token: str = ""
    claimed_by: str = ""
    status: str = "pending"          # pending | running | done | failed
    created_seq: int = 0


class BenchBackend:
    """Deterministic in-memory stand-in for the Render task manager.

    Implements the parts of the worker↔backend contract the lab exercises:
    fair claim with lease, terminal postback (with duplicate/stale-lease
    rejection), pause/resume, heartbeat registry and outbox acknowledgement.
    """

    def __init__(self) -> None:
        self.jobs: dict[str, SimJob] = {}
        self._seq = 0
        self.paused = False
        self.online_workers: dict[str, float] = {}
        self.postback_log: list[dict] = []
        self.reject_stale_lease = False
        self.drop_postbacks_until: float = 0.0   # monotonic window for injected failures

    # -- queue ---------------------------------------------------------------

    def enqueue(self, n: int) -> list[str]:
        ids = []
        for _ in range(n):
            self._seq += 1
            job = SimJob(task_id=f"task-{self._seq:04d}", created_seq=self._seq)
            self.jobs[job.task_id] = job
            ids.append(job.task_id)
        return ids

    def claim_next(self, worker_id: str) -> Optional[SimJob]:
        if self.paused:
            return None
        queued = sorted(
            (j for j in self.jobs.values() if j.status == "pending" and not j.claimed_by),
            key=lambda j: j.created_seq,
        )
        if not queued:
            return None
        job = queued[0]
        import secrets

        job.claimed_by = worker_id
        job.lease_token = secrets.token_urlsafe(16)
        job.status = "running"
        return job

    # -- postbacks -------------------------------------------------------------

    def complete(self, task_id: str, lease_token: str, worker_id: str) -> dict:
        job = self.jobs.get(task_id)
        now = time.monotonic()
        if now < self.drop_postbacks_until:
            return {"ok": False, "reason": "injected_unavailable"}
        if job is None:
            return {"ok": False, "reason": "unknown_task"}
        if self.reject_stale_lease or not job.lease_token or lease_token != job.lease_token:
            self.postback_log.append({"task_id": task_id, "verdict": "stale_rejected"})
            return {"ok": False, "reason": "lease_mismatch"}
        if job.status == "done":
            self.postback_log.append({"task_id": task_id, "verdict": "duplicate_ignored"})
            return {"ok": True, "duplicate": True}
        job.status = "done"
        self.postback_log.append({"task_id": task_id, "verdict": "completed"})
        return {"ok": True}

    def heartbeat(self, worker_id: str) -> None:
        self.online_workers[worker_id] = time.monotonic()

    def set_paused(self, paused: bool) -> None:
        self.paused = paused


# ---------------------------------------------------------------------------
# Executors
# ---------------------------------------------------------------------------

class ProductionJobExecutor:
    """Delegates to the REAL worker processing functions.

    Used only by the baseline run to prove parity: same code path as
    production, pointed at the simulated backend over aiohttp.
    """

    name = "production"

    def __init__(self, session=None):
        self.session = session

    async def execute(self, job: dict, backend: BenchBackend, worker_id: str) -> str:
        cfg = worker.WorkerConfig()
        await worker._process_job(self.session, cfg, job)
        return "production"


class FixtureJobExecutor:
    """In-memory fake pipeline: zero external requests, injectable failures."""

    name = "fixture"

    def __init__(self, *, duration_s: float = 0.01, kill_after_claims: Optional[int] = None,
                 fail_task_ids: Optional[set] = None):
        self.duration_s = duration_s
        self.kill_after_claims = kill_after_claims
        self._claims = 0
        self.fail_task_ids = fail_task_ids or set()

    async def execute(self, job: dict, backend: BenchBackend, worker_id: str) -> str:
        self._claims += 1
        if self.kill_after_claims is not None and self._claims >= self.kill_after_claims:
            os._exit(9)  # hard kill mid-job — the crash-injection scenario

        trace = worker.TraceBuffer()
        trace.add("worker_received", "Fixture job received", {})
        started = time.monotonic()
        outcome = "failed" if job["task_id"] in self.fail_task_ids else "done"
        await asyncio.sleep(self.duration_s)

        payload = {
            "username": job.get("username", "bench-user"),
            "stats": {"total_films": 10},
            "telemetry": {
                "duration_seconds": round(time.monotonic() - started, 3),
                **trace.timings(),
                "transport": "fixture",
            },
            "trace_events": trace.snapshot(),
            "lease_token": job.get("lease_token"),
        }
        path = f"/api/worker/scrape/{job['task_id']}/{'complete' if outcome == 'done' else 'failed'}"
        # Simulate the outbox POST against the in-memory backend.
        resp = backend.complete(job["task_id"], payload["lease_token"], worker_id)
        if isinstance(resp, dict) and resp.get("reason") == "injected_unavailable":
            return "postback_retry"
        return outcome


# ---------------------------------------------------------------------------
# Outer loop (mirrors production slot semantics)
# ---------------------------------------------------------------------------

async def _worker_loop(backend: BenchBackend, executor, worker_id: str,
                       slots: int, stop: asyncio.Event, active: dict,
                       events: list, max_jobs: int):
    tasks_in_flight: set = set()

    async def run_one(job_dict):
        active[job_dict["task_id"]] = True
        events.append({"t": time.monotonic(), "ev": "claimed", "task": job_dict["task_id"], "slots": slots})
        try:
            outcome = await executor.execute(job_dict, backend, worker_id)
            events.append({"t": time.monotonic(), "ev": outcome, "task": job_dict["task_id"]})
        except asyncio.CancelledError:
            events.append({"t": time.monotonic(), "ev": "cancelled_active", "task": job_dict["task_id"]})
            raise
        finally:
            active.pop(job_dict["task_id"], None)

    while not stop.is_set():
        # Graceful shutdown: no new claims once stop is set.
        free = slots - len(tasks_in_flight)
        while free > 0 and not stop.is_set():
            if all(j.status != "pending" for j in backend.jobs.values()):
                break
            job = backend.claim_next(worker_id)
            if job is None:
                break
            backend.heartbeat(worker_id)
            t = asyncio.create_task(run_one({
                "task_id": job.task_id,
                "username": job.username,
                "lease_token": job.lease_token,
                "kind": job.kind,
            }))
            tasks_in_flight.add(t)
            t.add_done_callback(tasks_in_flight.discard)
            free -= 1
        # Exit when every job reached a terminal state and nothing is in flight.
        if not tasks_in_flight and all(j.status != "pending" for j in backend.jobs.values()):
            break
        await asyncio.sleep(0.001)

    # Graceful drain: let in-flight jobs finish, cancel nothing.
    if tasks_in_flight:
        await asyncio.gather(*tasks_in_flight, return_exceptions=True)


async def run_burst(jobs: int, active_slots: int, executor,
                    *, worker_id: str = "bench-worker",
                    max_seconds: float = 120.0) -> dict:
    """Drive `jobs` synthetic jobs through `active_slots` concurrent slots."""
    backend = BenchBackend()
    backend.enqueue(jobs)
    stop = asyncio.Event()
    active: dict = {}
    events: list = []

    started = time.monotonic()
    loop_task = asyncio.create_task(
        _worker_loop(backend, executor, worker_id, active_slots, stop, active, events, jobs)
    )
    done, pending = await asyncio.wait({loop_task}, timeout=max_seconds)
    wall = round(time.monotonic() - started, 2)
    if pending:
        stop.set()
        loop_task.cancel()

    completed = sum(1 for j in backend.jobs.values() if j.status == "done")
    still_pending = sum(1 for j in backend.jobs.values() if j.status == "pending")
    duplicates = sum(1 for p in backend.postback_log if p["verdict"] == "duplicate_ignored")
    stale_rejected = sum(1 for p in backend.postback_log if p["verdict"] == "stale_rejected")

    return {
        "jobs_requested": jobs,
        "active_slots": active_slots,
        "transport": executor.name,
        "wall_seconds": wall,
        "completed": completed,
        "lost": jobs - completed,
        "still_pending": still_pending,
        "duplicate_terminal_transitions": duplicates,
        "stale_or_foreign_lease_acceptances": stale_rejected,
        "max_concurrent_observed": _max_observed_concurrency(events),
        "events": events,
        "postback_log": backend.postback_log,
    }


def _max_observed_concurrency(events: list) -> int:
    depth = peak = 0
    for ev in sorted(events, key=lambda e: e["t"]):
        if ev["ev"] == "claimed":
            depth += 1
            peak = max(peak, depth)
        elif ev["ev"] in ("done", "failed", "cancelled_active"):
            depth -= 1
    return peak


# ---------------------------------------------------------------------------
# System sampling (threads / memory / fds)
# ---------------------------------------------------------------------------

def system_snapshot() -> dict:
    """Thread/memory/fd levels for the growth check after 100 jobs."""
    proc_status = {}
    try:
        with open("/proc/self/status") as f:  # linux
            for line in f:
                if line.startswith(("Threads:", "VmRSS:")):
                    k, v = line.split(":", 1)
                    proc_status[k] = v.strip()
    except OSError:
        pass
    try:
        import ctypes

        windll = ctypes.windll.kernel32  # noqa: F841
        windows = True
    except OSError:
        windows = False

    snapshot: dict[str, Any] = {
        "python_threads": __import__("threading").active_count(),
        "proc_status": proc_status,
    }
    try:
        import psutil  # optional dep — do not require

        p = psutil.Process()
        snapshot.update({
            "threads": p.num_threads(),
            "rss_mb": round(p.memory_info().rss / 1048576, 1),
            "fds": p.num_fds() if hasattr(p, "num_fds") else len(p.open_files()),
        })
    except Exception:
        snapshot.update(_stdlib_counts())
    return snapshot


def _stdlib_counts() -> dict:
    import threading

    counts: dict[str, Any] = {"threads": threading.active_count()}
    try:
        import resource

        counts["open_fds"] = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        counts["rss_mb_unknown"] = True
    except ImportError:
        # Windows stdlib fallback
        try:
            import ctypes

            class FILETIME(ctypes.Structure):
                _fields_ = [("lo", ctypes.c_ulong), ("hi", ctypes.c_ulong)]

            counts["note"] = "psutil unavailable; limited counters"
        except Exception:
            pass
    return counts
