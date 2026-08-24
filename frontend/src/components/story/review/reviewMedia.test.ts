import { describe, expect, it } from 'vitest';

import {
  REVIEW_STREAM_POSTER_CAP,
  REVIEW_STREAM_MIN_FILL,
  buildReviewSequence,
  reviewStreamPosters,
} from '../media';
import type { StatsData } from '@/containers/results/sections/types';
import { reviewPhaseAt } from './reviewPhases';

describe('review stream media', () => {
  it('selects longest review by character length via selectLongestReview', () => {
    const stats = {
      review_analysis: {
        total_words_written: 500,
        reviews: [
          { title: 'Aftersun', text: 'short actual text', text_length: 5000, likes: 3, poster_path: '/after.jpg' },
          { title: 'Memories of Underdevelopment', text: 'a much longer review body by actual character count', text_length: 10, likes: 0, poster_path: '/mem.jpg' },
        ],
      },
      all_films: [
        { title: 'Aftersun', poster_path: '/after.jpg', rating: 4 },
        { title: 'Memories of Underdevelopment', poster_path: '/mem.jpg', rating: 5 },
      ],
    } as unknown as StatsData;

    const sequence = buildReviewSequence(stats)!;
    expect(sequence.filmTitle).toBe('Memories of Underdevelopment');
    expect(sequence.heroPoster?.alt).toBe('Memories of Underdevelopment poster');
    expect(sequence.streamPosters.length).toBeLessThanOrEqual(REVIEW_STREAM_POSTER_CAP);
    expect(sequence.streamPosters.every((poster) => poster.url !== sequence.heroPoster?.url)).toBe(true);
  });

  it('caps stream posters and excludes hero URL', () => {
    const reviews = Array.from({ length: 20 }, (_, index) => ({
      title: `Film ${index}`,
      text: `word ${index} ${'extra '.repeat(index)}`,
      poster_path: `/p-${index}.jpg`,
      likes: 0,
    }));
    const stats = {
      review_analysis: { reviews, total_words_written: 1000 },
      all_films: reviews.map((review, index) => ({ title: review.title, poster_path: `/p-${index}.jpg` })),
    } as unknown as StatsData;
    const longest = reviews.sort((a, b) => b.text.length - a.text.length)[0];
    const posters = reviewStreamPosters(stats, {
      heroTitle: longest.title,
      heroUrl: `https://image.tmdb.org/t/p/w500/${longest.poster_path.replace('/', '')}`,
    });
    expect(posters.length).toBeLessThanOrEqual(REVIEW_STREAM_POSTER_CAP);
    expect(posters.every((poster) => !poster.url.endsWith(longest.poster_path.replace('/', '')))).toBe(true);
  });

  it('prefers non-claimed URLs until MIN_FILL then soft-refills', () => {
    const stats = {
      review_analysis: {
        reviews: [
          { title: 'Hero Film', text: 'longest review body with many words here', poster_path: '/hero.jpg', likes: 0 },
          { title: 'Overlap', text: 'overlap review words', poster_path: '/overlap.jpg', likes: 1 },
          { title: 'Unique A', text: 'unique a words', poster_path: '/a.jpg', likes: 0 },
          { title: 'Unique B', text: 'unique b words', poster_path: '/b.jpg', likes: 0 },
        ],
      },
      all_films: [
        { title: 'Hero Film', poster_path: '/hero.jpg' },
        { title: 'Overlap', poster_path: '/overlap.jpg' },
        { title: 'Unique A', poster_path: '/a.jpg' },
        { title: 'Unique B', poster_path: '/b.jpg' },
      ],
    } as StatsData;
    const overlapUrl = 'https://image.tmdb.org/t/p/w500/overlap.jpg';
    const posters = reviewStreamPosters(stats, {
      heroTitle: 'Hero Film',
      heroUrl: 'https://image.tmdb.org/t/p/w500/hero.jpg',
      excludeUrls: new Set([overlapUrl]),
      claimedUrls: [overlapUrl],
    });
    expect(posters.map((poster) => poster.alt)).toEqual([
      'Unique A poster',
      'Unique B poster',
      'Overlap poster',
    ]);
  });
});

describe('reviewPhaseAt', () => {
  it('mirrors director offsets at 650/1300/1900/3200ms', () => {
    expect(reviewPhaseAt(0)).toBe('textReveal');
    expect(reviewPhaseAt(649)).toBe('textReveal');
    expect(reviewPhaseAt(650)).toBe('heroIntro');
    expect(reviewPhaseAt(1300)).toBe('compose');
    expect(reviewPhaseAt(1900)).toBe('streamBurst');
    expect(reviewPhaseAt(3200)).toBe('final');
  });
});
