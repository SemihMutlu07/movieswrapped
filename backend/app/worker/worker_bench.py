"""worker-bench — synthetic benchmark CLI for the desktop worker lab.

INTERNAL EXPERIMENT TOOL. Never imported by production code; the only thing
it shares with the real worker is the executor seam in bench_lab.py.

Usage:
    python -m app.worker.worker_bench baseline
    python -m app.worker.worker_bench burst --transport fixture --jobs 100 --active 2
    python -m app.worker.worker_bench report <run-id>
"""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
import time
import uuid
from pathlib import Path

from app.worker import bench_lab

RESULTS_DIR = Path("bench_runs")


def _save(run_id: str, result: dict, system_before: dict, system_after: dict) -> Path:
    RESULTS_DIR.mkdir(exist_ok=True)
    payload = {
        "run_id": run_id,
        "result": result,
        "system_before": system_before,
        "system_after": system_after,
        "finished_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    path = RESULTS_DIR / f"{run_id}.json"
    path.write_text(json.dumps(payload, indent=1), encoding="utf-8")
    return path


def _print_summary(run_id: str, result: dict) -> None:
    print(f"run={run_id} transport={result['transport']} jobs={result['jobs_requested']} "
          f"slots={result['active_slots']} wall={result['wall_seconds']}s")
    print(f"  completed={result['completed']} lost={result['lost']} "
          f"pending={result['still_pending']} dup_terminal={result['duplicate_terminal_transitions']} "
          f"stale_accepted={result['stale_or_foreign_lease_acceptances']}")
    print(f"  peak_concurrency_observed={result['max_concurrent_observed']}")


async def cmd_baseline(args) -> int:
    run_id = args.run_id or f"baseline-{uuid.uuid4().hex[:8]}"
    before = bench_lab.system_snapshot()
    result = await bench_lab.run_burst(jobs=10, active_slots=1,
                                       executor=bench_lab.FixtureJobExecutor(),
                                       worker_id="bench-baseline")
    after = bench_lab.system_snapshot()
    path = _save(run_id, result, before, after)
    _print_summary(run_id, result)
    print(f"saved → {path}")
    return 0 if result["lost"] == 0 else 1


async def cmd_burst(args) -> int:
    if args.transport != "fixture":
        print("Only --transport fixture is supported for synthetic runs.", file=sys.stderr)
        return 2
    if args.active > 8 or args.active < 1:
        print("--active must be within 1..8 (lab ceiling).", file=sys.stderr)
        return 2
    run_id = args.run_id or f"burst-{args.jobs}x{args.active}-{uuid.uuid4().hex[:8]}"
    before = bench_lab.system_snapshot()
    result = await bench_lab.run_burst(
        jobs=args.jobs, active_slots=args.active,
        executor=bench_lab.FixtureJobExecutor(duration_s=args.duration),
        worker_id=f"bench-burst-{args.active}",
    )
    after = bench_lab.system_snapshot()
    path = _save(run_id, result, before, after)
    _print_summary(run_id, result)
    growth = {
        k: {"before": before.get(k), "after": after.get(k)}
        for k in ("threads", "python_threads", "rss_mb", "fds")
        if k in before or k in after
    }
    print(f"  resource_growth={json.dumps(growth)}")
    print(f"saved → {path}")
    return 0 if result["lost"] == 0 and result["duplicate_terminal_transitions"] == 0 else 1


def cmd_report(args) -> int:
    path = RESULTS_DIR / f"{args.run_id}.json"
    if not path.exists():
        print(f"No such run: {path}", file=sys.stderr)
        return 2
    data = json.loads(path.read_text(encoding="utf-8"))
    print(json.dumps(data, indent=1))
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(prog="worker-bench", description=__doc__)
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_base = sub.add_parser("baseline", help="10-job parity baseline at concurrency 1")
    p_base.add_argument("--run-id", default=None)
    p_base.set_defaults(func=lambda a: asyncio.run(cmd_baseline(a)))

    p_burst = sub.add_parser("burst", help="N-job burst at a given slot count")
    p_burst.add_argument("--transport", default="fixture", choices=["fixture"])
    p_burst.add_argument("--jobs", type=int, required=True)
    p_burst.add_argument("--active", type=int, required=True)
    p_burst.add_argument("--duration", type=float, default=0.01, help="per-job fixture duration (s)")
    p_burst.add_argument("--run-id", default=None)
    p_burst.set_defaults(func=lambda a: asyncio.run(cmd_burst(a)))

    p_rep = sub.add_parser("report", help="dump a saved run as JSON")
    p_rep.add_argument("run_id")
    p_rep.set_defaults(func=cmd_report)

    args = parser.parse_args()
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
