# Movies Wrapped — prioritized work plan

**Date:** 2026-10-09  
**Scope:** docs only. No app-code changes in the PR that lands this file.  
**Live site probed:** https://movieswrapped.com (Netlify) and https://wrapped-backend.onrender.com  
**Codebase:** `main` @ `6334991` (`feat: restore public username scrape beside ZIP upload`)

This plan is ordered so an autonomous agent can ship **one PR at a time**. Each item below has current state, approach, effort, risks, and an acceptance test. Do not combine items across the PR sequence.

Effort is relative (S / M / L / XL), not calendar time: S is a tight single-surface change, M spans a few files plus tests, L is a new subsystem, XL is ops + product + legal.

---

## Verdict in one page

| Owner goal | Current state | Ship next? |
|---|---|---|
| 1. Scraping | Username scrape is **live on main and production**, and **fails immediately** with `scrape_blocked`. ZIP export analysis is the only complete, legitimate path that works from Render. Official RSS works (200, ~50 items) but cannot replace a full Wrapped. | Yes — first. Stop pretending HTML scrape works from Render. |
| 2. Mobile | Phones are **explicitly gated**. Landing hides ZIP upload behind `DesktopRequiredNotice`. Story and empty-results also gate on `usePhoneLayout()`. Compact results layout already exists for ≤639px. | After scrape contract is ZIP-first, ungate phones. |
| 3. SEO | Basic metadata, OG 1200×630, robots, sitemap, FAQ JSON-LD exist. The phrase **“letterboxd wrapped” is not in live `/en` HTML**. Root `/` is `noindex`. Draft PR #140 already does the main SEO routing/copy lock. | After mobile. **Sitemap pagination / `generateSitemaps` / next-intl are not needed.** `/tr` is the Turkish locale, not a pagination scheme. |
| 4. Analytics | PostHog client is wired (pageviews, autocapture, exception capture, replay *config*). `getConsent()` currently **always returns `accept`**. Supabase already stores structured runs. Replay/heatmaps are project-toggle work more than code. | After SEO (or in parallel only if no shared files). |
| 5. MCP | **Nothing exists.** No MCP server, tools, or agent endpoint. | Last. Read-only, opt-in, never triggers a scrape. |

**Do not do:** residential proxies, captcha-solving, browser-automation as the default scrape path, resurrecting the deleted RSS subsystem from old merges, adding `next-intl`, or adding Next.js sitemap pagination.

---

## Live probes (2026-10-09, this Cloud Agent VM)

These are facts, not guesses.

| Probe | Result |
|---|---|
| `GET https://letterboxd.com/semihmutsuz/` (browser UA) | **HTTP 403**, `cf-mitigated: challenge`, body title `Just a moment...` |
| `GET https://letterboxd.com/semihmutsuz/rss/` | **HTTP 200** `application/rss+xml`, 54 items, `letterboxd:watchedDate`, `letterboxd:filmTitle`, `letterboxd:memberRating`, `tmdb:movieId`, review HTML, poster URL |
| `GET https://letterboxd.com/semihmutsuz/{films,diary,reviews,watchlist,likes}/rss/` | **HTTP 403** — only `/{username}/rss/` is the public feed |
| `POST https://wrapped-backend.onrender.com/api/scrape-profile` `{"username":"semihmutsuz","period":"year"}` | **202** then poll **failed in 1.2s**, `error_code=scrape_blocked`, message tells the user to upload the export |
| `GET https://movieswrapped.com/en` | Title/description/canonical/OG/JSON-LD present. **No** substring `letterboxd wrapped` in HTML |
| `GET https://movieswrapped.com/sitemap.xml` | 5 URLs (`/`, `/en`, `/en/story`, `/tr`, `/tr/story`). Far below the 50,000-URL sitemap cap |
| `GET https://movieswrapped.com/en/story` | `robots: index, follow` (inherits locale layout) even though story is a client session UI |
| GitHub `SemihMutlu07/movieswrapped` | **0 open Issues.** **14 open Pull Requests** (listed at the end). |

---

## Goal 1 — Letterboxd data fetching (scraping)

### Current state

The product currently offers **two ingest paths**:

1. **ZIP / CSV upload** (`POST /api/analyze`) — Letterboxd Settings → Data → Export. This is complete (watched, diary, ratings, reviews, profile). Implemented in `backend/app/routes/analyze.py` + `backend/app/services/analysis.py`. This path does **not** talk to Letterboxd.
2. **Username HTML scrape** (`POST /api/scrape-profile`) — restored on `main` in `6334991`. `backend/app/services/scraper.py` uses **cloudscraper + BeautifulSoup** against:
   - `/{username}/`
   - `/{username}/films/diary/page/N/`
   - `/{username}/films/page/N/`
   - `/{username}/reviews/films/page/N/`
   Rate limit: 5 scrapes / 10 minutes (`enforce_rate_limit` in `backend/app/security.py`). Page delay default 0.25s, max 60 pages.

What fails:

- **Render (production) HTML scrape is Cloudflare-blocked.** Confirmed live: `scrape_blocked` in 1.2s, no diary/grid pages fetched.
- **This research VM is also blocked** on HTML (403 challenge).
- `cloudscraper` is not a durable Cloudflare bypass. Datacenter IPs (Render, GitHub Actions, this VM) are the block surface.
- README still says scrape lives only on `archive/scrape`. That is stale; scrape is on live `main`.

What already exists around scrape:

- Honest error mapping in `frontend/src/lib/errors.ts` (`scrape_blocked`, `scraper_unavailable`, desktop-worker offline/paused).
- Landing still **leads with username scrape** (`landing.username.title` = “Just type your username”) and **hides ZIP upload on phones**.
- TMDB enrichment is already cached (175-day lazy TTL, atomic writes) in `backend/app/services/tmdb_client.py`. Scrape HTML itself is **not** cached.
- Desktop worker (residential-IP HTML scrape) is documented in `docs/research/desktop-worker-final-decision-2026-08-24.md` as the only historically reliable HTML path. Worker claim/job endpoints are **not** the live ingest on current `main`; Render runs scrape in-process.
- An older RSS probe (`app/services/rss_probe.py`) was planned then dropped from this tree. `CONTRIBUTING.md` warns not to resurrect dead RSS files via merge. Any RSS work must be a **new, small client**, not a restore of the deleted subsystem.

### Legitimate approaches (research)

| Approach | Legitimate? | Completeness | Reliability from Render | Use |
|---|---|---|---|---|
| **User-uploaded Letterboxd export ZIP/CSV** | Yes. Official Settings → Data export. | Full library, diary, ratings, reviews. | Already works. Independent of Cloudflare. | **Primary product path.** |
| **Official RSS** `https://letterboxd.com/{username}/rss/` | Yes. Public feed Letterboxd publishes. | ~50 latest diary/review items + TMDB ids. Not a lifetime Wrapped. | **Works from this VM (HTTP 200).** | Profile-exists check, live preview, returning-user “anything new?”, never a full analysis. |
| **Letterboxd API** (`https://api-docs.letterboxd.com/`) | Yes, if Movies Wrapped is an approved OAuth2 third-party client. | Full, with member auth. | Unknown until credentials exist. | **Ask Letterboxd for API access.** Do not scrape HTML while hoping. Do not ship a fake “API integration.” |
| **HTML scrape via cloudscraper from Render** | Against bot-detection; ToS-grey. | Would be complete if it worked. | **Fails today.** | Keep as best-effort only. Fail fast. Never retry a CF challenge. |
| **Desktop worker on a residential/home IP** | Same HTML scrape, different IP reputation. Previously measured 0/48 CF blocks in the 2026-08-24 report. | Complete when the worker is online. | N/A (not Render). | Optional later PR **only if** username-without-ZIP remains a hard product requirement. High ops cost. |
| **Headless browser / Browser-Use** | Same ToS-grey HTML. | Can pass some CF challenges. | Costly, brittle, still a ban risk. | Prior research: **KILL as default**, DEFER only as watchlist fallback. Do not start here. |
| **Proxies / captcha farms** | Not legitimate. Ban + ToS risk. | — | — | **KILL.** |

RSS is the only Letterboxd-hosted fetch that succeeded in this investigation. It is a **preview/incremental** tool, not a Wrapped replacement. A 50-item feed cannot compute cinema scale, country passport, or year-in-review for a 600-film diary.

### Proposed approach (split into sequential PRs)

**PR 1 — Scrape contract: ZIP is guaranteed, HTML scrape is best-effort.**  
Make the product tell the truth that production already knows.

- Landing: ZIP/export is the primary CTA; username scrape is secondary (“public profile, may fail”).
- On `scrape_blocked` / 403 / CF challenge: **do not retry**, show export instructions immediately, do not spin the loading story.
- Backend: treat CF challenge / 403 as terminal `scrape_blocked`; single probe (RSS or HEAD/GET of RSS) can distinguish “user exists” vs “HTML blocked.”
- Do not add proxies, browsers, or extra cloudscraper knobs.

**PR 2 — Official RSS client (new, small).**  
Add `backend/app/services/letterboxd_rss.py` that fetches only `/{username}/rss/`.

- Parse `letterboxd:*` and `tmdb:movieId` fields.
- Use it for: username exists, ~50-item preview on the wait screen, returning-user “feed unchanged → offer cached analysis.”
- Cap frequency (reuse existing rate limit). Cache the raw RSS checksum in memory or `ops_runs` — **not** on Render disk (ephemeral).
- Never feed RSS-only data into `compute_cinema_scale` as if it were a full library.

**PR 3 — Returning-user cache via Supabase (not HTML).**  
`analysis_runs` already stores aggregate `summary` + extracted columns (`total_films`, `sinefil_meter`, …). Add a read path: if the user re-enters the same username and RSS guid/watchedDate has not moved, offer last successful ZIP/scrape result **with an explicit “cached” label** and a “re-upload ZIP” button. Do not auto-serve another user’s run. Key by username **plus** session or an explicit publish flag.

**Later, optional PR (not in the default sequence):** desktop-worker HTML scrape behind `WORKER_TOKEN`, concurrency 1, stop-on-first-403. Only if PR 1–3 still leave a hole the owner refuses to fill with ZIP.

### Effort / risks / acceptance

| | PR 1 contract | PR 2 RSS | PR 3 cache |
|---|---|---|---|
| Effort | M | M | L |
| Risks | Username-only users bounce until they export. Copy must not claim scrape “just works.” | RSS shape can change; 50-item cap must stay visible. Do not resurrect old RSS files. | Serving cached stats without consent/ownership is a privacy bug. Render disk cache is the wrong store. |
| Acceptance | Production `POST /api/scrape-profile` for a public user still returns `scrape_blocked` (or RSS-confirmed exists + blocked HTML) in &lt;5s. Landing shows ZIP steps first. Frontend test: blocked scrape → export CTA, no retry loop. `pytest backend/tests/test_scrape_api.py` green. | Unit test: parse a fixture RSS with 54 items, TMDB ids, ratings. Live optional: `GET /{user}/rss/` 200 from CI is **not** required (CI IPs may 403 some days); fixture is the contract. Username of a missing user yields a clean 404-equivalent. | Re-submit same username after a successful ZIP run + unchanged RSS → UI offers cached aggregates without a new HTML scrape. Different browser session cannot read it without the same username **and** a share/session token. |

---

## Goal 2 — Mobile

### Current state

Phones are treated as unsupported, not as a layout breakpoint.

- `frontend/src/hooks/usePhoneLayout.ts` — UA-based (`iPhone|iPod|Android.+Mobile` or `userAgentData.mobile`). iPad/desktop stay “desktop.”
- Landing (`LetterboxdLanding.tsx`): username form **is** shown on phones; **ZIP `UploadZone` is replaced** by `DesktopRequiredNotice` (“Export your Letterboxd ZIP on this phone if you need to. Then open this same page on desktop…”). That is inverted: ZIP is the path that works, scrape is the path that does not.
- `ResultsPage.tsx`: if stats are missing **and** `isPhone`, show `DesktopRequiredNotice` instead of the empty-state upload prompt.
- `StoryExperience.tsx`: phone layout shows `DesktopRequiredNotice` instead of story playback.
- Compact results **do** exist: `useCompactLayout` + `SECTION_ITEM_CONTRACT` (directors/cast 4, outliers 4 below 640px). Playwright story tests are desktop-oriented (`frontend/tests/story/story-desktop.spec.ts`).
- Share cards are landscape-first (`docs/SHARE_CARD_SPEC.md`).

### Proposed approach (after Goal 1)

**PR 4 — Phone ZIP upload.**  
Remove the landing phone gate around `UploadZone`. Keep export instructions (Letterboxd **app** has no export; browser is required — copy already says this). Username scrape may stay, but secondary. `input[type=file]` + `accept=.zip,.csv` must work in iOS Safari and Chrome Android.

**PR 5 — Phone results + story.**  
Stop replacing results/story with `DesktopRequiredNotice` when stats exist. Use compact contracts already in `section-layout.ts`. Story: allow playback on phones (tap-to-advance already exists in tests); skip heavy hover-only motion under `prefers-reduced-motion` and coarse pointers. Share: default a vertical/story-sized card on phone, keep landscape as optional.

Do not wait for HTML scrape to “work on mobile.” Mobile needs ZIP (and later, cached results). Scrape from a phone still hits the same Render IP.

### Effort / risks / acceptance

| | PR 4 landing upload | PR 5 results + story |
|---|---|---|
| Effort | M | L |
| Risks | iOS file-picker quirks (ZIP vs folder). Do not reintroduce neo-brutal styling. | Story performance on low `deviceMemory`. Share canvas CORS still needs `/tmdb-proxy`. |
| Acceptance | iPhone UA + 390×844: landing shows ZIP drop/choose, not only “open on desktop.” Upload a small fixture ZIP (or mocked `/api/analyze`) and reach loading → results. Playwright: phone project, landing upload visible, scrape-blocked still shows export. | Same viewport: `/results` with sessionStorage fixture renders Hero + compact grids (4 directors, not 5). `/story` plays at least intro → next slide on tap. `DesktopRequiredNotice` is gone from the happy path. |

---

## Goal 3 — SEO (“letterboxd wrapped” before December)

### Current state

Already shipped on live `/en`:

- `generateMetadata` title: “Movies Wrapped - Your Year in Film from Letterboxd”
- Description mentions Letterboxd watch history, not the query **letterboxd wrapped**
- Canonical `https://movieswrapped.com/en`
- OG/Twitter image `https://movieswrapped.com/assets/og-image-1200x630.png` (real 1200×630 file)
- JSON-LD `@graph`: WebSite, Organization, WebApplication, FAQPage (`frontend/src/app/RootDocument.tsx` + `frontend/src/i18n/faq.ts`)
- `robots.ts`: allow `/`, disallow `/api/` and results
- `sitemap.ts`: 5 static URLs, `dynamic = 'force-static'` (correct for `output: 'export'`)
- HSTS on Netlify

Gaps:

- Live HTML does **not** contain “letterboxd wrapped” (or “Letterboxd Wrapped”) as crawlable text. H1 is “Movies Wrapped”; tagline is “Your Letterboxd, re-edited.”
- Root `/` layout sets `robots: { index: false, follow: true }` (JS locale chooser) **and** sitemap lists `/` at priority 1. That fights itself.
- `/en/story` and `/tr/story` are in the sitemap and inherit `index, follow` from `[locale]/layout.tsx`. Story is a client session page — weak/duplicate SEO.
- Stale `frontend/public/sitemap.xml` still lists deleted `/findfilm` and `/watchlist` routes. Live Netlify serves the generated `app/sitemap.ts` output (good), but the public file is a footgun if it ever wins.
- Root OG in `(root)/layout.tsx` still points at a 1080×1080 logo; locale layout uses the 1200×630 asset.
- No blog, glossary, or comparison page targeting the query.
- Draft **PR #140** already implements the main routing/copy lock: English homepage at `/` as real indexable HTML, `/en` → `/` 301, `/tr` stays Turkish, story `noindex`, share-card phrase “Your Letterboxd Wrapped” in the H1.

### Pagination / “ntr” — is it needed?

**No.**

What was likely mixed together:

1. **`/tr`** — the Turkish locale, already shipped (`frontend/src/i18n/locales.ts`, `app/[locale]/`). This is not pagination.
2. **`next-intl`** — researched in `docs/research-tr-en-i18n.md` and **deferred**. Two catalogs + `generateStaticParams` are enough under `output: 'export'`.
3. **Next.js `generateSitemaps()` pagination** — splits sitemaps at **50,000 URLs / 50 MB**. This site has **five** indexable URLs. A second sitemap file would add crawl complexity and zero ranking value.

Do not add sitemap pagination, a sitemap index, or `next-intl` for Wrapped season. If PR #140 is still open, **rebase and finish that** instead of a parallel SEO routing PR.

### Proposed approach

**PR 6 — SEO (rebase #140 or a successor, one scope).**

- Indexable English home at `/` with crawlable copy that includes **Letterboxd Wrapped** as a descriptor (“a Letterboxd Wrapped-style year in film”), without fake “official” claims.
- Keep `/tr` as the Turkish home. hreflang: `en` + `x-default` → `/`, `tr` → `/tr`.
- `noindex` story + results; drop story from sitemap.
- One OG image (1200×630) on every indexable URL. Delete or stop publishing stale `public/sitemap.xml` if `app/sitemap.ts` is the source of truth.
- Optional extra indexable page only if copy is real: `/letterboxd-wrapped` or an FAQ/how-to-export article. Do not mass-produce doorway pages.
- Performance: static export is already CDN-friendly; watch LCP on the landing H1 + hero, do not lazy-load the H1. `unoptimized` Next images are expected with `output: 'export'`.

### Effort / risks / acceptance

- **Effort:** M if #140 is the vehicle; L if a new content page is added.
- **Risks:** Keyword stuffing; claiming affiliation with Letterboxd; indexing `/results` (PII). Two competing SEO PRs will conflict — use #140 or close it.
- **Acceptance:** `curl -sL https://movieswrapped.com/` (after deploy) contains indexable H1 + the phrase “Letterboxd Wrapped” in HTML (not only in a PNG). `robots` is `index, follow` on `/` and `/tr`. Story URLs `noindex`. Sitemap has only indexable locales’ homes (and any new article). Rich-results test: FAQPage JSON-LD still matches visible FAQ. Search Console: sitemap fetch OK. Ranking itself is not an automated gate.

---

## Goal 4 — Analytics (PostHog sessions, time on site, replay, heatmaps)

### Current state

**PostHog (behavioral)** already exists:

- `frontend/src/lib/posthog.ts` — init with `defaults: '2026-05-30'`, `capture_pageview: false` (emitted by `PageViewTracker`), `autocapture: true`, `capture_exceptions`, `session_recording: { maskAllInputs: true }`.
- Kill-switch: missing `NEXT_PUBLIC_POSTHOG_KEY` → no-op.
- `getConsent()` in `frontend/src/lib/session-id.ts` **always returns `'accept'`** (comment: analytics on by default; old `decline` cannot block PostHog). Docs (`docs/posthog-event-contract.md`, `docs/posthog-observability-checklist.md`) still describe an explicit consent banner that is **not** in the live client path.
- Funnel contract: `app_opened` → `analyze_started` → `analyze_succeeded|failed` → `results_viewed_unified` → share events. Usernames stripped.
- Next rewrites `/ingest/*` → PostHog (ignored in static export; production posts to `NEXT_PUBLIC_POSTHOG_HOST` directly unless Netlify proxy is added).
- Checklist already says: **Session Replay depends on the PostHog project-level toggle**; enable only after masked-input config is deployed. Source maps are **not** uploaded.

**Supabase (structured app data)** already exists and is the wrong tool for session replay:

- Frontend writes `user_sessions`, `analysis_runs`, `feedback` with the **anon key**.
- Backend best-effort mirrors `ops_*` tables.
- Use this for “how many wraps, average cinema scale,” not click heatmaps.

Heatmaps: PostHog heatmaps are built from autocapture + replay. The SDK does not need a separate heatmap library. Saved heatmaps are a **PostHog project action**, not a code change.

### Proposed approach

**PR 7 — Analytics verification + dashboards (minimal code).**

Code (only if probes fail):

- Confirm Netlify has `NEXT_PUBLIC_POSTHOG_KEY` and `NEXT_PUBLIC_POSTHOG_HOST`.
- Optionally proxy `/ingest` on Netlify so ad-blockers miss fewer events (rewrite in `netlify.toml`, not only `next.config.ts` rewrites which static export ignores).
- Align docs with `getConsent() === 'accept'` (or restore a real non-blocking opt-out — product decision, one PR).
- Do **not** send film titles or Letterboxd usernames.

PostHog project (owner click, agent can prepare insights):

- Turn **Session Replay** on; verify input masking.
- Create saved heatmap for `/` and `/tr` at 390 and 1280 widths.
- Insights: sessions, session duration (p50/p75), `$pageview` by path, funnel of the event contract, analyze_failed by `reason`.
- Web vitals insight if `$web_vitals` is arriving; otherwise add `posthog.capture('$web_vitals')` only if the SDK version does not already.

### Effort / risks / acceptance

- **Effort:** S code + M project config.
- **Risks:** Replay on results/story may capture posters and usernames on screen — use replay URL allowlist (landing + loading only) or mask extra selectors. EU/privacy: current “always on” consent is a product/legal choice, not a bug to silently reverse.
- **Acceptance:** Fresh production session with KEY set produces `$pageview` and a recording of length ≥ 10s in PostHog. Heatmap for `/` shows click aggregations after a handful of sessions. Insight “session duration” is saved. No username property on events (existing unit tests in `posthog.test.ts` stay green). Supabase `analysis_runs` insert still happens independently.

---

## Goal 5 — Read-only MoviesWrapped MCP

### Current state

No MCP server, no agent tools, no `mcp.json`, no `/mcp` route. Closest data is `analysis_runs.summary` (aggregates, slimmer than the browser session) written by `frontend/src/lib/supabase/analysis_runs.ts`.

Frontend is a **static export**; MCP must live on the **FastAPI backend** (or a tiny separate worker), not in Next.js.

### Benefits vs downsides

**Benefits**

- Agents (ChatGPT, Claude, Cursor) can answer “what’s my Wrapped?” without scraping Letterboxd themselves.
- AEO: tool listings can mention Movies Wrapped next to “letterboxd wrapped.”
- Forces a stable, documented stats schema (good for share links too).
- Can reuse extracted columns (`total_films`, `sinefil_meter`, `cinematic_persona`, `average_rating`, `total_countries`) instead of a new warehouse.

**Downsides**

- **Privacy:** `analysis_runs` is keyed by username. A public `get_wrapped(username)` is a directory of people’s taste. Do not ship that.
- **Stale/wrong data:** HTML scrape cannot populate this from Render. MCP that “runs a wrap” would DDoS Letterboxd and fail anyway.
- **Auth:** MCP OAuth / API keys / share slugs are real work. Anon-key Supabase must not become a dump endpoint.
- **Ops:** another public surface to rate-limit and schema-freeze.
- **SEO overlap:** a well-ranked landing page may matter more for December than an MCP few users will install.
- **Letterboxd ToS:** MCP must not wrap HTML scrape.

### Proposed approach (last)

**PR 8 — Opt-in read-only MCP.**

- Tools (read-only): `get_public_wrap(share_id)`, `explain_cinema_scale()`, `export_instructions()`.
- **No** `scrape_user`. **No** `get_wrap_by_username` without a share token the user minted on results.
- Implement with FastAPI + official MCP Streamable HTTP (or `mcp` Python SDK) on Render, path `/mcp`, CORS-closed, rate-limited.
- Share token minted in the existing results UI → row in Supabase (`analysis_runs` or a new `public_wraps` table) containing **only** the slim summary already persisted (no review bodies, no full film list).
- Document install for Claude/Cursor (`mcp.json` snippet in README).

If the owner only wants “agents can talk about the product,” skip the user-data tool and ship `explain_cinema_scale` + `export_instructions` first (S). Full share-token wraps are L.

### Effort / risks / acceptance

- **Effort:** L for share-token wraps; S for docs-only tools.
- **Risks:** Username enumeration; MCP clients caching PII; triggering analyze from an agent.
- **Acceptance:** MCP inspector lists tools. `get_public_wrap` without a token → 401/404. With a minted token → aggregates only. `scrape_user` does not exist. `pytest` for authz. Rate limit 30 req/min/IP.

---

## Autonomous PR sequence

Do these in order. Do not open a later PR until the previous is merged or explicitly deferred by the owner.

| Order | PR | Goal | Blocked by | Notes |
|---|---|---|---|---|
| 1 | Scrape contract (ZIP-first, fail-fast CF) | 1 | — | Highest leverage. Matches production reality. |
| 2 | Official RSS client | 1 | 1 | Preview + existence; not a full wrap. |
| 3 | Returning-user cache via `analysis_runs` | 1 | 1 (2 optional but better) | No Render disk. |
| 4 | Phone ZIP upload (ungate landing) | 2 | 1 | Scrape need not work. |
| 5 | Phone results + story | 2 | 4 | Uses existing compact contracts. |
| 6 | SEO copy/routing | 3 | — technically; after 4 so landing is the real mobile+desktop page | **Prefer finishing/rebasing #140** instead of a fork. No sitemap pagination. |
| 7 | PostHog replay/heatmaps/session insights | 4 | 6 optional | Mostly project toggles. |
| 8 | Read-only MCP | 5 | 3 (needs a shareable stats blob) + 7 (privacy policy clarity) | Last on purpose. |

Optional after 8: Letterboxd API partnership request (email, not code). Optional desktop worker only if username-without-ZIP is still a goal.

---

## Open GitHub items (the “14 issues”)

This repository has **zero open GitHub Issues**. The GitHub UI issue count of **14** is **14 open Pull Requests**. Mapped below.

| # | Title | Type | Maps to |
|---|---|---|---|
| [115](https://github.com/SemihMutlu07/movieswrapped/pull/115) | chore(deps-dev): bump eslint 9.31 → 10.10 in `/frontend` | Dependabot | Hygiene only. Not a product goal. Do not mix with scrape/SEO. |
| [116](https://github.com/SemihMutlu07/movieswrapped/pull/116) | chore(deps): bump pydantic in `/backend` | Dependabot | Hygiene. |
| [117](https://github.com/SemihMutlu07/movieswrapped/pull/117) | chore(deps): bump click in `/backend` | Dependabot | Hygiene. |
| [118](https://github.com/SemihMutlu07/movieswrapped/pull/118) | chore(deps-dev): bump typescript 5.8 → 7.0 in `/frontend` | Dependabot | Hygiene; major TS bump — treat as its own risky PR. |
| [119](https://github.com/SemihMutlu07/movieswrapped/pull/119) | chore(deps): bump numpy in `/backend` | Dependabot | Hygiene. |
| [120](https://github.com/SemihMutlu07/movieswrapped/pull/120) | chore(deps): bump fastapi in `/backend` | Dependabot | Hygiene. |
| [121](https://github.com/SemihMutlu07/movieswrapped/pull/121) | chore(deps-dev): bump concurrently in `/frontend` | Dependabot | Hygiene. |
| [122](https://github.com/SemihMutlu07/movieswrapped/pull/122) | chore(deps): bump idna in `/backend` | Dependabot | Hygiene. |
| [123](https://github.com/SemihMutlu07/movieswrapped/pull/123) | chore(deps-dev): bump @testing-library/user-event | Dependabot | Hygiene. |
| [124](https://github.com/SemihMutlu07/movieswrapped/pull/124) | chore(deps): bump react-dom + types in `/frontend` | Dependabot | Hygiene. |
| [125](https://github.com/SemihMutlu07/movieswrapped/pull/125) | feat(results): D2–D4 directors 4-up, hero avatar, waking-day copy | Product | **Goal 2 (mobile/results density).** Overlaps compact 4-up contract. Rebase onto `main` before mixing with PR 5. |
| [138](https://github.com/SemihMutlu07/movieswrapped/pull/138) | docs: production-ownership inventory (read-only) | Docs | Hygiene / ops evidence. Complements this plan; does not implement goals 1–5. |
| [139](https://github.com/SemihMutlu07/movieswrapped/pull/139) | fix(deps): pin anyio 4.14.2 and urllib3 2.8.0 for pip-audit | Hygiene | Unblocks red PR Checks mentioned in #138. Not a product goal; merge independently. |
| [140](https://github.com/SemihMutlu07/movieswrapped/pull/140) | feat: locked homepage copy and English URL at `/` | Product | **Goal 3 (SEO).** Use this as PR 6’s base. Includes story `noindex` and “Your Letterboxd Wrapped” in H1. |

Dependabot PRs (#115–124) should be batched or closed as stale; they are unrelated to Wrapped season. Do not let them rewrite lockfiles inside scrape/mobile PRs.

---

## Global constraints for every follow-up PR

Copied from repo contracts so an agent does not “improve” them away:

- `frontend/next.config.ts` has `output: 'export'` — no SSR, no middleware, no runtime server routes.
- One PR = one scope. If a PR rewrites a page shell, it must keep Feedback, Share, PostHog, i18n.
- Rebase onto `origin/main` before opening.
- Never commit `.env` or secrets. TMDB key stays on the backend. Supabase **anon** key only.
- Results visual language: dark `#1a1a1a`, `border-white/8`, `rounded-2xl`, orange-400 accents. No neo-brutal revival.
- Cinema scale (`cine_v2`) must not take TMDB popularity as an input.
- CORS 500s: keep the custom HTTP middleware; do not switch to `@app.exception_handler(Exception)`.
- Before done: `cd frontend && npx tsc --noEmit` and `cd backend && python -m pytest`.
- Commit messages: English conventional commits.

---

## Suggested first agent prompt (PR 1)

> Implement docs/PLAN.md Goal 1 PR 1 only: ZIP-first scrape contract. Do not add RSS, mobile ungating, SEO, MCP, or dependency bumps. Make landing treat export upload as the guaranteed path and username scrape as best-effort that fail-fasts on `scrape_blocked`. Add/adjust tests in `backend/tests/test_scrape_api.py` and landing error/consent tests. Rebase onto origin/main.
