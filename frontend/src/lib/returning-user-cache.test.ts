import { beforeEach, describe, expect, it, vi } from 'vitest';

const lookupMock = vi.fn();
const fingerprintMock = vi.fn();

vi.mock('@/lib/supabase/analysis_runs', () => ({
  lookupCachedAnalysis: (...args: unknown[]) => lookupMock(...args),
}));

vi.mock('@/lib/api', () => ({
  fetchRssFingerprint: (...args: unknown[]) => fingerprintMock(...args),
}));

import { maybeOfferCachedRun, rssFingerprintUnchanged } from './returning-user-cache';

const cachedRun = {
  id: 'run-1',
  session_id: 'sess-a',
  username: 'alice',
  summary: { details: { total_films: 12 } },
  details: { total_films: 12 },
  finished_at: '2026-10-09T00:00:00Z',
  total_films: 12,
  sinefil_meter: 70,
  cinematic_persona: 'The Explorer',
  average_rating: 3.8,
  total_countries: 4,
  rss_checksum: 'abc',
  rss_latest_guid: 'letterboxd-review-1000',
  rss_latest_watched_date: '2026-10-09',
};

describe('rssFingerprintUnchanged', () => {
  it('requires a stored and live guid', () => {
    expect(rssFingerprintUnchanged({ rss_latest_guid: null, rss_latest_watched_date: null, rss_checksum: null }, { latest_guid: 'g1' })).toBe(false);
    expect(rssFingerprintUnchanged({ rss_latest_guid: 'g1', rss_latest_watched_date: null, rss_checksum: null }, { latest_guid: null })).toBe(false);
  });

  it('treats matching guid and watchedDate as unchanged', () => {
    expect(
      rssFingerprintUnchanged(
        { rss_latest_guid: 'letterboxd-review-1000', rss_latest_watched_date: '2026-10-09', rss_checksum: 'a' },
        { latest_guid: 'letterboxd-review-1000', latest_watched_date: '2026-10-09' },
      ),
    ).toBe(true);
  });

  it('rejects a moved guid even if the date matches', () => {
    expect(
      rssFingerprintUnchanged(
        { rss_latest_guid: 'old', rss_latest_watched_date: '2026-10-09', rss_checksum: 'a' },
        { latest_guid: 'new', latest_watched_date: '2026-10-09' },
      ),
    ).toBe(false);
  });
});

describe('maybeOfferCachedRun', () => {
  beforeEach(() => {
    lookupMock.mockReset();
    fingerprintMock.mockReset();
  });

  it('returns the same-session run when live RSS guid has not moved', async () => {
    lookupMock.mockResolvedValue(cachedRun);
    fingerprintMock.mockResolvedValue({
      latest_guid: 'letterboxd-review-1000',
      latest_watched_date: '2026-10-09',
      checksum: 'abc',
      preview_only: true,
    });
    const offered = await maybeOfferCachedRun({ session_id: 'sess-a', username: 'alice' });
    expect(lookupMock).toHaveBeenCalledWith({ session_id: 'sess-a', username: 'alice' });
    expect(offered?.id).toBe('run-1');
  });

  it('does not offer a cache hit without a session id', async () => {
    const offered = await maybeOfferCachedRun({ session_id: '', username: 'alice' });
    expect(offered).toBeNull();
    expect(lookupMock).not.toHaveBeenCalled();
    expect(fingerprintMock).not.toHaveBeenCalled();
  });

  it('does not offer when lookup finds nothing for this session', async () => {
    lookupMock.mockResolvedValue(null);
    const offered = await maybeOfferCachedRun({ session_id: 'other-sess', username: 'alice' });
    expect(offered).toBeNull();
    expect(fingerprintMock).not.toHaveBeenCalled();
  });

  it('does not offer when RSS has moved', async () => {
    lookupMock.mockResolvedValue(cachedRun);
    fingerprintMock.mockResolvedValue({
      latest_guid: 'letterboxd-review-2000',
      latest_watched_date: '2026-10-10',
      checksum: 'def',
      preview_only: true,
    });
    expect(await maybeOfferCachedRun({ session_id: 'sess-a', username: 'alice' })).toBeNull();
  });
});
