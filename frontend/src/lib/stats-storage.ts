import { clearStoryPlayback } from '@/lib/story-playback';

export const STATS_STORAGE_KEY = 'letterboxdStats';

/**
 * Heaviest film-level arrays, ordered by how little the user loses when one is
 * dropped. On a ~800-film profile these four are ~90% of the payload:
 * all_films only feeds click-through modals, actors_with_ratings only feeds
 * CastGrid's "highest rated" mode, and the last two hide their own section.
 * Every consumer already guards for the field being absent.
 */
const SHEDDABLE_FIELDS = [
  'all_films',
  'actors_with_ratings',
  'review_analysis',
  'rated_films',
] as const;

export class StatsTooLargeError extends Error {
  constructor() {
    super('The analysis result is too large for this browser to store.');
    this.name = 'StatsTooLargeError';
  }
}

function isQuotaError(err: unknown): boolean {
  return (
    err instanceof DOMException &&
    (err.name === 'QuotaExceededError' ||
      err.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
      err.code === 22 ||
      err.code === 1014)
  );
}

/**
 * Write the analysis result to session storage, shedding heavy optional fields
 * rather than throwing away an analysis that already succeeded.
 *
 * Returns the fields that had to be dropped so the caller can report the
 * degraded state. Throws StatsTooLargeError only when even the core summary
 * does not fit; any non-quota storage failure propagates unchanged.
 */
export function persistStats(
  stats: object,
  storage: Storage = sessionStorage,
): { dropped: string[] } {
  // Free the previous run's blob first — otherwise a second analysis in the
  // same tab competes with its own leftovers for the quota.
  storage.removeItem(STATS_STORAGE_KEY);
  clearStoryPlayback(storage);

  const payload: Record<string, unknown> = { ...stats };
  // Clone the nested window too, so shedding from it below never mutates the
  // caller's original stats object (payload started as only a shallow copy).
  if (payload.last_12_months && typeof payload.last_12_months === 'object') {
    payload.last_12_months = { ...(payload.last_12_months as Record<string, unknown>) };
  }
  const dropped: string[] = [];

  for (let attempt = 0; ; attempt++) {
    try {
      storage.setItem(STATS_STORAGE_KEY, JSON.stringify(payload));
      return { dropped };
    } catch (err) {
      if (!isQuotaError(err)) throw err;
      if (attempt >= SHEDDABLE_FIELDS.length) throw new StatsTooLargeError();
      const field = SHEDDABLE_FIELDS[attempt];
      let shed = false;
      if (field in payload) {
        delete payload[field];
        shed = true;
      }
      const nested = payload.last_12_months as Record<string, unknown> | undefined;
      if (nested && field in nested) {
        delete nested[field];
        shed = true;
      }
      if (shed) dropped.push(field);
    }
  }
}
