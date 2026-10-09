import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildSummaryForPersistence, finishAnalysis, lookupCachedAnalysis, statsFromCachedRun } from './analysis_runs';

// Supabase client is mocked at module level; finishAnalysis uses it via getSupabase().
vi.mock('@/lib/supabaseClient', () => ({
  getSupabase: () => supabaseMock,
  safeSupabaseCall: async (fn: () => unknown) => fn(),
}));

let capturedPayload: Record<string, unknown> | null = null;
let capturedLookupEqs: { col: string; val: unknown }[] = [];
let selectRows: Record<string, unknown>[] = [];
let fromCalls = 0;

const supabaseMock = {
  from: () => {
    fromCalls += 1;
    const lookupChain: {
      eq: (col: string, val: unknown) => unknown;
      not: () => unknown;
      order: () => unknown;
      limit: () => Promise<{ data: Record<string, unknown>[]; error: null }>;
    } = {
      eq: (col: string, val: unknown) => {
        capturedLookupEqs.push({ col, val });
        return lookupChain;
      },
      not: () => lookupChain,
      order: () => lookupChain,
      limit: () => Promise.resolve({ data: selectRows, error: null }),
    };
    return {
      update: (payload: Record<string, unknown>) => {
        capturedPayload = payload;
        return {
          eq: () => ({ select: () => Promise.resolve({ error: null }) }),
        };
      },
      insert: () => Promise.resolve({ error: null }),
      select: () => lookupChain,
    };
  },
};

describe('buildSummaryForPersistence', () => {
  it('persists only allowlisted aggregate result fields', () => {
    const summary = buildSummaryForPersistence({
      total_films: 42,
      average_rating: 3.8,
      total_countries: 12,
      top_genres: [
        { name: 'Drama', count: 20, films: ['Secret Film'] },
        { name: 'Comedy', count: 10 },
      ],
      top_directors: [{ name: 'Director', count: 4, films: [{ title: 'Private Title' }] }],
      sinefil_meter: {
        score: 73,
        type: 'Explorer',
        model_version: 'cine_v2',
        breakdown: { geography: 10 },
      },
      cinematic_persona: { persona: 'The Explorer', description: 'Sensitive prose' },
      all_films: [{ title: 'Private Title', rating: 5 }],
      rated_films: [{ title: 'Another Private Title' }],
      review_analysis: {
        reviews: [{ title: 'Private Title', text: 'Private review', likers: ['person'] }],
        total_reviews: 4,
        reviews_with_text: 3,
        total_words_written: 120,
        avg_review_length_words: 40,
        longest_review: { title: 'Private Title', length: 80, unit: 'words' },
      },
      scraped_username: 'alice',
      profile_avatar_url: 'https://example.test/avatar.jpg',
    });

    expect(summary.details).toEqual(
      expect.objectContaining({
        total_films: 42,
        average_rating: 3.8,
        total_countries: 12,
        top_genres: [
          { name: 'Drama', count: 20 },
          { name: 'Comedy', count: 10 },
        ],
        top_directors: [{ name: 'Director', count: 4 }],
        sinefil_meter: { score: 73, type: 'Explorer', model_version: 'cine_v2' },
        cinematic_persona: { persona: 'The Explorer' },
        review_metrics: {
          total_reviews: 4,
          reviews_with_text: 3,
          total_words_written: 120,
          avg_review_length_words: 40,
          longest_review: { length: 80, unit: 'words' },
          reviews: [{ title: 'Private Title' }],
        },
      }),
    );
    expect(summary.details).not.toHaveProperty('all_films');
    expect(summary.details).not.toHaveProperty('rated_films');
    expect(summary.details).not.toHaveProperty('review_analysis');
    expect(summary.details).not.toHaveProperty('scraped_username');
    expect(summary.details).not.toHaveProperty('profile_avatar_url');
    expect(summary.schema_version).toBe('results_v2_aggregate');
    expect(JSON.stringify(summary)).toContain('Private Title');
    expect(JSON.stringify(summary)).not.toContain('Private review');
    expect(JSON.stringify(summary)).not.toContain('Secret Film');
    expect(JSON.stringify(summary)).not.toContain('Another Private Title');
    expect(JSON.stringify(summary)).not.toContain('Sensitive prose');
  });

  it('persists slim review titles without bodies when scalars are missing', () => {
    const summary = buildSummaryForPersistence({
      total_films: 2,
      review_analysis: {
        reviews: [{ title: 'Private Title', text: 'Private review', likers: ['person'] }],
      },
    });
    expect(summary.details).toEqual(
      expect.objectContaining({
        review_metrics: { reviews: [{ title: 'Private Title' }] },
      }),
    );
    expect(JSON.stringify(summary)).not.toContain('Private review');
    expect(JSON.stringify(summary)).not.toMatch(/"likers"/);
  });
});

describe('finishAnalysis', () => {
  beforeEach(() => {
    capturedPayload = null;
    capturedLookupEqs = [];
    selectRows = [];
    fromCalls = 0;
  });

  it('writes task_id, error_code and analysis_version alongside the summary', async () => {
    capturedPayload = null;

    const summary = buildSummaryForPersistence({
      total_films: 5,
      sinefil_meter: { score: 60, type: 'Explorer', model_version: 'cine_v2' },
    });

    await finishAnalysis({
      id: 'run-1',
      ok: true,
      task_id: 'task-123',
      summary,
    });

    expect(capturedPayload).toMatchObject({
      ok: true,
      task_id: 'task-123',
      error_code: null,
      analysis_version: 'cine_v2',
    });
  });

  it('does not clobber analysis_version with null when summary lacks model_version', async () => {
    capturedPayload = null;

    await finishAnalysis({
      id: 'run-2',
      ok: false,
      error_message: 'boom',
      error_code: 'scrape_failed',
    });

    expect(capturedPayload).toMatchObject({ ok: false, error_code: 'scrape_failed' });
    expect(capturedPayload).not.toHaveProperty('analysis_version'); // DB default stays
  });

  it('writes RSS fingerprint columns from persisted summary details', async () => {
    const summary = buildSummaryForPersistence({
      total_films: 8,
      rss: {
        checksum: 'abc123',
        latest_guid: 'letterboxd-review-1000',
        latest_watched_date: '2026-10-09',
        item_count: 50,
        sample: [{ title: 'Secret Film' }],
      },
    });

    await finishAnalysis({ id: 'run-rss', ok: true, summary });

    expect(capturedPayload).toMatchObject({
      rss_checksum: 'abc123',
      rss_latest_guid: 'letterboxd-review-1000',
      rss_latest_watched_date: '2026-10-09',
    });
    expect(JSON.stringify(summary)).not.toContain('Secret Film');
  });
});

describe('lookupCachedAnalysis', () => {
  beforeEach(() => {
    capturedLookupEqs = [];
    selectRows = [];
    fromCalls = 0;
  });

  it('refuses a username-only lookup', async () => {
    const result = await lookupCachedAnalysis({ session_id: '', username: 'alice' });
    expect(result).toBeNull();
    expect(fromCalls).toBe(0);
  });

  it('always filters by session_id and username together', async () => {
    selectRows = [{
      id: 'run-1',
      session_id: 'sess-a',
      username: 'alice',
      ok: true,
      summary: { details: { total_films: 12 } },
      finished_at: '2026-10-09T00:00:00Z',
      total_films: 12,
      rss_latest_guid: 'letterboxd-review-1000',
      rss_latest_watched_date: '2026-10-09',
    }];

    const result = await lookupCachedAnalysis({ session_id: 'sess-a', username: 'Alice' });
    expect(capturedLookupEqs).toEqual(
      expect.arrayContaining([
        { col: 'session_id', val: 'sess-a' },
        { col: 'username', val: 'alice' },
        { col: 'ok', val: true },
      ]),
    );
    expect(result).toMatchObject({
      session_id: 'sess-a',
      username: 'alice',
      total_films: 12,
      rss_latest_guid: 'letterboxd-review-1000',
    });
  });

  it('does not return a row owned by a different session', async () => {
    selectRows = [{
      id: 'run-1',
      session_id: 'other-sess',
      username: 'alice',
      summary: { details: { total_films: 12 } },
      rss_latest_guid: 'letterboxd-review-1000',
    }];

    const result = await lookupCachedAnalysis({ session_id: 'sess-a', username: 'alice' });
    expect(result).toBeNull();
  });
});

describe('statsFromCachedRun', () => {
  it('marks restored aggregates as cached', () => {
    const stats = statsFromCachedRun({
      id: 'run-1',
      session_id: 'sess-a',
      username: 'alice',
      summary: { details: { total_films: 12 } },
      details: { total_films: 12, sinefil_meter: { score: 70 } },
      finished_at: '2026-10-09T00:00:00Z',
      total_films: 12,
      sinefil_meter: 70,
      cinematic_persona: 'The Explorer',
      average_rating: 3.8,
      total_countries: 4,
      rss_checksum: 'abc',
      rss_latest_guid: 'g1',
      rss_latest_watched_date: '2026-10-09',
    }, 'alice');
    expect(stats).toMatchObject({
      total_films: 12,
      scraped_username: 'alice',
      _cached: true,
      source: 'cache',
    });
  });
});
