# X370 Safari scrape worker

Live username scan: the browser talks to Render; Render **queues** jobs in
Supabase `ops_tasks` (mw_new); the always-on X370 box on a residential IP
polls outbound, scrapes with curl_cffi Safari, and posts stats back.

Never scrape Letterboxd from Render. One job at a time. Serial page fetches.

## Version handshake (do not skip this)

Both sides share `WORKER_PROTOCOL_VERSION = 5`
(`backend/app/config.py:worker_protocol_version` and
`backend/app/worker/safari_worker.py:WORKER_PROTOCOL_VERSION`).

Every heartbeat JSON includes:

```json
{
  "worker_id": "x370-…",
  "protocol_version": 5,
  "git_sha": "<full sha>",
  "scrape_transport": "curl_cffi_safari",
  "max_concurrency": 1
}
```

Render compares:

1. `protocol_version` must equal the backend setting.
2. If both sides have a git sha (`RENDER_GIT_COMMIT` / `BACKEND_GIT_SHA` on
   Render, `git rev-parse HEAD` on X370), they must match.

Mismatch → **409** `{error_code: "worker_version_mismatch", expected_protocol_version, expected_git_sha}`.
The heartbeat is **not** recorded, so enqueue stays offline until the worker
updates. The worker then:

1. `git fetch origin && git pull --ff-only` in the repo root
2. `systemctl --user restart movieswrapped-worker.service`
3. exits so systemd brings up the new code

Bump **both** constants together when the control-plane payload changes.
A backend deploy that only changes analysis code still changes the git sha,
so the worker self-updates on the next heartbeat.

## Queue + cache

The live queue is the Render process dict `task_manager._tasks`. Supabase
`ops_tasks`, `ops_workers`, and `scrape_result_cache` are a best-effort
mirror. The G1 brief reports those three tables empty in production. See
`docs/scrape-queue-and-cache.md` before treating them as the source of truth.

- Intended durability is `ops_tasks` (migrations `006`, `010`, `012`). Render
  startup calls `load_pending_tasks()` only when that mirror has rows.
- Repeat scrapes for the same `username + analysis_period` are meant to hit
  `scrape_result_cache` for 24 hours. A miss, or Supabase disabled, runs a
  live job. There is no on-disk result cache on Render.
- Frontend polls `queue_position`, `eta_seconds` (~15s per job ahead), and
  `queue_wait_ms`.
- More than `SCRAPE_QUEUE_CAP` (20) pending or running scrapes returns
  503 `queue_full` and points at the bookmarklet (`/import`) and ZIP upload.

## Offline UX

Heartbeat older than 60s → `503 desktop_worker_offline` with copy
"live scan is offline right now". The landing page offers the bookmarklet
(`/import`) and ZIP upload.

## systemd --user

`scripts/install-x370-worker.sh` writes:

- `Restart=always`
- `WantedBy=default.target`
- `loginctl enable-linger $USER` so the unit starts at boot without a login

Health (no secrets in output): `scripts/check-x370-worker-health.sh`.

Logs: `journalctl --user -u movieswrapped-worker.service -f`.
The worker redacts `WORKER_TOKEN` / `TMDB_API_KEY` if they appear in error
strings. Never `cat ~/.config/movieswrapped/worker.env`.
