import { describe, expect, it } from 'vitest';

import type { StatsData } from '@/containers/results/sections/types';

import {
  buildFinaleCurtainMedia,
  buildFinaleSequence,
  collectCinematicClaimedUrls,
  FINALE_CURTAIN_POSTER_CAP,
} from '../media';
import { finalePhaseAt } from './finalePhases';

const STATS = {
  all_films: [
    { title: 'Film A', poster_path: '/a.jpg', rating: 5 },
    { title: 'Film B', poster_path: '/b.jpg', rating: 4 },
    { title: 'Film C', poster_path: '/c.jpg', rating: 3 },
    { title: 'Film D', poster_path: '/d.jpg', rating: 2 },
    { title: 'Film E', poster_path: '/e.jpg', rating: 1 },
  ],
} as unknown as StatsData;

describe('buildFinaleCurtainMedia', () => {
  it('caps curtain posters at eight unique film posters', () => {
    const manyFilms = Array.from({ length: 12 }, (_, index) => ({
      title: `Film ${index}`,
      poster_path: `/p${index}.jpg`,
      rating: index,
    }));
    const media = buildFinaleCurtainMedia({ all_films: manyFilms } as unknown as StatsData);
    expect(media.length).toBeLessThanOrEqual(FINALE_CURTAIN_POSTER_CAP);
    expect(media.every((item) => item.type === 'poster')).toBe(true);
  });

  it('soft-excludes claimed URLs and prefers non-overlapping posters', () => {
    const claimed = collectCinematicClaimedUrls([
      {
        profile: { type: 'profile', url: 'https://image.tmdb.org/t/p/h632/denis.jpg', alt: 'portrait' },
        streamPosters: [
          { type: 'poster', url: 'https://image.tmdb.org/t/p/w500/arrival.jpg', alt: 'Arrival poster' },
        ],
      },
      {
        profile: { type: 'profile', url: 'https://image.tmdb.org/t/p/h632/jake.jpg', alt: 'portrait' },
        streamPosters: [
          { type: 'poster', url: 'https://image.tmdb.org/t/p/w500/night.jpg', alt: 'Nightcrawler poster' },
        ],
      },
    ]);

    const media = buildFinaleCurtainMedia(STATS, {
      excludeUrls: claimed.set,
      claimedUrls: claimed.urls,
    });

    const urls = media.map((item) => item.url);
    expect(urls).not.toContain('https://image.tmdb.org/t/p/w500/arrival.jpg');
    expect(urls).not.toContain('https://image.tmdb.org/t/p/w500/night.jpg');
    expect(urls.some((url) => url.includes('/a.jpg') || url.includes('/b.jpg'))).toBe(true);
  });

  it('buildFinaleSequence returns curtain posters only', () => {
    const sequence = buildFinaleSequence(STATS);
    expect(sequence.curtainPosters.length).toBeGreaterThan(0);
    expect(sequence.curtainPosters.every((item) => item.type === 'poster')).toBe(true);
  });
});

describe('finalePhaseAt', () => {
  it('steps through cumulative curtain offsets', () => {
    expect(finalePhaseAt(0)).toBe('textReveal');
    expect(finalePhaseAt(499)).toBe('textReveal');
    expect(finalePhaseAt(500)).toBe('curtainFade');
    expect(finalePhaseAt(1599)).toBe('curtainFade');
    expect(finalePhaseAt(1600)).toBe('cardReveal');
    expect(finalePhaseAt(2699)).toBe('cardReveal');
    expect(finalePhaseAt(2700)).toBe('final');
  });
});
