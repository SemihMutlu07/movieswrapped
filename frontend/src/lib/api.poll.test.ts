import { afterEach, describe, expect, it, vi } from 'vitest';
import { SCRAPE_POLL_INTERVAL_MS, scrapeProfile } from './api';

// Backend allows one 400ms tab (150 polls / 60s) plus 50% headroom.
const ONE_TAB_POLLS_PER_WINDOW = Math.floor(60_000 / 400);

describe('scrape progress poll budget', () => {
  it('keeps one profile-scrape tab inside the progress rate limit', () => {
    const polls = Math.floor(60_000 / SCRAPE_POLL_INTERVAL_MS);
    expect(polls).toBeGreaterThan(0);
    expect(polls).toBeLessThanOrEqual(ONE_TAB_POLLS_PER_WINDOW);
  });
});

describe('scrapeProfile progress polling', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('waits out a progress 429 and still returns the scrape result', async () => {
    vi.useFakeTimers();
    let progressCalls = 0;
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes('/api/scrape-profile')) {
        return new Response(
          JSON.stringify({ task_id: 'task-1', poll_token: 'tok', status: 'pending' }),
          { status: 202, headers: { 'Content-Type': 'application/json' } },
        );
      }
      progressCalls += 1;
      if (progressCalls === 1) {
        return new Response(JSON.stringify({ detail: { error_code: 'rate_limited' } }), {
          status: 429,
          headers: { 'Retry-After': '1' },
        });
      }
      return new Response(
        JSON.stringify({
          status: 'done',
          result: { status: 'success', stats: { total_films: 3 } },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const pending = scrapeProfile('semihmutsuz');
    await vi.runAllTimersAsync();
    const result = await pending;

    expect(result.stats.total_films).toBe(3);
    expect(progressCalls).toBe(2);
  });
});
