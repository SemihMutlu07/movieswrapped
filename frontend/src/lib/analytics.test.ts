import { describe, expect, it } from 'vitest';
import { getDirectTmdbImageUrl, getPosterUrl, getTmdbImageUrl } from './analytics';

describe('TMDB image URL normalization', () => {
  it.each([
    ['/poster.jpg', 'https://image.tmdb.org/t/p/w342/poster.jpg'],
    ['https://image.tmdb.org/t/p/w780/poster.jpg', 'https://image.tmdb.org/t/p/w342/poster.jpg'],
    ['/tmdb-proxy/t/p/original/poster.jpg', 'https://image.tmdb.org/t/p/w342/poster.jpg'],
    ['https://backend.example/tmdb-proxy/t/p/w500/poster.jpg', 'https://image.tmdb.org/t/p/w342/poster.jpg'],
  ])('normalizes %s for direct display', (input, expected) => {
    expect(getDirectTmdbImageUrl(input, 'w342')).toBe(expected);
    expect(getPosterUrl(input, 'grid')).toBe(expected);
  });

  it('preserves unrelated absolute image URLs', () => {
    expect(getPosterUrl('https://letterboxd.example/poster.jpg', 'grid')).toBe(
      'https://letterboxd.example/poster.jpg',
    );
  });

  it('preserves bundled development fixture images', () => {
    const fixtureImage = '/demo/smt-media/person.jpg';
    expect(getDirectTmdbImageUrl(fixtureImage)).toBe(fixtureImage);
    expect(getPosterUrl(fixtureImage, 'grid')).toBe(fixtureImage);
    expect(getPosterUrl(fixtureImage, 'share')).toBe(fixtureImage);
    expect(getTmdbImageUrl(fixtureImage)).toBe(fixtureImage);
  });

  it('keeps share images on the backend proxy', () => {
    expect(getPosterUrl('/poster.jpg', 'share')).toContain('/tmdb-proxy/t/p/original/poster.jpg');
  });
});
