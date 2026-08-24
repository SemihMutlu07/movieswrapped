import { captureEvent, hasAnalyticsConsent } from '@/lib/posthog';
import { API_BASE } from '@/lib/api';

// Re-export for convenience
export { hasAnalyticsConsent };

type Props = Record<string, unknown>;

let _warnedMissingApiBase = false;
function warnIfMissingApiBase(): void {
  if (_warnedMissingApiBase) return;
  if (typeof window === 'undefined') return;
  if (API_BASE) return;
  if (process.env.NODE_ENV === 'production') return;
  _warnedMissingApiBase = true;
  console.warn(
    '[tmdb] NEXT_PUBLIC_API_BASE is empty — image requests will use relative paths. ' +
    'Set NEXT_PUBLIC_API_BASE to your backend origin (e.g. http://localhost:8000 in dev, ' +
    'https://wrapped-backend.onrender.com in production) so /tmdb-proxy/ reaches the backend.',
  );
}

/**
 * Generate TMDB image URL with proxy to avoid CORS issues
 */
export function getTmdbImageUrl(path: string | null | undefined, size: string = 'w300'): string | null {
  const value = path?.trim();
  if (!value) return null;
  if (value.startsWith('/demo/')) return value;

  const proxiedPath = (cleanPath: string) => {
    const base = typeof window !== 'undefined' ? (API_BASE || '') : '';
    if (!base) warnIfMissingApiBase();
    const path = `/tmdb-proxy/${cleanPath.replace(/^\/+/, '')}`;
    return base ? `${base}${path}` : path;
  };

  // If already a full URL and it's TMDB CDN, convert to proxy
  if (/^https?:\/\//i.test(value) && value.includes('://image.tmdb.org')) {
    const url = new URL(value);
    const cleanPath = url.pathname.replace(/^\/+/, '');
    return proxiedPath(cleanPath);
  }

  // If already a full URL (non-TMDB), return as-is
  if (/^https?:\/\//i.test(value) && !value.includes('/tmdb-proxy/')) return value;

  // Clean the path: remove leading slashes and duplicate t/p/<size>/ parts
  let cleanPath = value.replace(/^https?:\/\/[^/]+/i, '').replace(/^\/+/, '');
  cleanPath = cleanPath.replace(/^tmdb-proxy\//, '');
  cleanPath = cleanPath.replace(/^t\/p\/[^\/]+\//, ''); // Remove t/p/<size>/ prefix if exists

  return proxiedPath(`t/p/${size}/${cleanPath}`);
}

export function getPosterUrl(path: string | null | undefined, quality: 'grid' | 'share' = 'grid'): string | null {
  return quality === 'share'
    ? getTmdbImageUrl(path, 'original')
    : getDirectTmdbImageUrl(path, 'w342');
}

export function getProfileUrl(path: string | null | undefined, quality: 'grid' | 'share' = 'grid'): string | null {
  return quality === 'share'
    ? getTmdbImageUrl(path, 'w500')
    : getDirectTmdbImageUrl(path, 'w342');
}

/** Normalize any supported TMDB path/URL to the public CDN for normal display. */
export function getDirectTmdbImageUrl(path: string | null | undefined, size: string = 'w342'): string | null {
  const value = path?.trim();
  if (!value) return null;
  if (value.startsWith('/demo/')) return value;
  if (/^https?:\/\//i.test(value) && !value.includes('image.tmdb.org') && !value.includes('/tmdb-proxy/')) {
    return value;
  }
  let pathname = value;
  try {
    pathname = new URL(value, 'https://local.invalid').pathname;
  } catch {
    // Normalize the raw value below.
  }
  const cleanPath = pathname
    .replace(/^\/+/, '')
    .replace(/^tmdb-proxy\//, '')
    .replace(/^t\/p\/[^/]+\//, '');
  return cleanPath ? `https://image.tmdb.org/t/p/${size}/${cleanPath}` : null;
}

/**
 * Always-allowed, high-level events (page hits, feature usage, errors).
 * Still respects PostHog init + consent gate inside captureEvent.
 */
export function trackEvent(name: string, props?: Props): void {
  try {
    captureEvent(name, props);
  } catch {
    // Never break UX for analytics
  }
}

/**
 * Events that should only fire when the user has explicitly accepted analytics.
 */
export function trackConsentedEvent(name: string, props?: Props): void {
  try {
    if (!hasAnalyticsConsent()) return;
    captureEvent(name, props);
  } catch {
    // Silent failure
  }
}

/**
 * Aggregated film stats – safe, high-level metrics only.
 */
export function trackFilmStats(stats: unknown): void {
  try {
    if (!hasAnalyticsConsent()) return;
    // Expect an already-aggregated object (no raw titles/user PII)
    captureEvent('film_stats', stats as Props);
  } catch {
    // Silent failure
  }
}
