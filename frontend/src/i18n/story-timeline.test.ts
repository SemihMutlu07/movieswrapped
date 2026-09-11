import { describe, expect, it } from 'vitest';

import { createTranslator } from './createTranslator';
import { indefiniteArticle } from './englishArticle';
import { formatActiveDay, formatPeakMonth } from './story-timeline';

const en = createTranslator('en');
const tr = createTranslator('tr');

describe('indefiniteArticle', () => {
  it('uses an before vowel cinema-scale labels', () => {
    expect(indefiniteArticle('Eclectic Viewer')).toBe('an');
    expect(indefiniteArticle('Arthouse Enthusiast')).toBe('an');
    expect(indefiniteArticle('Independent Cinephile')).toBe('an');
    expect(indefiniteArticle('Curious Moviegoer')).toBe('a');
    expect(indefiniteArticle('Mainstream Fan')).toBe('a');
  });
});

describe('story timeline copy', () => {
  it('formats YYYY-MM peak months', () => {
    expect(formatPeakMonth('2026-02', 'en')).toBe('February 2026');
    expect(formatPeakMonth('2026-02', 'tr')).toMatch(/2026/);
    expect(formatPeakMonth('Summer', 'en')).toBe('Summer');
  });

  it('localizes structured most-active-day instead of the English story blob', () => {
    const iso = formatActiveDay(
      { date: '2024-01-15', films: 3, story: 'Remember January 15? You watched 3 movies in one day.' },
      en,
    );
    expect(iso).toMatch(/January/);
    expect(iso).toMatch(/15/);
    expect(iso).toMatch(/2024/);
    expect(iso).toMatch(/3 films/);
    expect(iso).not.toMatch(/Remember/);
    expect(formatActiveDay(
      { date: 'August 12', films: 4, story: 'August 12 was a four-film marathon.' },
      en,
    )).toBe('August 12, when you watched 4 films');
    expect(formatActiveDay(
      { date: '2024-01-15', films: 3 },
      tr,
    )).toMatch(/3/);
  });
});
