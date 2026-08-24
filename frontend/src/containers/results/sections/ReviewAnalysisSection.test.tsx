import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ReviewAnalysisSection from './ReviewAnalysisSection';
import type { StatsData } from './types';
import { I18nProvider } from '@/i18n/I18nProvider';

const baseStats: Partial<StatsData> = {};

function buildReviews(n: number, textFor: (index: number) => string = (i) => `Review text for film ${i + 1}.`) {
  return Array.from({ length: n }, (_, i) => ({
    title: `Film ${i + 1}`,
    year: String(2020 + (i % 5)),
    text: textFor(i),
    likes: n - i,
    rating: 3.5,
  }));
}

function renderSection(
  reviewOverrides = {},
  wordFrequency = [{ word: 'love', count: 5 }],
  reviews = buildReviews(20),
) {
  const stats: StatsData = {
    ...baseStats,
    total_films: 100,
    average_rating: 3.5,
    days_watched: 10,
    average_runtime: 108,
    top_genres: [],
    top_directors: [],
    top_actors: [],
    top_countries: [],
    top_languages: [],
    decades: [],
    rating_distribution: {},
    review_analysis: {
      total_reviews: 20,
      reviews_with_text: 20,
      review_rate: 1,
      total_words_written: 2000,
      avg_review_length_words: 100,
      unique_words_used: 500,
      vocab_richness: 0.5,
      word_frequency: wordFrequency,
      bigram_frequency: [],
      avg_length_by_rating: {},
      language_mix: {},
      reviews,
    },
    ...(reviewOverrides as Partial<StatsData>),
  };
  return render(<I18nProvider locale="en"><ReviewAnalysisSection stats={stats} /></I18nProvider>);
}

describe('ReviewAnalysisSection', () => {
  it('renders only the first page of written reviews initially', () => {
    renderSection();
    const cards = screen.getAllByText(/Review text for film/);
    expect(cards.length).toBe(3);
  });

  it('expands reviews on "Show more reviews" click', async () => {
    renderSection();
    expect(screen.getAllByText(/Review text for film/).length).toBe(3);
    await userEvent.click(screen.getByRole('button', { name: /Show more reviews/i }));
    expect(screen.getAllByText(/Review text for film/).length).toBe(6);
  });

  it('resets pagination when sort changes', async () => {
    renderSection();
    await userEvent.click(screen.getByRole('button', { name: /Show more reviews/i }));
    expect(screen.getAllByText(/Review text for film/).length).toBe(6);
    await userEvent.click(screen.getByRole('button', { name: /Longest/i }));
    expect(screen.getAllByText(/Review text for film/).length).toBe(3);
  });

  it('filters reviews by selected word', async () => {
    renderSection(
      {},
      [{ word: 'love', count: 5 }],
      buildReviews(20, (i) => (i === 0 ? 'I love this film deeply.' : `Review text for film ${i + 1}.`)),
    );
    const loveButton = screen.getByRole('button', { name: /love/i });
    await userEvent.click(loveButton);
    expect(screen.getByText((_, node) => {
      return node?.tagName.toLowerCase() === 'p' && Boolean(node.textContent?.includes('Filtering: "love"'));
    })).toBeInTheDocument();
  });

  it('keeps the review list paginated when sort changes', async () => {
    renderSection();
    await userEvent.click(screen.getByRole('button', { name: /Longest/i }));
    expect(screen.getAllByText(/Review text for film/).length).toBe(3);
  });

  it('prefers the backend longest_review summary over client recomputation', () => {
    const reviews = [
      { title: 'Most Liked URL', year: '2025', text: `kısa yorum https://example.com/${'x'.repeat(300)}`, likes: 99, rating: 4 },
      { title: 'Many Words', year: '2024', text: 'İstanbul’da geçen bu film kalbimde uzun süre yaşayacak', likes: 0, rating: 3 },
      { title: 'Character Winner', year: '2023', text: 'abcdefghijklmnop', likes: 2, rating: 4 },
    ];
    renderSection({
      review_analysis: {
        total_reviews: 3, reviews_with_text: 3, review_rate: 1, total_words_written: 11,
        avg_review_length_words: 4, unique_words_used: 11, vocab_richness: 1,
        word_frequency: [], bigram_frequency: [], avg_length_by_rating: {}, language_mix: {},
        longest_review: { title: 'Many Words', year: '2024', length: 8, unit: 'words' },
        reviews,
      },
    }, [], reviews);

    expect(screen.getByText('Many Words (2024)')).toBeInTheDocument();
    expect(screen.getByText('8')).toBeInTheDocument();
    expect(screen.getByText('words on your longest review')).toBeInTheDocument();
  });

  it('shows the backend longest-review summary when detailed reviews are unavailable', () => {
    renderSection({
      review_analysis: {
        total_reviews: 12, reviews_with_text: 12, review_rate: 1, total_words_written: 800,
        avg_review_length_words: 67, unique_words_used: 300, vocab_richness: 0.5,
        word_frequency: [], bigram_frequency: [], avg_length_by_rating: {}, language_mix: {},
        longest_review: { title: 'Legacy Summary', year: '2022', length: 640 },
        reviews: [],
      },
    }, [], []);

    expect(screen.getByText('Legacy Summary (2022)')).toBeInTheDocument();
    expect(screen.getByText('640')).toBeInTheDocument();
    expect(screen.getByText('characters on your longest review')).toBeInTheDocument();
  });
});
