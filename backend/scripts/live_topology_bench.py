"""Controlled LIVE worker benchmark — topology comparison harness.

Runs the REAL scrape pipeline (Letterboxd HTML + TMDB enrichment) against
@semihmutsuz with bounded workload classes (max_pages 2 / 10 / 60), through a
LOCAL benchmark control plane. Production queue, production cache and real
users are never touched:

- CACHE_DIR is pointed at an isolated per-run temp dir (cold) or a shared
  warm-up dir; the production tmdb_cache/ is only ever read by nothing.
- Jobs are claimed from an in-process control plane, not Render.
- Topologies compare total-active-cap 4 across: A=1proc×4, B=2proc×2,
  C=4proc×1 ("process" = independent worker context with its own WORKER_ID,
  outbox dir and TMDB rate budget), plus D = role-split prototype.
- ABORT on first Letterboxd 403/429/Cloudflare or TMDB 429.

Usage (from backend/):
    python scripts/live_topology_bench.py --quick     # active levels 1,2 only
    python scripts/live_topology_bench.py             # full matrix
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import tempfile
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

# Isolated environment BEFORE importing app modules.
_BENCH_ROOT = Path(tempfile.mkdtemp(prefix="mw_live_bench_"))
os.environ.setdefault("TMDB_REQUESTS_PER_SECOND", "25")

sys_path = r"C:\Users\semih\Desktop\letterboxd_wrapped\backend"
os.chdir(sys_path)
import sys as _sys
_sys.path.insert(0, sys_path)

from app.config import settings  # noqa: E402
from app.services import scraper, tmdb_client  # noqa: E402
from app.services.scrape_pipeline import scrape_and_analyze  # noqa: E402
from app.worker import desktop_scrape_worker as worker  # noqa: E402

ART = Path(r"C:\Users\semih\Desktop\letterboxd_wrapped\artifacts\desktop-worker-benchmark\04-live-topology")
ART.mkdir(parents=True, exist_ok=True)

USERNAME = "semihmutsuz"
WORKLOAD_CLASSES = {
    "pages2": 2,
    "pages10": 10,
    "lifetime": 60,
}

ABORT_SIGNALS = {"http_403", "http_429", "cloudflare", "tmdb_429"}
JOB_TIMEOUT_S = 240  # hard per-job ceiling — a hung scrape must not stall the matrix


class Abort(Exception):
    pass


class LiveControlPlane:
    """Local job queue + lease registry standing in for the Render backend."""

    def __init__(self, jobs: list[dict]):
        self.jobs: dict[str, dict] = {}
        for j in jobs:
            j = dict(j)
            j["status"] = "pending"
            j["claimed_by"] = None
            j["lease_token"] = None
            self.jobs[j["task_id"]] = j
        self.paused = False
        self.counters = {"http_403": 0, "http_429": 0, "cloudflare": 0, "tmdb_429": 0}
        self.lock = threading.Lock()

    def claim(self, worker_id: str):
        if self.paused:
            return None
        for job in sorted(self.jobs.values(), key=lambda j: j["task_id"]):
            if job["status"] == "pending" and job["claimed_by"] is None:
                job["claimed_by"] = worker_id
                job["lease_token"] = uuid.uuid4().hex[:16]
                job["status"] = "running"
                return job
        return None

    def complete(self, task_id: str, lease_token: str, result: dict | None, error: str | None = None):
        job = self.jobs[task_id]
        if job["lease_token"] != lease_token:
            return "lease_mismatch"
        if job["status"] == "done":
            return "duplicate"
        job["status"] = "done" if error is None else "failed"
        job["result"] = result
        job["error"] = error
        return "ok"

    @property
    def done_count(self):
        return sum(1 for j in self.jobs.values() if j["status"] == "done")


def instrument_scraper_counters(plane: LiveControlPlane):
    """Wrap scraper log signals via counters — simplest reliable abort feed."""
    orig_check = scraper._is_cloudflare_block

    def cf_wrapper(body):
        v = orig_check(body)
        if v:
            plane.counters["cloudflare"] += 1
        return v

    scraper._is_cloudflare_block = cf_wrapper


class WorkerContext:
    """One 'process' worth of isolation inside this single OS process."""

    def __init__(self, worker_id: str, cache_dir: Path, rate_budget: float):
        self.worker_id = worker_id
        self.cache_dir = cache_dir
        self.rate_budget = rate_budget
        self.outbox_dir = _BENCH_ROOT / f"outbox_{worker_id}"
        self.outbox_dir.mkdir(parents=True, exist_ok=True)

    async def run_job(self, job: dict, plane: LiveControlPlane) -> dict:
        """Execute one real pipeline job with this context's isolation."""
        tmdb_client.CACHE_DIR = self.cache_dir
        collector = __import__("app.services.tmdb_telemetry", fromlist=["TmdbCollector"]).TmdbCollector()
        from app.services.tmdb_telemetry import collecting

        started = time.monotonic()
        stage_t = {}
        error = None
        stats = None
        session = await make_session()
        try:
            if True:
                with collecting(collector):
                    def cb(stage, message, metrics=None, **kw):
                        if stage == "scrape_done":
                            stage_t["scrape_seconds"] = metrics.get("scrape_seconds")
                        if stage == "analysis_done":
                            stage_t.setdefault("analysis_seconds", metrics.get("analysis_seconds"))

                    stats = await scrape_and_analyze(
                        session, job["username"],
                        max_pages=job["max_pages"],
                        trace_callback=cb,
                    )
            postback0 = time.monotonic()
            verdict = plane.complete(job["task_id"], job["lease_token"], {"total_films": stats.get("total_films")})
            stage_t["postback_seconds"] = round(time.monotonic() - postback0, 4)
            if verdict == "lease_mismatch":
                raise Abort("lease mismatch during postback")
        except Abort:
            await session.close()
            raise
        except Exception as exc:  # noqa: BLE001
            error = f"{type(exc).__name__}: {exc}"
            plane.complete(job["task_id"], job["lease_token"], None, error)
        finally:
            if not session.closed:
                await session.close()
        elapsed = round(time.monotonic() - started, 3)
        snap = collector.snapshot()
        return {
            "task_id": job["task_id"],
            "worker_id": self.worker_id,
            "workload": job["workload"],
            "elapsed_seconds": elapsed,
            **stage_t,
            "tmdb_match_seconds": snap.get("tmdb_match_seconds"),
            "tmdb_metadata_seconds": snap.get("tmdb_metadata_seconds"),
            "local_statistics_seconds": snap.get("local_statistics_seconds"),
            "cache_hits": snap.get("cache_hits"),
            "cache_misses": snap.get("cache_misses"),
            "outbound_requests": snap.get("outbound_requests"),
            "tmdb_429s": snap.get("tmdb_429s"),
            "empty_results": snap.get("empty_results"),
            "error": error,
        }


async def make_session():
    import aiohttp

    return aiohttp.ClientSession(connector=aiohttp.TCPConnector(limit=100, limit_per_host=20))


async def topology_run(topology: str, processes: int, concurrency_per_proc: int,
                       jobs_total: int, cache_dir: Path, workloads: list[str]) -> list[dict]:
    plane = LiveControlPlane([])
    jobs = []
    for i in range(jobs_total):
        wl = workloads[i % len(workloads)]
        jobs.append({"task_id": f"{topology}-{i:03d}", "username": USERNAME,
                     "max_pages": WORKLOAD_CLASSES[wl], "workload": wl})
    plane = LiveControlPlane(jobs)
    instrument_scraper_counters(plane)

    contexts = [
        WorkerContext(f"{topology}-p{k}", cache_dir, settings.tmdb_requests_per_second / processes)
        for k in range(processes)
    ]
    results: list[dict] = []
    session = await make_session()

    async def proc_loop(ctx: WorkerContext):
        while True:
            job = plane.claim(ctx.worker_id)
            if job is None:
                break
            try:
                r = await asyncio.wait_for(ctx.run_job(job, plane), timeout=JOB_TIMEOUT_S)
            except asyncio.TimeoutError:
                r = {"task_id": job["task_id"], "worker_id": ctx.worker_id,
                     "workload": job["workload"], "error": "job_timeout",
                     "elapsed_seconds": JOB_TIMEOUT_S}
            results.append(r)
            if sum(plane.counters.values()) > 0:
                raise Abort(f"abort signal: {plane.counters}")

    t0 = time.monotonic()
    try:
        await asyncio.gather(*(proc_loop(c) for c in contexts))
    except Abort as exc:
        results.append({"abort": str(exc), "counters": plane.counters})
    wall = round(time.monotonic() - t0, 2)

    for r in results:
        r["topology"] = topology
        r["wall_seconds"] = wall
    await session.close()
    return results


def system_snapshot() -> dict:
    return {
        "threads": threading.active_count(),
        "timestamp_utc": datetime.now(timezone.utc).isoformat(),
    }


async def main_async(quick: bool):
    raw_runs = []
    variants = []

    active_levels = [1, 2] if quick else [1, 2, 4, 8]
    topologies = [
        ("A_single_x4", 1, 4),
        ("B_two_x2", 2, 2),
        ("C_four_x1", 4, 1),
        ("D_role_split", 2, 2),  # prototype: half the workers run pages2/pages10 only
    ]

    for cold_warm in ("cold", "warm"):
        cold_dir = _BENCH_ROOT / f"cache_{cold_warm}_{uuid.uuid4().hex[:6]}"
        warm_dir = _BENCH_ROOT / f"cache_shared_{cold_warm}"
        cold_dir.mkdir(parents=True, exist_ok=True)
        warm_dir.mkdir(parents=True, exist_ok=True)

        for active in active_levels:
            for repeat in range(3):
                # Topology variants whose total active (procs × per-proc concurrency)
                # equals this cap; single-process fallback covers 1/2/8.
                combos = [(p, c) for n, p, c in topologies if p * c == active] or [(1, active)]
                for pi, (procs_n, conc_n) in enumerate(combos):
                    cache_dir = cold_dir if (cold_warm == "cold") else warm_dir
                    label = f"{cold_warm}-active{active}-{procs_n}x{conc_n}-r{repeat}"
                    sys_before = system_snapshot()
                    t0 = time.monotonic()
                    results = await topology_run(
                        label, procs_n, conc_n, jobs_total=max(active, 4),
                        cache_dir=cache_dir,
                        workloads=["pages2", "pages10"],
                    )
                    wall = round(time.monotonic() - t0, 2)
                    sys_after = system_snapshot()
                    completed = sum(1 for r in results if not r.get("error") and not r.get("abort"))
                    row = {
                        "label": label, "cold_warm": cold_warm, "active_cap": active,
                        "processes": procs_n, "concurrency_per_process": conc_n,
                        "repeat": repeat, "jobs": len(results),
                        "completed_ok": completed,
                        "wall_seconds": wall,
                        "jobs_per_min": round(len(results) / wall * 60, 1) if wall else 0,
                        "threads_before": sys_before["threads"],
                        "threads_after": sys_after["threads"],
                        "abort": next((r.get("abort") for r in results if r.get("abort")), None),
                    }
                    variants.append(row)
                    raw_runs.extend(results)
                    print(json.dumps(row))
                    if any(r.get("abort") for r in results):
                        print("ABORT triggered — stopping all further runs.", flush=True)
                        _write_outputs(variants, raw_runs)
                        return

    _write_outputs(variants, raw_runs)


def _write_outputs(variants, raw_runs):
    import csv

    with open(ART / "variants.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(variants[0].keys()))
        w.writeheader()
        w.writerows(variants)
    with open(ART / "raw-runs.ndjson", "w", encoding="utf-8") as f:
        for r in raw_runs:
            f.write(json.dumps(r) + "\n")
    with open(ART / "system.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["label", "threads_before", "threads_after"])
        w.writerows([{"label": v["label"], "threads_before": v["threads_before"],
                      "threads_after": v["threads_after"]} for v in variants])
    print("outputs written to", ART)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--quick", action="store_true")
    args = parser.parse_args()
    asyncio.run(main_async(args.quick))
