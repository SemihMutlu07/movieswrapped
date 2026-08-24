import { describe, expect, it } from 'vitest';

import type { ScrapeTraceEvent } from '@/lib/api';

import { chunkIntoBatches, MAX_POSTERS, resolveScrapeReveal } from './scrapeReveal';

function event(stage: string, metrics: Record<string, unknown> = {}): ScrapeTraceEvent {
  return { stage, message: stage, metrics };
}

describe('resolveScrapeReveal', () => {
  it('stays on intro until a confirmed film count or sample exists', () => {
    const reveal = resolveScrapeReveal([event('scrape_started')]);
    expect(reveal.beat).toBe('intro');
    expect(reveal.filmsFound).toBeNull();
    expect(reveal.items).toEqual([]);
    expect(reveal.posters).toEqual([]);
  });

  it('does not treat page traces without counts as films', () => {
    const reveal = resolveScrapeReveal([event('diary_page', { page: 1 })]);
    expect(reveal.beat).toBe('intro');
    expect(reveal.filmsFound).toBeNull();
  });

  it('unlocks films only from confirmed counts and done-stage samples', () => {
    const reveal = resolveScrapeReveal([
      event('diary_page', { page: 1, films: 50 }),
      event('diary_done', {
        films: 80,
        sample: [
          { title: 'Heat', year: '1995', poster_url: 'https://a.ltrbxd.com/heat.jpg' },
          { title: ' ', poster_url: 'https://a.ltrbxd.com/empty.jpg' },
          { title: 'Kader', poster_url: 'http://a.ltrbxd.com/kader.jpg' },
        ],
      }),
    ]);
    expect(reveal.beat).toBe('films');
    expect(reveal.filmsFound).toBe(80);
    expect(reveal.items.map((item) => item.title)).toEqual(['Heat', 'Kader']);
    expect(reveal.posters).toEqual([
      { title: 'Heat', year: '1995', poster_url: 'https://a.ltrbxd.com/heat.jpg' },
    ]);
  });

  it('ignores sample payloads on in-progress page events', () => {
    const reveal = resolveScrapeReveal([
      event('diary_page', {
        films: 50,
        sample: [{ title: 'Too Early', poster_url: 'https://a.ltrbxd.com/early.jpg' }],
      }),
    ]);
    expect(reveal.items).toEqual([]);
    expect(reveal.filmsFound).toBe(50);
    expect(reveal.beat).toBe('films');
  });

  it('holds analyzing as the last beat and keeps confirmed items', () => {
    const reveal = resolveScrapeReveal([
      event('grid_done', {
        films: 12,
        sample: [{ title: 'Heat', poster_url: 'https://a.ltrbxd.com/heat.jpg' }],
      }),
      event('reviews_done', { reviews: 4 }),
      event('scrape_done', { film_count: 12 }),
    ]);
    expect(reveal.beat).toBe('analyzing');
    expect(reveal.reviewsFound).toBe(4);
    expect(reveal.posters).toHaveLength(1);
  });

  it('stays on queued even if scrape events already exist', () => {
    const reveal = resolveScrapeReveal([event('diary_done', { films: 10 })], true);
    expect(reveal.beat).toBe('queued');
    expect(reveal.filmsFound).toBe(10);
  });

  it('caps the on-screen poster stream at MAX_POSTERS', () => {
    const sample = Array.from({ length: 12 }, (_, i) => ({
      title: `Film ${i + 1}`,
      poster_url: `https://a.ltrbxd.com/film-${i + 1}.jpg`,
    }));
    const reveal = resolveScrapeReveal([event('grid_done', { films: 12, sample })]);
    expect(reveal.posters).toHaveLength(MAX_POSTERS);
  });
});

describe('chunkIntoBatches (L3)', () => {
  it('splits 8 posters into two batches of 4', () => {
    const items = Array.from({ length: 8 }, (_, i) => i);
    expect(chunkIntoBatches(items)).toEqual([[0, 1, 2, 3], [4, 5, 6, 7]]);
  });

  it('keeps every batch within 2–4 items and preserves the total', () => {
    for (let total = 2; total <= 12; total += 1) {
      const items = Array.from({ length: total }, (_, i) => i);
      const batches = chunkIntoBatches(items);
      expect(batches.flat()).toEqual(items);
      for (const batch of batches) {
        expect(batch.length).toBeGreaterThanOrEqual(2);
        expect(batch.length).toBeLessThanOrEqual(4);
      }
    }
  });

  it('allows a singleton batch only when there is a single poster', () => {
    expect(chunkIntoBatches([1])).toEqual([[1]]);
  });

  it('returns no batches for an empty list', () => {
    expect(chunkIntoBatches([])).toEqual([]);
  });
});
