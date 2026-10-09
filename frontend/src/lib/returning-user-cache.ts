import { fetchRssFingerprint } from '@/lib/api';
import {
  lookupCachedAnalysis,
  type CachedAnalysisRun,
  type RssFingerprintFields,
} from '@/lib/supabase/analysis_runs';

export type LiveRssFingerprint = {
  checksum?: string | null;
  latest_guid?: string | null;
  latest_watched_date?: string | null;
  rss_checksum?: string | null;
  rss_latest_guid?: string | null;
  rss_latest_watched_date?: string | null;
};

function guidOf(value: RssFingerprintFields | LiveRssFingerprint): string {
  if ('rss_latest_guid' in value && value.rss_latest_guid) return value.rss_latest_guid.trim();
  if ('latest_guid' in value && value.latest_guid) return value.latest_guid.trim();
  return '';
}

function watchedDateOf(value: RssFingerprintFields | LiveRssFingerprint): string {
  if ('rss_latest_watched_date' in value && value.rss_latest_watched_date) {
    return value.rss_latest_watched_date.trim();
  }
  if ('latest_watched_date' in value && value.latest_watched_date) {
    return value.latest_watched_date.trim();
  }
  return '';
}

/**
 * Feed is unchanged when the latest diary guid (and watchedDate when both
 * sides have one) still match. Missing identity never counts as a hit.
 */
export function rssFingerprintUnchanged(
  stored: RssFingerprintFields | LiveRssFingerprint,
  live: RssFingerprintFields | LiveRssFingerprint,
): boolean {
  const storedGuid = guidOf(stored);
  const liveGuid = guidOf(live);
  if (!storedGuid || !liveGuid || storedGuid !== liveGuid) return false;
  const storedDate = watchedDateOf(stored);
  const liveDate = watchedDateOf(live);
  if (storedDate && liveDate && storedDate !== liveDate) return false;
  return true;
}

/**
 * Offer the last successful ZIP/scrape for this browser session only when
 * the live RSS guid/watchedDate has not moved. Never queries by username alone.
 */
export async function maybeOfferCachedRun(input: {
  session_id: string;
  username: string;
}): Promise<CachedAnalysisRun | null> {
  const sessionId = input.session_id.trim();
  const username = input.username.trim().toLowerCase();
  if (!sessionId || !username) return null;

  let cached: CachedAnalysisRun | null;
  try {
    cached = await lookupCachedAnalysis({ session_id: sessionId, username });
  } catch {
    return null;
  }
  if (!cached) return null;

  let live;
  try {
    live = await fetchRssFingerprint(username);
  } catch {
    return null;
  }
  if (!rssFingerprintUnchanged(cached, live)) return null;
  return cached;
}

/** Best-effort: stamp live RSS identity onto ZIP stats so finishAnalysis can persist it. */
export async function attachLiveRssFingerprint(
  stats: Record<string, unknown>,
  username: string,
  signal?: AbortSignal,
): Promise<void> {
  try {
    const rss = await fetchRssFingerprint(username, signal);
    stats.rss = {
      checksum: rss.checksum,
      latest_guid: rss.latest_guid,
      latest_watched_date: rss.latest_watched_date,
      item_count: rss.item_count,
      preview_only: true,
    };
  } catch {
    /* ZIP success must not fail because RSS is down */
  }
}
