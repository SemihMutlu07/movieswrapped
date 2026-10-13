# Scrape queue, 24h cache, and G2 load-test plan

Investigation only for where the queue and the 24-hour result cache live.
No production database writes, no migrations, no Render env changes.

Checked from code on 2026-10-13. The task brief reports that production
Supabase project `mw_new` (`ghumergebwwrwlykwjsu`) has empty `ops_tasks`,
`ops_workers`, and `scrape_result_cache`. This note does not re-query that
project.

## Where the live queue is

`POST /api/scrape-profile` appends a `TaskState` to the process-local dict
`task_manager._tasks` in the Render web process (`backend/app/task_manager.py`).
That dict is the queue the X370 worker claims via `GET /api/worker/next`.

Uvicorn is expected to stay at one process. A second process would have its
own dict. Render's filesystem is ephemeral, and nothing in this path writes
the queue to disk.

`persist_task()` is a best-effort upsert to Supabase `ops_tasks`. It runs
only when `settings.supabase_enabled` is true, which requires all four of
`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_OPS_EMAIL`, and
`SUPABASE_OPS_PASSWORD`. If any is missing, the upsert is skipped and the
job exists only in Render memory.

When the flag is on, the write is `fire_and_forget`. `supabase_ops.upsert`
swallows errors and logs a warning. RLS on `ops_tasks` allows the row only
when the JWT email is `ops@movieswrapped.internal` (migration `006`). A bad
login, a missing column (`claimed_by` / `lease_token` from migration `010`),
or a missing table drops the row without failing the HTTP request.

Startup calls `load_pending_tasks()` and reloads non-terminal `kind=scrape`
rows. An empty `ops_tasks` means a Render restart starts with an empty queue
even if browsers are still polling. Those polls 404 once the in-memory task
is gone. Completed jobs are not deleted from `ops_tasks` by the cleanup loop
(that loop only drops terminal rows from memory after one hour). An empty
table means successful upserts are not landing, not that rows expired.

Worker heartbeats update an in-memory timestamp used as the enqueue gate
(max age 60s). The same handler upserts `ops_workers` under the same
Supabase gate. An empty `ops_workers` table is the same failure mode: the
live "online" bit is Render memory, not the table.

## Where the 24h result cache is

`lookup_scrape_cache` / `store_scrape_cache` (`backend/app/services/scrape_cache.py`)
read and upsert Supabase `scrape_result_cache`, keyed by
`username + analysis_period`, TTL 24 hours (migration `012`).

There is no second cache. A miss, a disabled Supabase config, or a swallowed
upsert all fall through to a live scrape. Render disk is not used. An empty
`scrape_result_cache` means repeat usernames are scraped again every time.

The anon key cannot bypass RLS. The cache policy is the same ops-user email
check as `ops_tasks`.

## What this PR does not change

No migration, no production SQL, no Render env edit. Making those tables
authoritative means confirming the four Supabase settings on the Render
service and that migrations `006`, `007`, `010`, and `012` are applied, then
watching for upsert warnings. That confirmation is an operator step after
approval.

## G2 load-test plan (not run)

Goal: 50 concurrent username scans, then confirm overflow.

Do not run this against production Render or production Supabase.

Constraints already in the code:

- `POST /api/scrape-profile` is limited to 5 requests per 10 minutes per
  `request.client.host` (`enforce_rate_limit`, bucket `scrape_profile`,
  limit 5, window 600). The limiter does not read `X-Forwarded-For`.
- One source IP can open 5 jobs per 10 minutes. 50 concurrent accepts need
  10 distinct client IPs, or a staging process whose limit is raised for the
  test only.
- `SCRAPE_QUEUE_CAP` is 20 pending or running scrape jobs. Job 21 gets
  HTTP 503 `queue_full`. The landing banner links to the bookmarklet
  (`/import`) and offers ZIP upload. A 24h cache hit does not take a slot
  and does not count toward the cap.

Suggested staging steps, after this branch is approved and deployed somewhere
other than production:

1. Point a staging worker at the staging backend and send one heartbeat so
   enqueue is online. Do not change production Render env vars.
2. From 10 source IPs (or a staging-only higher per-IP limit), send 50
   concurrent `POST /api/scrape-profile` calls with distinct usernames.
3. Expect 20 responses of 202, and the rest 503 `queue_full` with bookmarklet
   and ZIP copy. A sixth call from one IP inside 10 minutes is 429
   `rate_limited` instead, which is the per-IP limit and not the queue cap.
4. On one claimed job, poll `GET /api/progress/{task_id}` and expect `total`
   4 and `progress` moving 1 (diary), 2 (grid), 3 (reviews), 4 (analysis).
   A running scan should not stay at 0/0.
5. Stop the worker after it has claimed a job. The claim should return to
   `pending` within about two minutes (60s heartbeat max age plus 60s grace
   so one slow POST is not a crash, cleanup tick 5s), not after the old
   ~600s lease. A worker that keeps heartbeating but never finishes still
   waits out the 10-minute lease. A claim reloaded at process start stays
   running until a heartbeat arrives.

The X370 pandas pin (`pandas>=2.3.3` in `backend/requirements.txt`) is not
applied by `git pull`. The worker venv has to reinstall requirements. That
install is an operator step on the X370 box after approval. This change set
does not run it.
