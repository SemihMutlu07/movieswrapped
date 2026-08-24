# PostHog observability PR notes

Root cause: production analytics stopped when explicit consent became mandatory on 2026-07-25 and the consent UI was subsequently removed.

This branch restores an explicit, non-blocking consent path and hardens analytics privacy, lifecycle accuracy, error capture, and operational visibility. See `posthog-observability-checklist.md` and `posthog-event-contract.md` for rollout and event details.
