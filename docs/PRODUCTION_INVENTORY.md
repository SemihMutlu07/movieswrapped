# Production Ownership Inventory — Movies Wrapped

**Date:** 2026-10-01  
**Scope:** Read-only inventory of repo `main` (`6c263cd`) plus live HTTP/CI/Supabase schema evidence.  
**Not done:** no deploys, no production config edits, no schema changes, no secret material in this file.

This document is evidence Semih can show for **production ownership** on junior / product-engineer interviews: what is actually running, what is proven in code, and which gaps a hiring manager would still poke.

---

## How to read this

Each bar is scored **yes / partial / no** against what a hiring manager typically wants to see, not against a FAANG-scale platform. Evidence is file paths (and live URLs where checked). Features that are not in this checkout are not claimed.

**Live product (checked 2026-10-01):**

| Surface | URL | Probe |
|---|---|---|
| Frontend (Netlify) | https://movieswrapped.netlify.app/ | HTTP 200 |
| Custom domain | https://movieswrapped.com/ and https://www.movieswrapped.com/ | HTTP 200 |
| Backend (Render) | https://wrapped-backend.onrender.com/health | HTTP 200 `{"status":"ok"}` |
| GitHub homepage field | https://letterboxd-wrapped-chi.vercel.app/ | HTTP 404 (stale) |

**Repo vs live docs drift:** `README.md` still shows clone URL `SemihMutlu07/letterboxd_wrapped`; the GitHub repo this checkout belongs to is `SemihMutlu07/movieswrapped`.

---

## Stack (what is actually shipping)

| Layer | What | Evidence |
|---|---|---|
| Frontend | Next.js 15 App Router, React 19, TypeScript, Tailwind 4, Framer Motion, Recharts; **static export** (`output: 'export'`) | `frontend/package.json`, `frontend/next.config.ts` |
| Hosting (FE) | Netlify static (`publish = "out"`), `NEXT_PUBLIC_API_BASE` baked at build | `netlify.toml` |
| Backend | FastAPI 0.139 + Uvicorn, pandas/numpy, aiohttp; **one worker** (in-memory tasks) | `backend/requirements.txt`, `backend/Dockerfile` |
| Hosting (BE) | Render web service, bind `0.0.0.0:$PORT` | `backend/Dockerfile`; live `/health` |
| Data | Supabase project `mw_new` (`ghumergebwwrwlykwjsu`, `ACTIVE_HEALTHY`, eu-central-1). Older project `movieswrapped` is `INACTIVE` (matches CLAUDE.md rotation after a leaked service_role key). | Live project list; `CLAUDE.md` |
| Analytics | PostHog JS (client key + host). Sentry is **not** in application code (only a leftover `SENTRY_DSN=` line in `backend/.env.example`). CI even **blocks** `sentry_sdk` resurrection. | `frontend/src/lib/posthog.ts`, `.github/workflows/pr-checks.yml` |
| Images | TMDB CDN for on-page display; backend `/tmdb-proxy/` for share-canvas CORS | `frontend/src/lib/analytics.ts`, `backend/app/routes/tmdb.py` |

There is **no user login product**. Identity is a browser `session_id` plus an optional Letterboxd username parsed from the export. Admin is a shared secret, not OAuth.

---

## Production-shaped vs demo

**Production-shaped (real users, real hosting):**

- ZIP / CSV upload → async analyze → poll → results / story / share cards.
- Live Netlify + Render + custom domain, all returning 200 at inventory time.
- Frontend tables on live Supabase: `user_sessions` (~236 rows), `analysis_runs` (~452 rows), `feedback` (~5 rows). `ops_runs` (~66 rows) is the backend run mirror.
- CI on PRs/pushes, 15-minute GitHub Actions health ping, Dependabot, admin dashboard code, PostHog event contract.

**Demo / leftover (do not sell as the live product):**

- `/smt` offline fixture path (`frontend/src/app/smt/page.tsx`, `frontend/public/demo/`).
- Username scrape, desktop worker, watchlist / date-night **are archived** (`README.md`: “Username scrape is archived on `archive/scrape`, not on live `main`”). This branch has **no** scrape pipeline, **no** `WORKER_TOKEN` handler, **no** `load_pending_tasks()`. Empty live tables `ops_tasks` / `ops_workers` / `ops_watchlist_runs` / `ops_date_night_runs` / `ops_worker_events` (0 rows) are leftover schema.
- `frontend/vercel.json` and the GitHub repo homepage still point at a dead Vercel URL. Production frontend is Netlify.
- `CLAUDE.md` still describes desktop-worker restart persistence that **is not in** `backend/app/task_manager.py` on this branch.

---

## Scorecard

| # | Bar | Score | One-line why |
|---|---|---|---|
| 1 | Auth (sessions, OAuth, secrets, RBAC) | **Partial** | Strong admin cookie + secret handling in code; **no product OAuth**; live RLS on user/ops tables is far more open than the SQL files claim. |
| 2 | SQL / data modeling | **Partial** | Real tables, extracted metrics, indexes, JSONB summaries; frontend CREATE is not in-repo; live policies drifted from `005`. |
| 3 | Testing | **Partial** | Solid unit/API/share-card coverage in CI; story Playwright not in CI; **latest `main` PR Checks is red** (pip-audit). |
| 4 | Debugging / error handling | **Partial** | Typed frontend errors + ErrorBoundary; CORS-safe 500s; backend logs are stdout-only; failed ZIP jobs are not persisted. |
| 5 | Observability | **Partial** | PostHog + `/health` cron + admin run list; no traces/metrics; health is liveness-only; source maps not uploaded. |
| 6 | Migrations | **Partial** | Numbered SQL + documented manual apply; Supabase migration history only records two dashboard migrations; live RLS ≠ repo. |
| 7 | Reliability / deploy | **Partial** | Real hosts, Dockerfile/port, human-gated release; analyze state dies on Render restart; ephemeral disk; CI security job failing. |

Honest summary: this is a **real production hobby/product**, not a localhost demo — but several “ownership” proofs (RLS actually locked down, green CI, migration runner, restart-safe jobs) are incomplete or drifted.

---

## 1. Auth — **partial**

### What exists

| Piece | Behavior | Evidence |
|---|---|---|
| Product identity | Anonymous `session_id` in `sessionStorage`; username from export filename / `profile.csv` | `frontend/src/lib/session-id.ts`, `backend/app/routes/analyze.py` |
| Supabase client | Anon/publishable key only; `persistSession: false` (no Supabase Auth session for visitors) | `frontend/src/lib/supabaseClient.ts` |
| Backend secrets | `TMDB_API_KEY` required at startup; never sent to the browser. CORS allowlist hardcoded for production hosts + optional `FRONTEND_ORIGINS` | `backend/app/config.py`, `backend/app/main.py` lifespan |
| Admin | `ADMIN_SECRET` required (503 if missing). Login sets `mw_admin_session` HMAC cookie: HttpOnly, Secure on HTTPS, SameSite=strict, 8h expiry, path `/admin`. Mutation requests check `Origin`. Query-string `?key=` is **rejected** (redirect, no cookie). Tests cover this. | `backend/app/admin.py`, `backend/tests/test_admin_incidents.py` |
| Task polling | `poll_token` on 202; `X-Task-Token` required to read progress | `backend/app/routes/analyze.py`, `frontend/src/lib/api.ts` |
| Abuse controls | In-memory rate limits: analyze 3/10 min; progress 120/60s; TMDB search 60/60s; proxy 120/60s; feedback 3/10 min | `backend/app/security.py`, `backend/app/routes/feedback.py` |
| ZIP safety | Path traversal / symlink / encrypted-entry rejection; size caps 50 MB request / 200 MB expanded | `backend/app/routes/analyze.py` `_safe_extract_letterboxd_zip` |
| Ops intent (repo) | Backend password-grants as `ops@movieswrapped.internal` (anon key + dedicated user, not service_role) | `backend/app/supabase_ops.py`, `backend/migrations/005_lock_ops_to_backend_user.sql` |

### What is missing / weaker than the story

- **No OAuth, no user accounts, no RBAC beyond “admin secret vs everyone else.”** `analysis_runs.user_id` is reserved (`008_analysis_runs_schema.sql`) and unused.
- **Live RLS does not match the repo.** On project `mw_new` (read 2026-10-01, policy names only — no row dumps):
  - `user_sessions`, `analysis_runs`: anon `SELECT`/`INSERT`/`UPDATE` with `qual = true` (any holder of the **public** anon key can read or overwrite every row).
  - `feedback`: anon insert + select-all.
  - `ops_runs`, `ops_watchlist_runs`, `ops_date_night_runs`: anon `ALL` with `true` — **`005_lock_ops_to_backend_user.sql` was not applied here.**
  - `ops_worker_events`: still the open anon insert/select from `002`.
  - `ops_tasks` and `ops_workers` **are** locked to the ops email (matches `006` / `007`).
- Table **GRANTs** to `anon` include DELETE/TRUNCATE on those tables (PostgREST typically will not expose TRUNCATE; RLS still allows wide SELECT/UPDATE on the frontend tables).
- Analyze rate limit keys off `request.client.host` (`security.py`) **without** `X-Forwarded-For` / `ProxyHeadersMiddleware`. Feedback **does** use `X-Forwarded-For`. Behind Render this can collapse to one shared IP (global throttle) or be spoofable, depending on proxy headers.
- Analytics “consent” is hard-coded accept: `getConsent()` always returns `'accept'` (`frontend/src/lib/session-id.ts`). Docs that still describe a banner (`docs/posthog-observability-checklist.md`) are stale.
- Admin still accepts `Authorization: Bearer` **and** `x-admin-key` as well as the cookie (`_require_admin`).
- `SENTRY_DSN` in `backend/.env.example` is unused.

**Interview framing:** you can talk through admin cookie design, poll tokens, ZIP traversal guards, and “anon key only / service_role rotated.” You should **not** claim row-level security is locked down in production — live policies contradict `005`.

---

## 2. SQL / data modeling — **partial**

### Two zones (as designed)

Documented in `CLAUDE.md` and visible live:

| Zone | Tables (live) | Writer | Purpose |
|---|---|---|---|
| Frontend | `user_sessions`, `analysis_runs`, `feedback` | Browser via `@supabase/supabase-js` + anon key | Consent/session, run log, feedback |
| Backend ops | `ops_runs` (used), plus empty scrape leftovers | FastAPI `supabase_ops` (best-effort) | Admin durability across Render restarts |

`analysis_runs` has queryable columns `total_films`, `sinefil_meter`, `cinematic_persona`, `average_rating`, `total_countries` (migration `001` + `extractMetrics()` in `frontend/src/lib/supabase/analysis_runs.ts`). Persistence strips review bodies / likers and keeps aggregates (`buildPersistedDetails`). Partial unique index on `task_id`. Check constraints on `consent` and `device_type`. Index on `sinefil_meter`.

Cinema Scale (`cine_v2`) is Shannon entropy in `backend/app/analysis_utils.py`; TMDB popularity is **not** in the score (`CLAUDE.md`).

### Gaps

- **No in-repo CREATE** for `user_sessions` / `analysis_runs` / `feedback`. Live they came from dashboard migrations `create_user_sessions_feedback_analysis_runs` + `add_set_updated_at_function_and_triggers`. Repo only **alters** `analysis_runs` (`001`, `008`).
- No FK from `analysis_runs.session_id` → `user_sessions.session_id`.
- `getSinefilPercentile()` counts **all** `analysis_runs` rows (`analysis_runs.ts`) — that only works because anon SELECT is open; locking RLS without a SECURITY DEFINER RPC would break the percentile.
- Leftover scrape tables still in the live schema with 0 rows.
- `ops_dashboard_settings` (migration `003`) is **absent** live; `EXPECTED_OPS_TABLES` in `supabase_ops.py` still lists it.
- JSONB `summary` / `payload` is flexible but opaque except for the five extracted columns.

---

## 3. Testing — **partial**

| Layer | What | In CI? | Evidence |
|---|---|---|---|
| Frontend unit | Vitest + Testing Library; ~53 `*.test.ts(x)` files (errors, PostHog, share, results, i18n, analysis_runs, …) | Yes — `npm run test` | `.github/workflows/pr-checks.yml`, `frontend/vitest.config.ts` |
| Frontend typecheck / lint / build | `tsc --noEmit`, `next lint`, `next build` with prod API base | Yes | `pr-checks.yml` |
| Share cards | Playwright Chromium against `/dev/share-cards` | Yes — `npm run test:share-cards` | `frontend/playwright.config.ts` |
| Story Playwright | `frontend/tests/story/*.spec.ts` + `playwright.story.config.ts` | **No** | not referenced in `package.json` scripts or CI |
| Backend | pytest ~20 files: health, analyze 202, ZIP safety, admin cookies, cinema scale, datasets, … | Yes | `backend/pytest.ini`, `backend/tests/` |
| Security audit | `npm audit --omit=dev --audit-level=high`; `pip-audit` with documented Starlette ignores | Yes | `pr-checks.yml`, `backend/security-audit-allowlist.md` |
| Hygiene | Dead-code grep (`sentry_sdk`, RSS, TestLab); merge-conflict guard | PR-only | `pr-checks.yml` |
| Dependabot | weekly npm / pip / actions | n/a | `.github/dependabot.yml` |

**CI truth (as of 2026-10-01):** latest **PR Checks on `main` failed** ([run 35875413473](https://github.com/SemihMutlu07/movieswrapped/actions/runs/35875413473), 2026-09-23). Frontend, backend, and share-cards jobs **passed**; **security** failed: `anyio 4.9.0` → CVE-2026-63374 / CVE-2026-64847 (fix 4.14.2). Starlette ignores in the workflow did not cover this. Health Check workflow has been succeeding on a ~15 min cadence.

There is **no** CI job that uploads a real Letterboxd ZIP to the live Render API. Backend analyze tests mock `_run_analysis`.

---

## 4. Debugging / error handling — **partial**

### Frontend

- Global `ErrorBoundary` with retry/home and `captureException` (`frontend/src/components/ErrorBoundary.tsx`, mounted in `frontend/src/app/RootDocument.tsx`).
- `normalizeError()` maps backend/network failures to stable `reason` codes and ZIP-fallback copy (`frontend/src/lib/errors.ts`, tests in `errors.test.ts`).
- API client maps 404 + `likely_server_restart` to a clear retry message (`frontend/src/lib/api.ts`).
- Failed analyses write `error_code` via `finishAnalysis()` (`LetterboxdLanding.tsx` + `analysis_runs.ts`).
- `/api/report` + `/api/feedback` exist for diagnostic bundles (rate-limited, 5 MB cap) — stored under `uploads/reports/` on the **ephemeral** Render disk (`backend/app/routes/feedback.py`).

### Backend

- CORS-safe unhandled-exception **HTTP middleware** (not Starlette `exception_handler`) so 500s keep `Access-Control-Allow-Origin` (`backend/app/main.py`; explained in `CLAUDE.md`).
- JSON 500 body is generic (`internal_error`); stack goes to stdout.
- Upload 413 at 50 MB; ZIP extractor raises typed `error_code`s (`corrupt_zip`, `unsafe_archive`, …).
- Admin dashboard “Operational Incidents” (`admin.py` + tests).
- Logging: `logging.basicConfig` text format, `LOG_LEVEL` env. **No request IDs, no JSON logs, no APM.**
- `_run_analysis` on exception: `set_task_failed(task_id, str(exc))` only — **does not** call `persist_run(..., ok=False)`, so ops/admin may miss ZIP failures (`analyze.py`). Client may see raw exception text.

---

## 5. Observability — **partial**

| Signal | Present? | Evidence |
|---|---|---|
| Liveness | Yes — `GET /health` → `{status: ok}` | `backend/app/main.py`; GitHub `healthcheck.yml` every 15 min (FE + BE) |
| Readiness | No — health does not check TMDB, Supabase, or disk | same |
| Product analytics | Yes — PostHog after init; funnel documented | `docs/posthog-event-contract.md`, `frontend/src/lib/posthog.ts` |
| Frontend errors | Yes — PostHog `capture_exceptions` + ErrorBoundary | `posthog.ts`, `ErrorBoundary.tsx` |
| Session replay | Configured to mask inputs; depends on PostHog project toggle | `posthog.ts`; checklist says enable only after confirm |
| Source maps | **Not** uploaded — checklist says stack traces will be unreadable | `docs/posthog-observability-checklist.md` |
| Backend traces / metrics | No OpenTelemetry / Prometheus / Sentry | (absence; CI forbids `sentry_sdk`) |
| Per-job TMDB counters | Yes (cache hits, 429s, timings) | `backend/app/services/tmdb_telemetry.py`, `run_log.py` |
| Admin run list | Yes if `ADMIN_SECRET` set | `backend/app/admin.py` |
| Schema tripwire | Startup warning if expected ops tables missing | `supabase_ops.check_expected_schema` |

Health Check **does not** distinguish Render cold-start 503 from a real outage; it only asserts HTTP 200 within 15s. Free Render spin-down is a known platform limit (see Render skill / CLAUDE.md).

---

## 6. Migrations — **partial**

**How schema is supposed to ship:** numbered files in `backend/migrations/` (`001`–`010`), applied **by hand** in Supabase SQL Editor. Comments say they are backwards-compatible (nullable / `IF NOT EXISTS`). `supabase_ops.check_expected_schema()` is a **tripwire**, not a runner.

**What live history actually has** (`list_migrations` on `mw_new`):

1. `20260214172136_create_user_sessions_feedback_analysis_runs`
2. `20260214172813_add_set_updated_at_function_and_triggers`

The numbered repo files are **not** recorded in Supabase migration history. Columns from `001` / `008` / `009` / `010` **are** present on live tables, so someone pasted SQL — but `005` RLS lockdown **did not land**. That is the core migration-ownership gap: **no single source of truth between git and the database.**

`009_schema_cleanup.sql` mixes DELETE of historical rows with `ALTER TABLE` — a dangerous pattern for a “run in SQL Editor” file.

---

## 7. Reliability / deploy — **partial**

### What is production-shaped

- Split hosting: static FE (Netlify) + API (Render). Dockerfile uses shell form so `${PORT:-8000}` expands; host `0.0.0.0` (Render requirement). **No `--workers`** because `_tasks` is process-local (`Dockerfile` comments, `task_manager.py`).
- Release contract: experiment → main → `tsc` + pytest → **explicit** production push. Never deploy from `experiment`. (`CONTRIBUTING.md`)
- Frontend env baked at Netlify build (`netlify.toml`). Backend env documented in `backend/.env.example` / `README.md` (TMDB, CORS extras, Supabase ops user, `ADMIN_SECRET`).
- Restart UX: missing task returns `boot_age_seconds` / `likely_server_restart`; UI tells the user to re-upload (`task_manager.py`, `api.ts`).
- Run logs: local `backend/runs/` (gitignored, **ephemeral on Render**) + best-effort `ops_runs` mirror (`run_log.py`). Retention `RUN_RETENTION_DAYS` (default 30).
- CORS origins include `movieswrapped.com` (tested in `backend/tests/test_config.py`).
- ZIP path is the product; scrape is archived — fewer moving parts in prod.

### Gaps

- **Analyze jobs do not survive restart** (by design, documented). Render deploys / idle spin-down drop in-flight ZIP work.
- Uploads, feedback binaries, and local run JSON live on ephemeral disk.
- **No coded rollback.** Rollback = Netlify deploy / Render deploy dashboard (not in repo). `frontend/vercel.json` is a leftover and is **not** the production host.
- Latest `main` CI is **red** on pip-audit (`anyio`).
- In-memory rate limits reset on every process start.
- GitHub repo homepage still 404s on old Vercel URL — small ownership polish miss.
- Render dashboard was **not** enumerated here (Render MCP workspace unauthorized); hosting claims are from Dockerfile + live HTTP + GitHub healthcheck, not from Render config screenshots.

---

## Gap list (prioritized for the proof story)

Do **not** apply these without Semih’s sign-off. Several are live-database or CI changes.

### P0 — would fail an ownership / security grill

1. **Live RLS ≠ git.** Apply the *intent* of `backend/migrations/005_lock_ops_to_backend_user.sql` on `mw_new` (ops tables: authenticated ops user only). Replace open anon `SELECT`/`UPDATE` on `user_sessions` / `analysis_runs` / `feedback` with insert-own + session-scoped policies (or a tight RPC for percentile). **Human-run in SQL Editor;** this agent did not change production.
2. **Stop claiming consent-gated analytics** until `getConsent()` is real again, **or** update CLAUDE/PostHog docs to “analytics on by default.” Today code and docs disagree.
3. **Green CI on `main`.** Bump `anyio` (and re-review FastAPI/Starlette pins) so `pip-audit` passes; keep Starlette exceptions documented until FastAPI allows 1.x.

### P1 — makes the production story credible

4. **Put frontend table DDL in git** (`user_sessions`, `analysis_runs`, `feedback` CREATE + RLS) so a new project can be rebuilt from the repo. Record numbered migrations in Supabase history (or a `schema.sql` that matches live).
5. **Persist failed ZIP analyses** (`persist_run(..., ok=False)`) and set `error_code` on `set_task_failed` instead of raw `str(exc)`.
6. **Proxy-aware rate limits** (`X-Forwarded-For` / `ProxyHeadersMiddleware`) consistent with `feedback.py`.
7. **Readiness vs liveness:** e.g. `/health` liveness + `/ready` that pings TMDB/Supabase without failing the GitHub cron on cold start (or accept cold start in the probe).
8. **Netlify security headers** (CSP / `X-Frame-Options`) — they exist in unused `frontend/vercel.json`, not in `netlify.toml`.
9. **Drop or archive leftover scrape schema/docs** on `main` (`CLAUDE.md` worker persistence, empty ops_* tables, `backend/start-worker-supervisor.ps1`) so the live product description matches the ZIP-only README.

### P2 — nice for interviews, not blocking

10. Add story Playwright to CI (`playwright.story.config.ts`) and one contract test that hits `POST /api/analyze` without mocking `_run_analysis` (fixture ZIP).
11. Upload PostHog/source maps in Netlify build; add request-id logging on the API.
12. Fix GitHub homepage + remove or clearly mark `vercel.json`.
13. Replace `009` data-deletes with a one-off ops note; keep migrations DDL-only.
14. If product auth is ever added: use it; until then don’t oversell `user_id`.

---

## Suggested next ship (no deploy without human sign-off)

**Single-scope PR that strengthens the proof story the most:**

1. **Docs already in this PR** — this inventory (no prod change).
2. **Next code PR (recommended):** CI green — pin/bump `anyio>=4.14.2` (or whatever FastAPI 0.139 allows) and refresh `backend/security-audit-allowlist.md`. That is a small, testable ownership win.
3. **Next ops change (Semih in SQL Editor, not an agent):** RLS lockdown on `mw_new` matching `005` + tighter frontend-table policies, after confirming `getSinefilPercentile` still works (RPC if needed). Treat as a production config change; take a table/policy backup first.
4. **Follow-up:** commit frontend CREATE+RLS into `backend/migrations/011_*.sql` so git and live cannot drift again.

Do **not** mix RLS, anyio, and a product UI change in one PR (`CONTRIBUTING.md`: one PR = one scope).

---

## Method / limits

- Repo walk of `backend/`, `frontend/`, `.github/`, `docs/`, `netlify.toml`.
- Live HTTP GET of frontend + `/health` only.
- GitHub Actions: `gh run list` / `gh run view` (read-only).
- Supabase MCP: `list_projects`, `list_tables`, `list_migrations`, `get_advisors`, `pg_policies` / grants. **No row contents, no DDL, no policy edits.**
- Render MCP: workspace list unauthorized — no service config pulled from Render.
- PostHog project settings were not re-verified in the PostHog UI; claims are from repo docs + SDK code.
- Env values / API keys were not read or written.

---

## File index (cheat sheet)

| Topic | Paths |
|---|---|
| App factory, CORS, health, 500 middleware | `backend/app/main.py` |
| Settings / CORS hosts | `backend/app/config.py` |
| Admin auth | `backend/app/admin.py` |
| Analyze + poll token | `backend/app/routes/analyze.py` |
| In-memory tasks | `backend/app/task_manager.py` |
| Rate limit | `backend/app/security.py` |
| Supabase ops client | `backend/app/supabase_ops.py` |
| Run mirror | `backend/app/services/run_log.py` |
| SQL | `backend/migrations/*.sql`, `backend/supabase_schema.sql` |
| Frontend session / consent | `frontend/src/lib/session-id.ts` |
| Frontend DB | `frontend/src/lib/supabase/*.ts` |
| Errors | `frontend/src/lib/errors.ts`, `frontend/src/lib/api.ts` |
| PostHog | `frontend/src/lib/posthog.ts`, `docs/posthog-event-contract.md` |
| CI / health | `.github/workflows/pr-checks.yml`, `healthcheck.yml` |
| Deploy | `netlify.toml`, `backend/Dockerfile`, `CONTRIBUTING.md` |
