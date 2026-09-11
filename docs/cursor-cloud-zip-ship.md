# Movies Wrapped — Cursor Cloud kartı (ZIP-only live)

Paste this into a Cursor Cloud session on `SemihMutlu07/movieswrapped`.
Local truth (2026-09-08): branch `feat/zip-live-inspect` on top of `origin/main` `39e4c0e`.
Scrape lives on `origin/archive/scrape` only. Do not resurrect it.

## Goal

Ship the ZIP-export path that is already on `main`: user drops a Letterboxd Settings → Data ZIP (or extracted folder), analysis runs, Share your Wrapped works. Close extract gaps for Mac/Windows/iOS, then open a PR. Do not change hosting.

## Territory to inspect first

- `backend/app/routes/analyze.py` — `_looks_like_zip_upload`, `_safe_extract_letterboxd_zip`
- `backend/tests/test_zip_export.py`, `backend/tests/test_api.py`
- `frontend/src/lib/api.ts` (`fileLooksLikeZip`), `frontend/src/lib/api.export.test.ts`
- `frontend/src/components/landing/UploadZone.tsx`, `ExportInstructions.tsx`
- `frontend/src/containers/results/ResultsContent.tsx` share CTAs
- `CLAUDE.md`, `AGENTS.md`

## Known knowns

- Live product is ZIP/CSV/folder only. `POST /api/scrape-profile` is gone from `main`.
- FE: Netlify `main` → movieswrapped.com. BE: Render `https://wrapped-backend.onrender.com`.
- Extract already handles nested folders, Windows `\`, `__MACOSX`, skip `deleted`/`orphaned`/`likes`/`lists`, PK magic, extensionless `-utc`.
- `application/octet-stream` is not a zip by itself; PK or Letterboxd filename decides. Single `.csv` + octet-stream is a CSV.
- Review like counts are not in the export. UI already hides Most liked / Hidden gems when `reviews_with_likes_data` is null.
- TMDB matching: exact title (original title beats an English namesake), year ±1 as a band, then vote_count/popularity. Letterboxd film URL slug wins when present. Never send `year=` to `search/movie` (Split 2016 vs Écartée).
- Story tap zones must stay outline-free (`data-story-tap`); Instagram left-1/3 / right-2/3. Progress bar is full-width above Pause/locale (`data-story-progress-count`). Mobile rail is one hero poster (`data-story-peek=false`).
- Share actor/director picker is a solid sheet on viewports < 640px (`data-share-sheet=bottom`), not a frosted overlay on the card.
- Phone gate is UA (`usePhoneLayout`), not viewport: desktop DnD stays on a narrow window. Do not say computer / bilgisayar.

## Forbidden

- Merge to `main`, push-to-main, Render/Netlify/Railway dashboard, publish, secrets, `.env`
- Restore username scrape, desktop worker, watchlist compare, FindFilm, RSS
- Commit real Letterboxd exports (`profile.csv` has email)
- Move ZIP analysis into the Netlify static frontend (TMDB key must stay on the backend)
- Railway / “analyze on Netlify to save $7” — Semih hosting decision, not this card

## Scope (this card)

1. Confirm `origin/main` ZIP-only (no scrape router, no `scraper.py`).
2. Keep extract tests green: nested Mac folder, Windows `\`, AppleDouble `._*`, empty zip → `missing_required_files`, encrypted flag → `unsafe_archive`, unzipped multi-CSV, Windows `application/x-zip-compressed`, iOS/Safari PK + extensionless `-utc`.
3. If a real OS zip still fails, add a fixture test then fix extract. Do not guess.
4. PR from a fresh branch off latest `origin/main`. Conventional commits. Rebase onto `origin/main` before opening.

## Acceptance

- `cd frontend && npx tsc --noEmit`
- `cd frontend && npx vitest run src/lib/api.export.test.ts src/i18n/catalogs.test.ts src/containers/results/sections/ReviewAnalysisSection.test.tsx src/containers/results/sections/ShareModalDynamic.test.tsx src/components/story/story-layout.test.tsx src/components/share/modal/sharePopoverLayout.test.ts src/components/LetterboxdLanding.consent.test.tsx src/components/share/ShareModal.test.tsx`
- `cd backend && python -m pytest tests/test_zip_export.py tests/test_api.py tests/test_tmdb_movie_pick.py`
- Landing copy is ZIP/folder, not “type your username”
- Share buttons use `results.share.cta` / `results.share.footerTitle`

## Semih (not Cloud)

1. Review the PR, then squash-merge.
2. Confirm Netlify built that SHA.
3. Render dashboard: Manual Deploy of that SHA if the backend image is stale (historical failure: GitHub `main` ahead, Docker still old).
4. Live smoke: one real Letterboxd ZIP on movieswrapped.com. Do not paste that file into Cloud.

## DEFER (do not open work)

- Share-card visual polish / bento / year poster pack (share card layout is OK for now)
- LoadingScreen `mode="scrape"` leftover (dev harness + tests only)
- Remaining watchlist i18n keys with no `/watchlist` page
