import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RatingBucketModal } from './FilmAndRatings';
import { I18nProvider } from '@/i18n/I18nProvider';

vi.mock('@/lib/analytics', () => ({
  getPosterUrl: (path: string | null | undefined, _variant?: string) =>
    path ? `http://localhost:8000${path}` : null,
  trackEvent: vi.fn(),
  trackConsentedEvent: vi.fn(),
}));

function buildFilms(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    title: `Film ${i + 1}`,
    year: 2020 + (i % 5),
    rating: 4,
    communityRating: 3.8,
    poster_path: `/poster${i + 1}.jpg`,
  }));
}

describe('RatingBucketModal', () => {
  it('caps initial poster cards and expands on click', async () => {
    render(
      <I18nProvider locale="en">
        <RatingBucketModal
          bucket={{ rating: 4, label: '4★', films: buildFilms(25) }}
          onClose={() => {}}
        />
      </I18nProvider>
    );
    const posters = await screen.findAllByAltText(/poster/i);
    expect(posters.length).toBe(12);
    await userEvent.click(screen.getByRole('button', { name: /Show more films/i }));
    expect(screen.getAllByAltText(/poster/i).length).toBe(24);
  });
});
