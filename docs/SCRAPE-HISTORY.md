# Username scrape — every approach tried

Do not repeat a row whose result is **failed** unless you can name a new fact that changes the outcome. ZIP export remains the complete, legitimate library path.
Current rule: the residential X370 worker is the profile path. ZIP upload and the bookmarklet are the fallbacks when that scan cannot proceed. The dated rows below are history. Do not treat a ZIP-only row as the live rule.

Evidence sources: owner decision log (`mw-history`), git (`origin/main`, `origin/archive/scrape`), closed PRs, `docs/research/desktop-worker-final-decision-2026-08-24.md`, live probes on 2026-10-10.

## Tried

| When | Approach | Result | Why it failed / why it stopped | New fact that would justify retry |
|---|---|---|---|---|
| 2026-05-06 | `requests.Session` HTML; diary-only then grid as primary | Coverage 377→671 for `@semihmutsuz` **until Cloudflare** | Not a Cloudflare strategy. Diary/grid merge is still the right *parse* once HTML is reachable. | None needed for parsing. Do not use plain `requests` as transport. |
| 2026-05-09 | `cloudscraper` instead of `requests` | Worked locally then: 517 films. Later **403** from cloud IPs and, by Aug 2026, **403 on residential diary/grid deep pages** | Cloudflare JS/challenge format moved. Datacenter ASN is blocked. By 2026-08-29 cloudscraper on the home IP also 403'd diary. | Only if live proof shows cloudscraper passing Letterboxd HTML again from the same IP class. As of 2026-10-10, this VM and Render both get CF 403 on HTML. |
| 2026-05 (PR #9) | ScraperAPI residential proxy in front of cloudscraper | Temporarily unblocked; monthly **quota 503**; watchlist/date-night lied `user_not_found` | Free-tier 5k credits. `ScraperAPIError(ValueError)` swallowed by generic handlers. `c240680` **KILL** 2026-06-21 / 2026-07-02. | A paid proxy with measured CF pass **and** an explicit owner request. Default remains KILL. |
| 2026-05-09 | Abort in-flight scrape + debug overlay | UX bugfix (stale `helincanpolat` vs `semih`) | Not a transport. Keep AbortController. | — |
| 2026-05-18 | Username-first landing (export demoted) | UX choice | Made scrape the primary CTA while transport was already fragile. ZIP-only later reversed the copy. | Do not restore username-first until production HTML scrape is green. |
| 2026-05-20 | Progressive scrape: 202 + poll, diary∥grid, partial results | UX for 4–20 min waits | Did not change Cloudflare. In-memory tasks die on Render restart. | Fine *after* a working residential transport. Not a substitute. |
| 2026-05-20 Phase B | Cache by `(username, schema_version)` | **Deferred** — never production-proven | Needed deploy + measurement. Options B1/B2/B3 were enumerated, not shipped. | Measured repeat-visit cost on a working scrape, not RSS-as-library. |
| 2026-05-20 Phase C | “Residential-egress worker” as cost play | Deferred then built anyway for CF, not speed | See desktop worker rows. | — |
| 2026-05-19 | Headless browser for spoiler click-to-reveal | **DEFER / WONTFIX** | cloudscraper + boilerplate strip was enough for review text. | Only for spoilers, not for CF. |
| 2026-06-15…08-24 | Windows desktop worker, outbound poll, `WORKER_TOKEN`, direct cloudscraper, concurrency 1 | **Diary/grid: 0/48 CF blocks** (2026-08-24). **Ops failed.** Watchlist still CF-blocked. | PowerShell supervisor MEMORY_MANAGEMENT BSODs (`9286434`, `#113` watchdog). Always-on home PC. Site 503 if heartbeat >60s. TurkNet IDS if too many TCP sessions. | Linux + no PowerShell supervisor is a real new fact (see Camoufox row). Restoring **Windows** worker is repeating failure. |
| 2026-06-21 | Drop ScraperAPI; worker env must not set `SCRAPER_API_KEY` | Correct | Proxy path was a silent footgun. | Do not re-add `SCRAPER_API_KEY`. |
| 2026-06-21 | ThreadPool 10 + aiohttp connector limits | Mitigated ISP IDS | Not a CF bypass. | Keep if worker returns. |
| 2026-08-24 report | RSS incremental probe (`rss_probe.py`, PR-B `cd56315`) | Live: 54 items, latest date, ~1.7s. **SHIP as short-circuit only** | Official feed cap ~50. Failures inventory F1: RSS is not a library. Never cinema-scale. | Retry only as a cheap “has the diary moved?” check **after** full scrape works. Not as ingest. |
| 2026-08-24 | Hermes / Browser-Use as general scraper | **KILL**. Watchlist fallback **DEFER** | Parity 5/6 vs cloudscraper; slower; only watchlist needed a real browser then. | Watchlist-only adapter, not diary/grid. |
| 2026-08-24 | Multi-process / extra concurrency / TMDB 5k prewarm / scheduled prewarm / extension/bookmarklet / proxy provider | **KILL** | Throughput bound by Letterboxd latency. Concurrency>1 on one IP re-challenges CF. | Different IPs (not more processes on one IP). |
| 2026-08-24 | Cloudflare Tunnel / inbound exposure of the desktop | **Deleted / KILL** | Desktop must stay outbound-only. | Tailscale **inbound from Render** is the same class unless Render is on the tailnet. See untried. |
| 2026-08-29 | **Camoufox** stealth Firefox on **Omarchy Linux**, `SCRAPE_TRANSPORT=stealth_browser`, concurrency 1, no proxy | **Worked:** diary 452 / grid 725 / ~67s for `@semihmutsuz`. cloudscraper 403 on the same URL. 2 browsers / 1 IP → CF re-challenge. | ZIP-only (2026-09-05) disabled `movieswrapped-worker.service` (broken path after `~/Dev`→`~/dev`). **`camoufox_pool.py` was never pushed to git.** Not on `archive/scrape`. | This is the only HTML transport with a dated pass. Retry **only** on the always-on Linux box, Camoufox, concurrency 1, outbound poll. Need the missing source (disk or rewrite + live proof). |
| 2026-09-05 | ZIP-only on `main` (`2a65270`). Scrape archived at `origin/archive/scrape` @ `9d88200` | **Works** as the complete library (watched+ratings+diary+reviews+TMDB) | Username scrape, RSS, worker, watchlist, FindFilm removed from the live path by product decision. ZIP lacks review likes / avatar. | ZIP stays the guaranteed path even if scrape returns. |
| 2026-10-06 | Restore in-process `/api/scrape-profile` on Render (`6334991`) | **Fails in production.** 2026-10-10 `@semihmutsuz`: `scrape_blocked` in 0.5s | Datacenter IP. No worker gate. Repeats the 2026-05-18 rule: cloud IP = 403. | None. Do not scrape HTML on Render. |
| 2026-10-10 #142 | ZIP-first: one HTML probe, fail-fast `scrape_blocked`, send user to ZIP | **Correct UX** on a dead Render scrape | Did not restore residential scrape. Did not delete worker (already gone). | Keep. |
| 2026-10-10 #143 | New `letterboxd_rss.py` as existence + wait-story preview | RSS **200 from Render** (54 items, `preview_only`). Repeats RSS-as-product | Same 50-item cap. Looks like username scrape; is not. Conflicts with ZIP-only “do not restore RSS.” Owner: already tried, failed. | **Reverted** on this branch. Official RSS is allowed later only as an incremental fingerprint on top of a working full scrape. |
| 2026-10-10 #144 | Returning-user cache via `analysis_runs` + RSS fingerprint | Repeats deferred Phase B + RSS-first | Session-scoped, not a library. Migration `011` was never the owner’s live scrape fix. | **Reverted**. Cache only after scrape is real. |

## Untried (or not finished)

| Approach | Why it is sitting here | Verdict |
|---|---|---|
| Camoufox worker on the current **X370 Omarchy** box, systemd user service, **outbound** poll to Render (same protocol as `archive/scrape` worker.py) | Transport proven 2026-08-29 on Omarchy. Windows BSOD supervisor is gone. Owner says the box is always-on (`100.125.144.81` on Tailscale). Source file not in git. This Cloud agent cannot reach the tailnet (ping 100% loss). Render is not on Tailscale. | **Pick this.** New facts vs the failed Windows worker: Linux, Camoufox not cloudscraper, always-on, systemd not PowerShell. Still needs owner machine + `WORKER_TOKEN` + Camoufox source or a rewrite verified **on that box**. |
| Render → Tailscale **inbound** scrape broker on `100.125.144.81` | Not tried. Previous rule: desktop never exposed; outbound poll only. Render cannot see CGNAT Tailscale IPs without a tailnet sidecar + auth key. | Do not pick until Render is on the tailnet. That needs a Tailscale auth key (secret) and a Render change. Worse security shape than poll. |
| Rotating VPN / paid residential egress (DataImpulse, IPRoyal, Browserless, etc.) | Explicit **KILL** (proxies, quota, TOS). Aug 29: needed only if `CAMOUFOX_BROWSERS>1`. TurkNet IDS on bursty TCP. CF clearance is IP-sticky. | Do not pick. |
| Managed browser farms (Browserbase, cloud Playwright) | Not tried. They egress from datacenter/ASN pools Cloudflare already blocks for Letterboxd HTML. | Do not pick without a live pass against `letterboxd.com/{user}/films/`. |
| Automate Letterboxd Settings → Data export (login + zip) | Deferred 2026-08-24. Anon 403. Needs user credentials. Mobile app has no export. | Do not pick. ToS + secret + 2FA. ZIP upload is the same data without stealing the session. |
| Official Letterboxd API | Does not exist for wrapped-scale libraries. | N/A |
| Playwright/Chromium on Render | Spoiler-scraper defer. Datacenter IP. | Repeats 6334991. |

## Decision (2026-10-10)

1. **Keep #142** (ZIP-first fail-fast).
2. **Revert #143 and #144** — they repeat RSS-as-scrape and unproven cache.
3. **Do not** restore ScraperAPI, Windows worker, cloudscraper-on-Render, Tunnel, or bookmarklet.
4. **Next scrape attempt:** Camoufox, concurrency 1, on the X370, outbound worker poll. Stop here until the owner provides the machine and secrets listed in the PR.

## Live probes (2026-10-10, this agent)

- `GET https://wrapped-backend.onrender.com/health` → `ok`
- `POST /api/scrape-profile {"username":"semihmutsuz"}` → 202 then `error_code=scrape_blocked` in 0.5s
- `https://letterboxd.com/semihmutsuz/` from this VM → HTTP 403 Cloudflare “Just a moment…”
- `https://letterboxd.com/semihmutsuz/rss/` from this VM and from Render → HTTP 200, ~50-item preview
- `ping 100.125.144.81` from this VM → 100% loss (not on Tailscale)
- `git grep camoufox` on all remotes including `archive/scrape` → **no files**
