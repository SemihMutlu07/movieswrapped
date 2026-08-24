'use client';

import posthog from 'posthog-js';

import { getConsent } from '@/lib/session-id';

let isInitialized = false;
let analysisInFlight = false;

// Kill-switch: when NEXT_PUBLIC_POSTHOG_KEY is not set, analytics is a silent no-op.
const POSTHOG_DISABLED =
  !process.env.NEXT_PUBLIC_POSTHOG_KEY || process.env.NEXT_PUBLIC_POSTHOG_KEY.length === 0;

const isDev = process.env.NODE_ENV !== 'production';
const QUEUE_KEY = 'ph_event_queue';
const BLOCKED_ANALYTICS_KEYS = new Set([
  'username',
  'letterboxd_username',
  'email',
]);

interface QueuedEvent {
  event: string;
  properties?: Record<string, unknown>;
  queued_at: number;
}

function sanitizeProperties(properties?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!properties) return undefined;

  return Object.fromEntries(
    Object.entries(properties).filter(([key]) => !BLOCKED_ANALYTICS_KEYS.has(key.toLowerCase())),
  );
}

function shouldSuppressLifecycleDuplicate(event: string): boolean {
  if (event === 'analyze_started') {
    if (analysisInFlight) return true;
    analysisInFlight = true;
    return false;
  }

  if (event === 'analyze_succeeded' || event === 'analyze_failed') {
    analysisInFlight = false;
  }

  return false;
}

function loadQueue(): QueuedEvent[] {
  try {
    const raw = sessionStorage.getItem(QUEUE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveQueue(queue: QueuedEvent[]) {
  try {
    sessionStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  } catch {
    // Analytics must never affect product behavior.
  }
}

function enqueue(event: string, properties?: Record<string, unknown>) {
  const queue = loadQueue();
  queue.push({ event, properties: sanitizeProperties(properties), queued_at: Date.now() });
  saveQueue(queue);
  if (isDev) console.debug(`[posthog] queued "${event}" (queue size: ${queue.length})`);
}

export function flushQueue() {
  if (
    POSTHOG_DISABLED ||
    typeof window === 'undefined' ||
    getConsent() !== 'accept' ||
    !posthog.__loaded
  ) return;

  const queue = loadQueue();
  if (queue.length === 0) return;

  sessionStorage.removeItem(QUEUE_KEY);
  for (const item of queue) {
    posthog.capture(item.event, {
      ...sanitizeProperties(item.properties),
      queued_at: item.queued_at,
    });
  }
}

export function clearQueue() {
  if (POSTHOG_DISABLED || typeof window === 'undefined') return;
  sessionStorage.removeItem(QUEUE_KEY);
}

export function hasAnalyticsConsent(): boolean {
  if (POSTHOG_DISABLED || typeof window === 'undefined') return false;
  return getConsent() === 'accept' && posthog.__loaded === true;
}

export function initPostHog() {
  if (
    POSTHOG_DISABLED ||
    typeof window === 'undefined' ||
    getConsent() !== 'accept' ||
    posthog.__loaded ||
    isInitialized
  ) return;

  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  const host = process.env.NEXT_PUBLIC_POSTHOG_HOST;
  if (!key || !host) return;

  try {
    posthog.init(key, {
      api_host: host,
      defaults: '2026-05-30',
      // Pageviews are emitted by PageViewTracker so App Router navigation is deterministic.
      capture_pageview: false,
      // Consent is explicit, so product interaction autocapture is useful for UX diagnosis.
      autocapture: true,
      capture_exceptions: {
        capture_unhandled_errors: true,
        capture_unhandled_rejections: true,
        capture_console_errors: false,
      },
      // Inputs are masked before replay data leaves the browser.
      session_recording: {
        maskAllInputs: true,
      },
      loaded: () => {
        flushQueue();
      },
    });

    isInitialized = true;
  } catch (error) {
    if (isDev) console.error('[posthog] init failed:', error);
  }
}

export function captureEvent(event: string, properties?: Record<string, unknown>) {
  if (POSTHOG_DISABLED || typeof window === 'undefined') return;

  try {
    // Never collect behavioral analytics without explicit opt-in.
    if (getConsent() !== 'accept') return;
    if (shouldSuppressLifecycleDuplicate(event)) return;

    if (!posthog.__loaded) {
      initPostHog();
    }

    const safeProperties = sanitizeProperties(properties);

    if (posthog.__loaded) {
      if (isDev) console.debug(`[posthog] ${event}`, safeProperties ?? {});
      posthog.capture(event, safeProperties);
      return;
    }

    enqueue(event, safeProperties);
  } catch (error) {
    if (isDev) console.error('[posthog] capture failed:', event, error);
  }
}

export function captureException(error: unknown, properties?: Record<string, unknown>) {
  if (POSTHOG_DISABLED || typeof window === 'undefined' || getConsent() !== 'accept') return;
  try {
    if (!posthog.__loaded) initPostHog();
    if (posthog.__loaded) posthog.captureException(error, sanitizeProperties(properties));
  } catch (captureError) {
    if (isDev) console.error('[posthog] exception capture failed:', captureError);
  }
}

export const onFeatureFlagsReady = (cb: () => void) => {
  if (POSTHOG_DISABLED || getConsent() !== 'accept') {
    cb();
    return;
  }

  try {
    if (!posthog.__loaded) initPostHog();
    if (posthog.__loaded) posthog.onFeatureFlags(cb);
    else cb();
  } catch (error) {
    if (isDev) console.warn('[posthog] feature flags not ready:', error);
    cb();
  }
};

export const getFlagVariant = (key: string, fallback = 'control'): Promise<string> =>
  new Promise((resolve) => {
    if (POSTHOG_DISABLED || getConsent() !== 'accept') return resolve(fallback);

    try {
      if (!posthog.__loaded) initPostHog();
      if (posthog.__loaded) {
        const value = posthog.getFeatureFlag?.(key) as string | boolean | undefined;
        if (typeof value === 'string') return resolve(value);
        if (value === true) return resolve('enabled');
      }
      resolve(fallback);
    } catch (error) {
      if (isDev) console.error('[posthog] flag error:', error);
      resolve(fallback);
    }
  });
