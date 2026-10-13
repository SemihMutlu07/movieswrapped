import { afterEach, describe, expect, it, vi } from 'vitest';
import { SCRAPE_POLL_INTERVAL_MS, SCRAPE_QUEUED_POLL_INTERVAL_MS, analyzeFiles, scrapeProfile } from './api';

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

  it('polls a queued job every two seconds and keeps polling past ten minutes', async () => {
    vi.useFakeTimers();
    let release = false;
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes('/api/scrape-profile')) {
        return new Response(
          JSON.stringify({ task_id: 'task-q', poll_token: 'tok', status: 'pending' }),
          { status: 202, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (release) {
        return new Response(
          JSON.stringify({ status: 'done', result: { status: 'success', stats: { total_films: 4 } } }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(
        JSON.stringify({ status: 'pending', stage: 'queued', queue_position: 3, eta_seconds: null }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const pending = scrapeProfile('alice');
    await vi.advanceTimersByTimeAsync(0);
    const pollsAtStart = fetchMock.mock.calls.filter((call) => String(call[0]).includes('/api/progress')).length;
    await vi.advanceTimersByTimeAsync(SCRAPE_POLL_INTERVAL_MS);
    const pollsAfterActiveInterval = fetchMock.mock.calls.filter((call) => String(call[0]).includes('/api/progress')).length;
    expect(pollsAfterActiveInterval).toBe(pollsAtStart);
    await vi.advanceTimersByTimeAsync(SCRAPE_QUEUED_POLL_INTERVAL_MS - SCRAPE_POLL_INTERVAL_MS);
    const pollsAfterQueuedInterval = fetchMock.mock.calls.filter((call) => String(call[0]).includes('/api/progress')).length;
    expect(pollsAfterQueuedInterval).toBeGreaterThan(pollsAtStart);

    await vi.advanceTimersByTimeAsync(11 * 60 * 1000);
    const early = await Promise.race([
      pending.then(() => 'done', (error: Error) => error.message),
      Promise.resolve('pending'),
    ]);
    expect(early).toBe('pending');

    release = true;
    await vi.advanceTimersByTimeAsync(SCRAPE_QUEUED_POLL_INTERVAL_MS);
    await expect(pending).resolves.toMatchObject({ stats: { total_films: 4 } });
  });

  it('stops a queued scrape at sixty minutes', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes('/api/scrape-profile')) {
        return new Response(
          JSON.stringify({ task_id: 'task-q60', poll_token: 'tok', status: 'pending' }),
          { status: 202, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(
        JSON.stringify({ status: 'pending', stage: 'queued' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });
    vi.stubGlobal('fetch', fetchMock);
    const pending = scrapeProfile('alice');
    const settled = pending.then(() => 'done', (error: Error) => error.message);
    await vi.advanceTimersByTimeAsync(61 * 60 * 1000);
    await expect(settled).resolves.toBe('Scrape stayed queued for 60 minutes');
  });

  it('stops processing after ten minutes without using the queue budget', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes('/api/scrape-profile')) {
        return new Response(
          JSON.stringify({ task_id: 'task-run', poll_token: 'tok', status: 'pending' }),
          { status: 202, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(
        JSON.stringify({ status: 'running', stage: 'scraping', queue_position: 1 }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });
    vi.stubGlobal('fetch', fetchMock);
    const pending = scrapeProfile('alice');
    const settled = pending.then(() => 'done', (error: Error) => error.message);
    await vi.advanceTimersByTimeAsync(11 * 60 * 1000);
    await expect(settled).resolves.toBe('Scrape processing exceeded 10 minutes');
  });

  it('reports a progress 404 after a server restart', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes('/api/scrape-profile')) {
        return new Response(
          JSON.stringify({ task_id: 'task-restart', poll_token: 'tok', status: 'pending' }),
          { status: 202, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(
        JSON.stringify({ detail: { likely_server_restart: true } }),
        { status: 404, headers: { 'Content-Type': 'application/json' } },
      );
    });
    vi.stubGlobal('fetch', fetchMock);
    await expect(scrapeProfile('alice')).rejects.toThrow(/server restarted/i);
  });
});

describe('ZIP analysis deadline', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('keeps the ten-minute ZIP deadline', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes('/api/analyze')) {
        return new Response(
          JSON.stringify({ task_id: 'zip-1', poll_token: 'tok', status: 'pending' }),
          { status: 202, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(
        JSON.stringify({ status: 'pending', stage: 'extract' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });
    vi.stubGlobal('fetch', fetchMock);
    const form = new FormData();
    form.append('files', new File(['title\n'], 'watched.csv', { type: 'text/csv' }));
    const pending = analyzeFiles(form);
    const settled = pending.then(() => 'done', (error: Error) => error.message);
    await vi.advanceTimersByTimeAsync(9 * 60 * 1000);
    const early = await Promise.race([settled, Promise.resolve('pending')]);
    expect(early).toBe('pending');
    await vi.advanceTimersByTimeAsync(2 * 60 * 1000);
    await expect(settled).resolves.toMatch(/10 minutes/);
  });
});
