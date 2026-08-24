import { describe, expect, it } from 'vitest';

import {
  compareReviewsByLikes,
  reviewCharLength,
  reviewWordCount,
  selectLongestReview,
} from './reviews';

describe('review selection', () => {
  it('selects the actual longest text by characters instead of likes or URL length', () => {
    const reviews = [
      {
        title: 'Most Liked',
        year: '2025',
        likes: 99,
        text: `kısa yorum https://example.com/${'x'.repeat(500)}`,
        word_count: 999,
      },
      {
        title: 'En Uzun',
        year: '2024',
        likes: 0,
        text: 'İstanbul’da geçen bu film kalbimde uzun süre yaşayacak',
      },
    ];

    expect(reviewWordCount(reviews[0])).toBe(2);
    expect(reviewWordCount(reviews[1])).toBe(8);
    expect(reviewCharLength(reviews[0])).toBeLessThan(reviewCharLength(reviews[1]));
    expect(selectLongestReview(reviews)?.title).toBe('En Uzun');
    expect([...reviews].sort(compareReviewsByLikes)[0]?.title).toBe('Most Liked');
  });

  it('breaks equal word and character counts deterministically by title then year', () => {
    const reviews = [
      { title: 'Zulu', year: '2025', text: 'aynı sayıda sözcük var bugün burada' },
      { title: 'Alpha', year: '2025', text: 'aynı sayıda sözcük var bugün burada' },
      { title: 'Alpha', year: '2024', text: 'aynı sayıda sözcük var bugün burada' },
    ];

    expect(selectLongestReview(reviews)).toMatchObject({ title: 'Alpha', year: '2024' });
  });

  it('does not select empty or link-only noise as a written review', () => {
    const reviews = [
      { title: 'Only URL', year: '2026', text: 'https://example.com/review' },
      { title: 'Empty', year: '2026', text: '   ' },
      { title: 'Readable', year: '2026', text: 'tek gerçek cümle' },
    ];

    expect(selectLongestReview(reviews)?.title).toBe('Readable');
  });

  it('prefers more characters when word counts are equal', () => {
    const reviews = [
      { title: 'Short Tokens', year: '2024', text: 'aa bb' },
      { title: 'Long Tokens', year: '2024', text: 'aaaa bbbb' },
    ];

    expect(reviewWordCount(reviews[0])).toBe(reviewWordCount(reviews[1]));
    expect(selectLongestReview(reviews)?.title).toBe('Long Tokens');
  });
});
