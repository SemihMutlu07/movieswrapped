# PostHog observability rollout checklist

## Root cause

Production analytics stopped after the explicit-consent gate was introduced on 2026-07-25. The consent UI was later removed, so new visitors had no way to set `consent_decision=accept` and PostHog stayed disabled.

## This change

- restores a non-blocking app-wide analytics consent choice
- persists consent across visits
- keeps all behavioral tracking off until explicit acceptance
- masks replay inputs in the SDK configuration
- enables PostHog autocapture and frontend exception capture after consent
- reports React ErrorBoundary failures to PostHog
- strips direct identifiers such as Letterboxd username and email from PostHog event properties
- deduplicates repeated `analyze_started` lifecycle events until success or failure
- keeps App Router pageviews deterministic through `PageViewTracker`
- adds tests for consent, privacy stripping, lifecycle dedupe, and pageview gating

## PostHog project configuration completed

- Product Health dashboard created and pinned
- core product funnel saved
- analysis failures by reason saved
- mobile p75 LCP and INP saved
- analytics ingestion health saved
- canonical event definitions documented and verified
- legacy `results_viewed` hidden in favor of `results_viewed_unified`
- Results accuracy pulse survey created as a draft

## Before production merge

- CI must pass
- confirm Netlify has `NEXT_PUBLIC_POSTHOG_KEY` and `NEXT_PUBLIC_POSTHOG_HOST`
- do not launch the draft survey until fresh production ingestion is verified

## After deployment

1. Open production in a clean browser session.
2. Accept analytics on the non-blocking banner.
3. Verify fresh `$pageview` and `app_opened` events arrive in PostHog.
4. Start one upload or scrape and verify one `analyze_started` event is emitted per attempt.
5. Verify successful analysis reaches `results_viewed_unified`.
6. Trigger a controlled frontend test exception in a safe environment and verify Error Tracking receives it.
7. Session Replay remains dependent on the PostHog project-level recording toggle; enable it only after confirming the masked-input configuration is deployed.
8. Source maps are not currently uploaded; add them in the deployment pipeline before relying on readable production stack traces.
9. Once fresh data is stable, launch the Results accuracy pulse survey.
