# Movies Wrapped (Letterboxd Wrapped)

## What this repo does
Analyze a user's Letterboxd export and generate a "wrapped"-style film stats summary.
Input path: ZIP or CSV/folder export from Letterboxd Settings → Data. Username scrape is archived on `archive/scrape`, not on live `main`.
Frontend is a static Next.js export; backend is FastAPI that processes uploads and enriches with TMDB.

## Tech stack
- Frontend: Next.js 15 (App Router), React 19, TypeScript, TailwindCSS, Recharts, Framer Motion
- Backend: Python, FastAPI, Uvicorn, pandas/numpy, aiohttp/aiofiles
- Scraper: archived on `archive/scrape` (not on live `main`)
- Database: Supabase (client-side insert/upsert for `user_sessions`, `feedback`, `analysis_runs`)
- Analytics: PostHog (consent-gated), in-app helper modules
- Deployment: Frontend on Netlify static export (`output: 'export'`); backend is **live on Render** at `https://wrapped-backend.onrender.com` (built from `backend/Dockerfile`; `netlify.toml` sets it as the production `NEXT_PUBLIC_API_BASE`)

## Repo structure
- `frontend/src/app`: Next.js pages + route handlers (`page.tsx`, `results/page.tsx`, `api/*/route.ts`)
- `frontend/src/components`: UI components (landing, share modal, feedback, error boundary, etc.)
- `frontend/src/containers/results`: Results screen sections (incl. `sections/` — core production components; despite past naming, nothing here is a Test Lab experiment)
- `frontend/src/lib`: API calls, analytics, session handling, Supabase client, utils
- `frontend/src/hooks`: Custom hooks (performance/visibility)
- `backend/app/main.py`: FastAPI app factory, lifespan, CORS, router includes, `/` + `/health`
- `backend/app/config.py`: Pydantic settings (env loading, CORS origins)
- `backend/app/task_manager.py`: In-memory async task state (used by `/api/analyze` polling)
- `backend/app/analysis_utils.py`: Safe numerical helpers + `compute_cinema_scale`
- `backend/app/routes/{analyze,tmdb,feedback}.py`: FastAPI routers
- `backend/app/services/{analysis,tmdb_client}.py`: Domain logic (CSV pipeline, TMDB)
- `backend/app/models/`: Pydantic request/response shapes
- `backend/Dockerfile`, `backend/requirements.txt`, `backend/pytest.ini`, `backend/tests/`

## Environment variables (never hardcode values)
Backend:
- `TMDB_API_KEY` (required)
- `FRONTEND_ORIGINS` (optional comma-separated extra CORS origins; the custom domain and production Netlify URLs are already hardcoded)
- `SUPABASE_URL` (new project: `https://ghumergebwwrwlykwjsu.supabase.co`)
- `SUPABASE_ANON_KEY` (publishable key only — never service_role)

Frontend:
- `NEXT_PUBLIC_API_BASE` (base URL for backend API calls)
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `NEXT_PUBLIC_POSTHOG_KEY` (PostHog Project API Key, public client key)
- `NEXT_PUBLIC_POSTHOG_HOST` (e.g. `https://us.i.posthog.com`; required alongside KEY — analytics silently stays off if missing)

Desktop worker (Windows):
- `TMDB_API_KEY` (same key as backend)
- `WORKER_BACKEND_URL` (backend URL to poll for jobs)
- `WORKER_TOKEN` (shared secret for X-Worker-Token header)
- Worker does NOT need Supabase keys — backend mirrors run logs to Supabase.

Rules:
- Never write `.env` values into files.
- Never commit secrets.
- Prefer documenting required env keys in README/CLAUDE only.
- **Supabase service_role key was leaked in git history and the old project is decommissioned. New project uses publishable (anon) key only. If the Windows desktop has an old `backend/.env` with `SUPABASE_SERVICE_ROLE=...`, delete that line and replace with the new `SUPABASE_URL` + `SUPABASE_ANON_KEY` above.**

## Local development
Frontend:
- `cd frontend`
- `npm run dev:frontend`

Backend:
- Preferred: `npm run dev:backend` (from frontend scripts; defaults to port 8000, override with `BACKEND_PORT`)
- Alternative: `cd backend && python app/main.py` (port 8000)

Both:
- `npm run dev` (sets `NEXT_PUBLIC_API_BASE` from `BACKEND_PORT` and refuses to start if that port is already a different service)

## API surface
Backend (routers in `backend/app/routes/`):
- `GET /` — root banner (in `main.py`)
- `GET /health` — liveness probe (in `main.py`)
- `POST /api/analyze` — **202 Accepted**, returns `{task_id, status}`; analysis runs in a background task (`routes/analyze.py`)
- `GET /api/progress/{task_id}` — poll task state (`pending|running|done|failed` + stage/message/progress + final `result`)
- `GET /api/progress` — legacy: returns the most recent active task's stage (no task_id)
- `GET /api/tmdb/person/search` (`routes/tmdb.py`)
- `GET /tmdb-proxy/{path:path}` + `OPTIONS /tmdb-proxy/{path:path}` — image proxy + CORS preflight
- `POST /api/parse-username` (`routes/feedback.py`)
- `POST /api/feedback` (rate-limited, `routes/feedback.py`)
- `POST /api/report` (rate-limited, `routes/feedback.py`)

Frontend route handlers (built into static export only when statically generable):
- `POST /api/upload` — placeholder, does not process uploads (see Known issues)
- `POST /api/analytics` — validates event payload and returns `ok`

Run logging:
- Each successful `analyze` writes `backend/runs/{username}-{iso-ts}.json` (best-effort; gitignored).

## Hard constraints (do not violate)
- Read the relevant file(s) before making any change.
- Change one thing at a time; keep diffs small.
- Preserve existing code style and structure.
- `next.config.ts` has `output: 'export'`:
  - Do NOT add server-only features or assumptions (no SSR-only features, no runtime server dependencies).
- Commit messages must be in English.

## Contribution workflow (external contributors)

External contributors (like Berdan) must follow these rules to avoid merge chaos:

### Branch strategy
- **Fork-based**: Contributors fork the repo and work on their own fork. No direct pushes except by repo owner.
- **Owner branches**: Owner may use `main`, `desktop_server` (worker sync), or short-lived feature branches locally.

### Workflow for external PRs
1. Contributor forks → creates a feature branch (e.g. `feat/widget-redesign`)
2. Before opening a PR, contributor **rebases onto latest `origin/main`** and resolves all conflicts locally
   ```
   git fetch upstream
   git rebase upstream/main
   ```
3. PR is opened against `main`. Squash-merge preferred (single commit lands on main).
4. After merge, contributor deletes their remote feature branch.

### What went wrong before (so it doesn't repeat)
- **Dead code sweep done twice**: Once on main (`c2eae18`), once on Berdan's branch (`423648c`). The merge brought back old Test Lab files that main had already cleaned. Solution: always rebase before PR, and keep sweeping decisions on main, not in PR branches.
- **RSS subsystem resurrection**: The Berdan merge conflict resolution accidentally preserved dead files. Solution: after merging a PR, run a quick `find` check for known-dead patterns (RSS, Sentry, etc.).
- **Experimental tree vs redesign**: Berdan's PR (#11) replaced `results/page.tsx` with `WrappedBrutal.jsx`. Concurrent feedback features (FeedbackFab, ShareModal, PostHog) became dead code because they lived in the old page. Solution: **one PR = one scope**. If a PR rewrites the page shell, it must either integrate or explicitly defer existing features.

### PR readiness checklist (for contributors)
Before opening a PR, verify:
- [ ] `git rebase origin/main` done, no conflicts
- [ ] `cd frontend && npx tsc --noEmit` passes
- [ ] `cd backend && pytest` passes (or known pre-existing failures documented)
- [ ] No `.env`, secrets, or credentials in the diff
- [ ] Commit messages in English
- [ ] No deleted files that are still referenced by live code (check with `rg`)

## Known issues (triage order)
1) `frontend/src/app/api/upload/route.ts` returns 501
   - This is intentional for the static export build. Backend API should be used for all processing.
2) **CSV-upload ("analyze") task state still does not survive backend restarts, by design**: `task_manager.py` keeps all task/job state in a process-local dict. `kind="analyze"` tasks (CSV/ZIP upload analysis) read local disk files a restart also wipes, so they're intentionally excluded from persistence — a restart still drops them, and `GET /api/progress/{task_id}` returns `boot_age_seconds`/`likely_server_restart` context so the frontend can show a clear "server restarted, please try again" message. **Desktop-worker jobs (scrape/watchlist/date-night/find-film) now survive a restart** (fixed 2026-07-20): `task_manager.py` write-through-persists them to the `ops_tasks` table (migration `006_ops_tasks.sql`) at every create/claim/terminal/requeue transition (not every progress tick), and `load_pending_tasks()` reloads non-terminal rows back into memory at backend startup, before the app starts serving traffic. `poll_token` round-trips exactly so an already-open browser tab's poll loop keeps working transparently across the restart.

Resolved (kept for history, do not re-triage):
- ~~WrappedBrutal orphan gap~~ — the `/brutal` route and `WrappedBrutal.jsx` were deleted 2026-07-20 after all 5 features were ported to `results/page.tsx`. (Note: the old claim that `PageViewTracker` was missing was wrong — it is mounted globally in `layout.tsx`.)
- ~~desktop_server branch out of sync~~ — resolved via PR #24; `origin/desktop_server` and `origin/main` are identical.

## Results page design tokens
The results screen uses the modern Letterboxd-dark theme — keep new results components consistent:
- Dark bg `#1a1a1a`, white text hierarchy, `border-white/8`, `rounded-2xl`, orange-400 accents (slate for secondary actions).
- Do NOT reintroduce neo-brutal styling. The old neo-brutal shell (`WrappedBrutal.jsx`, `/brutal` route) was deleted 2026-07-20 after its 5 features (FilmModal, director portraits in PersonFilmsModal, LangModal, review blur/reveal toggle, enriched FilmPosterCard modal) were ported into `results/page.tsx` and its sub-components.

## AI workflow (how to work in this repo)
When asked to implement a change:
1) Locate and open the relevant file(s) first.
2) Propose the smallest safe change.
3) Implement and keep formatting consistent.
4) Update any related types/helpers/tests if applicable.
5) If the change touches analytics or DB: ensure consent gating and no secret leakage.

## Cinema Scale scoring (model_version: cine_v2)
The `sinefil_meter` score uses Shannon entropy across 6 axes (geography, temporal,
languages, volume, genres, directors) computed in `backend/app/analysis_utils.py:compute_cinema_scale`.
TMDB popularity is **not** part of the score — it was removed because popularity decays
over time and inflated nearly every user to 80+. Popularity is still available as a
separate `stats.popularity_info` field for Mainstream-vs-Niche display but must never
feed back into the cinema scale number.

## Backend structure (already modular)
The FastAPI backend is already split into `routes/`, `services/`, `models/`, with `task_manager.py`
and `config.py` separated from `main.py`. Don't reintroduce a monolithic `main.py` — add new
endpoints under the appropriate router and new domain logic under `services/`.

CORS + error-middleware ordering matters: unhandled-exception handling is implemented as a
**custom `@app.middleware("http")`** that wraps the response *inside* the CORS layer.
Do NOT replace it with `@app.exception_handler(Exception)` — Starlette's `ServerErrorMiddleware`
sits *outside* `CORSMiddleware` and would strip `Access-Control-Allow-Origin` on 500s.

When returning JSON that may contain NaN (e.g. pandas-derived `poster_path` for missing rows),
guard with `isinstance(x, str)` before placing it in the response — `JSONResponse(allow_nan=False)`
will otherwise raise during render and surface as a CORS-shaped 500 in the browser.

## Operational safety
- Supabase: use ANON/public key only in frontend. Never introduce service_role keys.
- PostHog: client key only in frontend; keep consent gating consistent and default-safe.
- TMDB: key lives on backend; do not proxy it to the frontend.

## Data model & Supabase guidelines

### Two zones, separate responsibilities

| Zone | Tables | Written by | Purpose |
|------|--------|------------|---------|
| **Frontend** | `user_sessions`, `analysis_runs`, `feedback` | Browser (client-side) | User-facing flow: consent, analysis results, feedback |
| **Backend** | `ops_runs`, `ops_watchlist_runs`, `ops_date_night_runs`, `ops_tasks` | Server (best-effort mirror) | Admin dashboard durability across restarts; `ops_tasks` is also read back at startup to resume desktop-worker jobs (`task_manager.load_pending_tasks()`) |

- Both zones use the **anon (publishable) key only** — no service_role key anywhere.
- Backend ops tables are best-effort mirrors that swallow errors; an outage never breaks the request path.
- `analysis_runs.summary` is a full JSONB blob (`{details: {...}, preview: {...}, schema_version, saved_at}`).
  Since migration 001, 5 key metrics are also extracted to queryable INT/FLOAT/TEXT columns:
  `total_films`, `sinefil_meter`, `cinematic_persona`, `average_rating`, `total_countries`

### PostHog ↔ DB split

PostHog (consent-gated) handles **behavioral analytics** — page views, button clicks, funnels, timing,
error rates, feature usage patterns. No PII or film titles.

Supabase stores **structured application data** — analysis results, sessions, feedback messages,
operational logs. Cross-user queries (`"average sinefil_meter"`, `"top genres across all users"`)
use the extracted columns in `analysis_runs`.

### Writing to tables

**Frontend tables** are written from `@/lib/supabase/*.ts` helpers:
- `sessions.ts` → `upsertUserSession()` on consent decision
- `analysis_runs.ts` → `startAnalysis()` + `finishAnalysis()` around each analysis
- `feedback.ts` → `insertFeedback()` on user submission

When adding new columns to `analysis_runs`, update both:
1. The Supabase table schema (via migration SQL in `backend/migrations/`)
2. `extractMetrics()` in `analysis_runs.ts` to populates the new column from the summary

**Backend ops tables** are written via `supabase_ops.insert()` from services. They're pure REST
calls (no Supabase JS SDK), always wrapped in try/except that logs warnings instead of crashing.

### Migrations

- Migration SQL lives in `backend/migrations/` with sequential naming: `001_*.sql`, `002_*.sql`, etc.
- Run migrations in Supabase Dashboard → SQL Editor.
- Backwards-compatible only — new columns must have defaults or be nullable.
