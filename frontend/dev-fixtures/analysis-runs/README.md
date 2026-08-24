# Local analysis fixtures

`semihmutsuz.json` is the development payload loaded by `/smt`.

It is a full analysis snapshot (same shape as an `analysis_runs` row summary):
stats live in `summary.details`. **Image binaries are not stored in Supabase** —
only TMDB path strings (`/abc.jpg`) are. `prepare-smt-fixture.mjs` downloads
those assets into `public/demo/smt-media/` and rewrites every
`poster_path` / `profile_path` it can resolve to `/demo/smt-media/<file>` so
local Story + Results work offline without a backend or live TMDB.

`semihmutsuz-share-card-media.json` is the deterministic ShareModal media
contract (2 portraits + 10 posters). Seed files live in `semihmutsuz-media/`.

## Refresh workflow

1. Run a scrape locally (or copy a good `backend/runs/semihmutsuz-*.json`).
2. Convert/replace `semihmutsuz.json` so `summary.details` is the run `stats`.
3. `cd frontend && node scripts/prepare-smt-fixture.mjs`
4. Commit `dev-fixtures/…` + `public/demo/smt-fixture.json` + `public/demo/smt-media/`.

`npm run dev:frontend` runs the prepare script via `predev:frontend`.
