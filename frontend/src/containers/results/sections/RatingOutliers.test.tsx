import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import RatingDeviation from './RatingDeviation';
import type { StatsData } from './types';
import { I18nProvider } from '@/i18n/I18nProvider';

function renderWithI18n(ui: React.ReactElement) {
  return render(<I18nProvider locale="en">{ui}</I18nProvider>);
}

vi.mock('@/lib/analytics', () => ({
  getPosterUrl: (path: string | null | undefined) => path ?? null,
  getTmdbImageUrl: () => null,
  trackEvent: vi.fn(),
  trackConsentedEvent: vi.fn(),
}));

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

type RatedFilm = NonNullable<StatsData['rated_films']>[number];

function statsWith(ratedFilms: RatedFilm[], allFilms?: StatsData['all_films']): StatsData {
  // average_rating (global) is intentionally far from every film's community
  // rating so a test can prove the delta uses per-film community, not the avg.
  return { average_rating: 3.5, rated_films: ratedFilms, all_films: allFilms } as StatsData;
}

function higherFilm(title: string, yourRating: number, community: number): RatedFilm {
  return { title, your_rating: yourRating, community_rating: community, average_rating: community };
}

describe('RatingDeviation outliers', () => {
  afterEach(() => {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
  });
  it('measures delta against each film\'s own community rating, not the global average', () => {
    const films = [
      higherFilm('Pick', 5, 3.0),
      higherFilm('A', 4.5, 4.0),
      higherFilm('B', 4, 3.6),
      higherFilm('C', 5, 4.2),
      higherFilm('D', 4, 3.8),
    ];
    renderWithI18n(<RatingDeviation stats={statsWith(films)} />);
    // Caption reflects the film's community rating (3.0), not the 3.5 global avg.
    expect(screen.getByText(/★ 5\.0 vs community 3\.0/)).toBeInTheDocument();
    expect(screen.queryByText(/vs avg/)).toBeNull();
  });

  it('excludes films with no community rating', () => {
    const films = [
      higherFilm('Keep1', 5, 3.0),
      higherFilm('Keep2', 4.5, 3.5),
      higherFilm('Keep3', 4, 3.2),
      higherFilm('Keep4', 5, 4.0),
      higherFilm('Keep5', 4, 3.4),
      // No community data → must be dropped, never shown.
      { title: 'Dropped', your_rating: 4, community_rating: null, average_rating: null },
    ];
    renderWithI18n(<RatingDeviation stats={statsWith(films)} />);
    expect(screen.queryByText('Dropped')).toBeNull();
    // Each card renders one "vs community" caption → 5 valid higher films.
    expect(screen.getAllByText(/vs community/).length).toBe(5);
  });

  it('caps each tab at 6 films on expanded layouts with no show-more control', () => {
    const films = Array.from({ length: 8 }, (_, i) =>
      higherFilm(`Film${i + 1}`, 5, 5 - (i + 1) * 0.1),
    );
    renderWithI18n(<RatingDeviation stats={statsWith(films)} />);
    expect(screen.getAllByText(/vs community/).length).toBe(6);
    expect(screen.queryByRole('button', { name: /more/i })).toBeNull();
  });

  it('caps each tab at 4 films on compact layouts', () => {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: true,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    const films = Array.from({ length: 8 }, (_, i) =>
      higherFilm(`Film${i + 1}`, 5, 5 - (i + 1) * 0.1),
    );
    renderWithI18n(<RatingDeviation stats={statsWith(films)} />);
    expect(screen.getAllByText(/vs community/).length).toBe(4);
  });

  it('falls back to the matching all_films poster', () => {
    const films = [
      higherFilm('Pick', 5, 3.0),
      higherFilm('A', 4.5, 4.0),
      higherFilm('B', 4, 3.6),
      higherFilm('C', 5, 4.2),
      higherFilm('D', 4, 3.8),
    ];
    renderWithI18n(<RatingDeviation stats={statsWith(films, [{ title: 'Pick', poster_path: '/pick.jpg' }])} />);

    expect(screen.getByAltText('Pick')).toHaveAttribute('src', '/pick.jpg');
  });

  it('matches poster and metadata by title and year when remakes share a title', () => {
    const rated = [
      { ...higherFilm('Suspiria', 5, 3.0), year: 2018 },
      higherFilm('A', 4.5, 4.0),
      higherFilm('B', 4, 3.6),
      higherFilm('C', 5, 4.2),
      higherFilm('D', 4, 3.8),
    ];
    renderWithI18n(<RatingDeviation stats={statsWith(rated, [
      { title: 'Suspiria', year: 2018, poster_path: '/remake.jpg', director: 'Luca Guadagnino' },
      { title: 'Suspiria', year: 1977, poster_path: '/original.jpg', director: 'Dario Argento' },
    ])} />);

    const poster = screen.getByAltText('Suspiria');
    expect(poster).toHaveAttribute('src', '/remake.jpg');
    const card = poster.closest('.group')!;
    fireEvent.click(card);
    fireEvent.click(card.querySelector('button')!);
    expect(screen.getByText(/2018 · Luca Guadagnino/)).toBeInTheDocument();
    expect(screen.queryByText(/Dario Argento/)).toBeNull();
  });
});
