# Movies Wrapped

**Ready-to-use visualizing of a ZIP folder from Letterboxd.**

Export your data from Letterboxd **Settings → Data → Export Your Data**, drop the ZIP here, and get a wrapped-style recap: story playback, results stats, and shareable landscape cards. No username scrape.

→ **Live site:** [movieswrapped.netlify.app](https://movieswrapped.netlify.app/)

---

## Features

- **ZIP / folder upload** — `watched.csv`, `diary.csv`, `ratings.csv`, `reviews.csv`, `profile.csv` from the Letterboxd export
- **All Time / Last 12 Months** — results toggle when `diary.csv` has dated watches
- **Cinema Scale** — Shannon entropy across geography, time, languages, volume, genres, directors (`sinefil_meter`, `cine_v2`)
- **Story** — full-viewport scenes with Framer Motion; lazy-loaded TMDB stills at w500+ with initials/empty fallbacks (no soft w185 upscales)
- **Share** — landscape cards, design chips under a large preview, actor/director swap behind **Tune actor and director**
- **TMDB enrichment** — posters and portraits; reviews attach by Letterboxd URI first, then title/year

---

## Animations

Story playback is the motion surface: scene transitions, poster cascades, and person/review sequences. Respect `prefers-reduced-motion` (person cards skip hover scale). Share export is a static PNG of the live card, not a recording of the story.

---

## Extending this

The ZIP path is the product. Useful next seams without bringing scrape back:

- **New results section** — add a gated component under `frontend/src/containers/results/sections/` and emit fields from `backend/app/services/`
- **New share layout** — register a landscape variant in `frontend/src/components/share/registry.ts`
- **Story beat** — `frontend/src/components/story/slides/buildSlides.tsx` + `media.ts` (keep poster sizes at w500 or larger)
- **Richer ZIP identity** — resolve `boxd.it` short links if review posters still miss

Username scrape, watchlist jobs, and the desktop worker live on `archive/scrape`, not on `main`.

---

## Architecture

```
┌──────────────────┐     ┌─────────────────┐     ┌──────────────────┐
│  Next.js 15 SPA  │────▶│  FastAPI Backend │────▶│  Supabase        │
│  (Netlify static)│     │  (Render)        │     │  sessions, runs  │
└──────────────────┘     └─────────────────┘     └──────────────────┘
```

- **Frontend:** Next.js 15 (static export), React 19, TailwindCSS 4, Recharts, Framer Motion
- **Backend:** FastAPI, pandas/numpy, aiohttp — ZIP extract + TMDB match
- **Database:** Supabase (anon/publishable key only)
- **Images:** TMDB CDN for display; backend `/tmdb-proxy/` for share-canvas export

---

## 🚀 Quick Start (Local Dev)

```bash
# Clone
git clone https://github.com/SemihMutlu07/letterboxd_wrapped.git
cd letterboxd_wrapped

# Backend
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env    # fill in TMDB_API_KEY
python -m app.main      # → http://localhost:8000

# Frontend (separate terminal)
cd frontend
npm install
npm run dev:frontend    # → http://localhost:3000
```

Or use the combined launcher:
```bash
cd frontend && npm run dev
```
(Starts both backend and frontend via `concurrently`.)

---

## 🔐 Environment Variables

### Backend (`backend/.env`)

| Variable | Required | Description |
|---|---|---|
| `TMDB_API_KEY` | ✓ | The Movie Database API key |
| `FRONTEND_ORIGINS` | (optional) | Comma-separated extra CORS origins (production Netlify URLs are already hardcoded) |
| `SUPABASE_URL` | | New Supabase project URL |
| `SUPABASE_ANON_KEY` | | Publishable anon key (never service_role) |

### Frontend (`frontend/.env.local`)

| Variable | Required | Description |
|---|---|---|
| `NEXT_PUBLIC_API_BASE` | ✓ | Backend URL (local: `http://localhost:8000`, prod: `https://wrapped-backend.onrender.com`) |
| `NEXT_PUBLIC_SUPABASE_URL` | ✓ | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✓ | Publishable anon key |
| `NEXT_PUBLIC_POSTHOG_KEY` | | PostHog analytics key |
| `NEXT_PUBLIC_POSTHOG_HOST` | | PostHog ingest host, e.g. `https://us.i.posthog.com`; required when `NEXT_PUBLIC_POSTHOG_KEY` is set |

---

## Supabase Tables

| Table | Purpose |
|---|---|
| `user_sessions` | Anonymous session tracking (consent-gated) |
| `feedback` | User feedback submissions (rate-limited) |
| `analysis_runs` | Run logs mirrored from backend (analysis, watchlist, date-night) — survives Render restarts |
| `ops_runs` / `ops_watchlist_runs` / `ops_date_night_runs` | Operational run history with RLS |

---

## 📜 License

MIT — see [LICENSE](LICENSE) (if any).

---

## 👤 Author

[Semih Mutlu](https://github.com/SemihMutlu07) — built as a personal project to explore film data visualization. Contributions and feedback welcome!
