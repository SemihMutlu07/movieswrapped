# Desktop Scrape Worker — Handbook

> Durable reference so we **never re-derive** how the desktop server works.
> Paths relative to repo root.
> Last verified: 2026-08-22.

## 1. Mental model (read this first)

Public users hit the **Render-hosted FastAPI backend**. The heavy Letterboxd HTML
scrape does **not** run on Render (datacenter IPs get Cloudflare-blocked). Instead
an **always-on home desktop worker** (residential IP, no public exposure)
**polls the backend outbound** for queued jobs, scrapes, and posts results back.

```
Browser ──HTTPS──> Render backend ──(job queue)──> [desktop polls outbound] ──> Letterboxd
                        ▲                                      │
                        └──────── postback (stats) ◀───────────┘
```

The desktop is **never exposed publicly**. It only makes outbound calls. The
shared secret `WORKER_TOKEN` (sent as `X-Worker-Token`) authenticates it.

Transport is **direct cloudscraper**. Multiple desktop processes may poll the
same backend when each has a distinct `WORKER_ID`; claims bind to that id via
`claimed_by` + `lease_token`.

## 2. End-to-end request lifecycle

Two modes, gated by `settings.desktop_worker_enabled` (= truthy `WORKER_TOKEN`).

**Desktop-worker mode (production):**
1. `POST /api/scrape-profile {username}` → `scrape_profile()` (`backend/app/routes/analyze.py`).
2. **Online gate:** `task_manager.is_worker_online(max_age)` — any worker heartbeat
   newer than `worker_heartbeat_max_age_seconds` (default **60s**). If offline →
   **503** `{error_code:"desktop_worker_offline"}`.
   Note: this enqueue gate is intentionally tighter than the health-alert lag
   (`worker_offline_after_seconds`, default **300s**) used by ntfy /
   `/api/health/workers`. Users get a fast 503; ops alerts wait longer.
3. **Queue:** `create_scrape_job(username)` → **202** `{task_id, status:"pending"}`.
4. **Frontend polls** `GET /api/progress/{task_id}`.
5. **Worker claims:** `GET /api/worker/next?worker_id=…` (fair scrape/watchlist
   queue). Response includes `lease_token` + `claimed_by`. Legacy
   `/api/worker/scrape/next` and `/watchlist/next` still exist for diagnostics.
6. **Scrape + analyze** on the desktop via `scrape_and_analyze(...)`.
7. **Live trace:** `POST /api/worker/scrape/{task_id}/event` with `lease_token`.
8. **Postback:** `…/complete` or `…/failed` with the same `lease_token`. Wrong
   token → **409** `lease_mismatch`.
9. **User result:** next poll sees `status="done"`.

**Sync fallback mode (local dev, no `WORKER_TOKEN`):** `/api/scrape-profile` runs
inline and returns stats directly (no task_id).

## 3. Worker protocol & env vars

Loop (`desktop_scrape_worker.py`): validate env → Windows wakelock → ThreadPool(10)
→ one `aiohttp` session → `POST /api/worker/startup` → optional self-test →
heartbeat loop → poll **`/api/worker/next`** every 5s, **one job at a time** → on
exit `POST /api/worker/shutdown`.

- **Heartbeat:** every **30s** (`POST /api/worker/heartbeat`); enqueue online =
  age ≤ **60s**. On a rejected/failed heartbeat the wait doubles up to
  `WORKER_HEARTBEAT_MAX_BACKOFF` (default **300s**) and resets on success.
- **Protocol version:** claim returns **409 worker_version_mismatch** if the
  worker's `worker_protocol_version` ≠ backend's (default **4**). Bump both sides
  together when control-plane payloads change.
- **Auth:** every `/api/worker/*` needs `X-Worker-Token == WORKER_TOKEN` else 401.
- **Lease:** claim returns `lease_token`; every event/complete/failed for that
  task must echo it. Stale requeue invalidates leases whose **owner**
  (`claimed_by`) has gone dark — another live worker does not protect a dead
  owner's claim.
- **Pause:** claim returns `{job:null, paused:true}`; the worker logs and idles
  (does not treat pause as an empty queue forever without logging).
- **Outbox:** complete/failed payloads land in `.worker_outbox/` and retry on
  idle polls.
- **`MAX_CONCURRENCY`:** heartbeat metadata only. The loop is serial; the backend
  does not enforce a claim cap from this field.

| Env var | Default | Purpose |
|---|---|---|
| `WORKER_BACKEND_URL` | — (required) | Backend base URL to poll |
| `WORKER_TOKEN` | — (required) | Shared secret → `X-Worker-Token` |
| `WORKER_ID` | `desktop-<hostname>` | Stable identity bound to claims |
| `WORKER_VERSION` | `1.0.0` | Human-facing worker version in heartbeat metadata |
| `WORKER_HEARTBEAT_MAX_BACKOFF` | 300s | Cap for heartbeat retry backoff when the backend is failing |
| `TMDB_API_KEY` | "" (required to work) | TMDB enrichment in analysis |
| `WORKER_SELF_TEST_ON_START` | **off** | Real scrape smoke test on boot |
| `WORKER_SELF_TEST_USERNAME` | `semihmutsuz` | Self-test target |
| `WORKER_POLL_INTERVAL` | 5s | Idle poll cadence |
| `WORKER_HEARTBEAT_INTERVAL` | **30s** | Heartbeat cadence |
| `WORKER_TRACE_FLUSH_INTERVAL` | 5s | Live-trace flush |
| `WORKER_OUTBOX_DIR` | `.worker_outbox` | Failed-postback durability |
| `LETTERBOXD_PAGE_DELAY` | 0.25s | Per-page politeness delay |

Backend side (`config.py`): `worker_heartbeat_max_age_seconds=60`,
`worker_offline_after_seconds=300`, `worker_protocol_version=4`.

## 4. Operating it (the practical bit)

- **Start on Windows (recommended):** from the repository root run
  `powershell -ExecutionPolicy Bypass -File .\backend\start-worker-supervisor.ps1`.
- **Start directly (diagnostics only):** from `backend/`, run
  `.\.venv\Scripts\python.exe -m app.worker.desktop_scrape_worker`.
- **Acceptance / smoke (no `worker-test.ps1`):** run
  `python scripts/verify_desktop_direct_scrape.py` (see
  `docs/desktop-worker-setup.md`).
- **Stop:** Ctrl-C / close. Backend notices via heartbeat age within ~60s for
  enqueue; health alerts use the 300s threshold.
- **After a code/env change:** restart the worker — it does not hot-reload.
- **Invariants / do-nots:**
  - Run from `backend/` (so `.env`, `runs/`, `.worker_outbox/` resolve).
  - Give each machine a distinct `WORKER_ID` when running more than one worker.
  - Keep `WORKER_SELF_TEST_ON_START` off unless you intend a real Letterboxd hit.
  - Desktop `.env` must use `SUPABASE_URL` + `SUPABASE_ANON_KEY` only — **no**
    `SUPABASE_SERVICE_ROLE`.

## 5. Failure & offline behavior

- **Worker offline at request time:** clean 503 + upload-export message.
- **Worker dies AFTER a job is claimed:** `requeue_stale_claims` recovers
  scrape/watchlist claims older than **5 minutes** whose **owner heartbeat** is
  stale; `fail_expired_worker_jobs` fails anything still active after **9
  minutes**. Terminal rows are retained ~1 hour.
- **Orphan postback:** complete/failed for a forgotten task still
  `persist_run`s (`orphan:true`); the public poll may already have 404'd.
- **Wrong lease:** 409 — a requeued job's old postback cannot complete under the
  new owner.

## 6. Observability

- **Dashboard:** `GET /admin/dashboard` (login form; no secrets in query strings).
- **Worker status** (`GET /admin/api/worker`): online, heartbeat age, version
  match, queue, current jobs.
- **Fleet health:** `GET /api/health/workers` uses the 300s offline threshold.
- **Run history:** `persist_run` → local `runs/*.json` + best-effort `ops_runs`.

## 7. Persistence & leases

- Desktop-worker jobs (`scrape` / `watchlist`) write-through to `ops_tasks`
  (migration `006`) including `claimed_by` + `lease_token` (migration `010`).
- Backend startup calls `load_pending_tasks()` so non-terminal jobs survive a
  Render restart; `poll_token` round-trips so open browser tabs keep polling.
- CSV `analyze` tasks stay process-local on purpose (they need wiped local files).

## 8. Product note

The desktop exists for **deep HTML history**. CSV/ZIP export upload
(`/api/analyze`) remains the zero-block offline path when no worker is online.
