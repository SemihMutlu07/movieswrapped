# Desktop Worker Operator Guide

Updated: 2026-08-24 · Release candidate: `experiment/worker-bench-lab` @ `cd56315`
(P2 `e7bf32a` + P3 `266500b` + bench lab `ec005c4` + harness `a62964b` + prewarm
`cea5945` + supervisor fix `d550451` + RSS probe `cd56315`)

## Approved production topology (final decision 2026-08-24)

**Single desktop process, concurrency = 1, direct cloudscraper.** Do NOT raise
concurrency, do not add processes, do not add role workers — measured data shows no
throughput gain and added IP risk.

## Production config (exact keys)

| Key | Value | Where |
|---|---|---|
| `WORKER_BACKEND_URL` | https://wrapped-backend.onrender.com | backend/.env |
| `WORKER_TOKEN` | (secret) | backend/.env |
| `TMDB_API_KEY` | (secret) | backend/.env |
| `ADMIN_SECRET` | (secret) | backend/.env — unlocks admin worker view |
| `WORKER_POLL_INTERVAL` | 5 | code default |
| `WORKER_HEARTBEAT_INTERVAL` | 30 | code default |
| `MAX_CONCURRENCY` | 1 | code constant |
| TMDB pacing | 25 req/s | settings default |
| Cache TTL | 175 days, lazy per-read | tmdb_client |

Never set: `WORKER_CONCURRENCY`, `WORKER_SELF_TEST_USERNAME` changes, proxy env vars.
Prewarm CLI (`scripts/prewarm_tmdb.py`) is MANUAL ONLY — never schedule it.

## Control surface

```
powershell -File backend\worker.ps1 status    # ground truth for process state
powershell -File backend\worker.ps1 restart   # graceful restart; boot task blocked until 'start'
powershell -File backend\worker.ps1 logs      # tail worker-error.log (the real log)
```

Scheduled tasks: `LetterboxdWorkerAutostart` (Ready) + `LetterboxdWorkerWatchdog`
(Ready, elevated). `LetterboxdWorker` is Disabled by design.

## SLO & alerts

| Signal | Threshold | Action |
|---|---|---|
| Heartbeat age | >60s | warning |
| Job duration p95 | >180s | investigate |
| Failed jobs/hour | ≥3 | alert |
| Outbox unacked | >10 | alert |
| Letterboxd 403/CF | first event | stop scrape, check IP |
| TMDB consecutive 429 | ≥3 | abort prewarm/scrape |
| ops_tasks queued | >20 sustained 15 min | capacity review |

## Rollback

Each change is an independent additive commit on `experiment/worker-bench-lab`:

```bash
git revert <sha>          # e7bf32a observability / 266500b cache safety / cd56315 rss probe
git checkout cea5945~1 -- backend/scripts/prewarm_tmdb.py   # or just delete the file
# worker process rollback to any sha:
git checkout <good-sha> && powershell -File backend\worker.ps1 restart
```

Cache files written under the new atomic-write path remain valid after rollback
(format unchanged); the 175-day TTL applies regardless.

## Known operational notes

- Supervisor pulls from `main` now (desktop_server was deleted upstream).
- Watchlist scraping is Cloudflare-blocked at the direct-scraper level; watchlist
  compare features need the deferred browser-use fallback adapter.
- RSS probe (`app/services/rss_probe.py`) ships as a primitive; wiring it into the
  poll loop as a returning-user short-circuit is a follow-up PR.
- Bench lab (`bench_lab.py`, `worker_bench.py`) and benchmark scripts live on this
  experiment branch only — exclude them when merging to main.
