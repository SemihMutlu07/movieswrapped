# PostHog event contract

Movies Wrapped uses PostHog only after explicit analytics consent.

## Canonical funnel

`app_opened` → `analyze_started` → `analyze_succeeded` or `analyze_failed` → `results_viewed_unified` → `share_export_started` → `share_export_succeeded`, `share_export_failed`, or `share_export_cancelled`.

`results_viewed` is legacy and should not be used for new reporting.

## Privacy

Do not send raw Letterboxd usernames, email addresses, uploaded file names, film titles, or other direct user content to PostHog. The adapter defensively strips `username`, `letterboxd_username`, and `email` before capture or queueing.

Session recording is configured to mask all form inputs in the browser. Recording also requires the PostHog project-level Session Replay toggle.

## Analysis lifecycle

Only one `analyze_started` event is emitted while an attempt is in flight. `analyze_succeeded` or `analyze_failed` reopens the lifecycle for the next attempt.

Useful properties include `method`, normalized `reason`, `duration_ms`, safe upload context, and requested analysis period.

## Error tracking

Unhandled browser errors, unhandled promise rejections, and React ErrorBoundary failures are captured after consent. Readable production stack traces still require source maps in the deployment pipeline.
