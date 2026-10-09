import { describe, expect, it } from 'vitest';
import { resolveScrapeReveal } from './scrapeReveal';

describe('resolveScrapeReveal RSS preview', () => {
  it('treats rss_preview samples as wait-story posters without using the feed size as library total', () => {
    const reveal = resolveScrapeReveal([
      {
        stage: 'rss_preview',
        message: 'Public RSS preview',
        metrics: {
          item_count: 54,
          feed_cap: 50,
          preview_only: true,
          sample: [
            { title: 'Digger', year: '2026', poster_url: 'https://a.ltrbxd.com/digger.jpg' },
            { title: 'Aftersun', year: '2022', poster_url: 'https://a.ltrbxd.com/aftersun.jpg' },
          ],
        },
      },
    ]);

    expect(reveal.rssItemCount).toBe(54);
    expect(reveal.filmsFound).toBeNull();
    expect(reveal.beat).toBe('films');
    expect(reveal.posters.map((item) => item.title)).toEqual(['Digger', 'Aftersun']);
  });

  it('prefers diary film counts over the RSS window once HTML scrape reports them', () => {
    const reveal = resolveScrapeReveal([
      {
        stage: 'rss_preview',
        metrics: {
          item_count: 54,
          sample: [{ title: 'Digger', year: '2026', poster_url: 'https://a.ltrbxd.com/digger.jpg' }],
        },
      },
      {
        stage: 'diary_done',
        metrics: {
          films: 600,
          sample: [{ title: 'HTML Film', year: '2024', poster_url: 'https://a.ltrbxd.com/html.jpg' }],
        },
      },
    ]);

    expect(reveal.rssItemCount).toBe(54);
    expect(reveal.filmsFound).toBe(600);
    expect(reveal.items.map((item) => item.title)).toEqual(['Digger', 'HTML Film']);
  });
});
